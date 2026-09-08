#!/usr/bin/env python3
"""Route Registry Client SDK consumer reports into the active Registry version queue.

GitHub Issues remain the source of truth. The tracked queue stores only stable machine
identifiers needed by coding agents to select work for the active dev/<semver> branch.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

REPORT_MARKER_START = "<!-- sctool-registry-sdk-report:v1"
REPORT_MARKER_END = "-->"
QUEUE_SCHEMA = "sctool-registry-sdk-issue-queue/v1"
REPORT_SCHEMA = "sctool-registry-sdk-report/v1"
DEV_BRANCH_RE = re.compile(r"^dev/(\d+)\.(\d+)\.(\d+)$")
TERMINAL_VERSION_STATES = {
    "COMPLETE",
    "CLOSED",
    "HISTORICAL_COMPLETE",
    "MERGED",
    "RELEASED",
}
SEVERITY_ORDER = {"BLOCKER": 0, "HIGH": 1, "NORMAL": 2, "LOW": 3}


class IntakeError(RuntimeError):
    pass


@dataclass(frozen=True)
class BranchState:
    branch: str
    version: str
    state: str
    ahead_by: int = 1

    @property
    def active(self) -> bool:
        if not DEV_BRANCH_RE.fullmatch(self.branch):
            return False
        if self.ahead_by <= 0:
            return False
        if self.state in TERMINAL_VERSION_STATES:
            return False
        return self.state.startswith("IN_PROGRESS") or "ACTIVE" in self.state or "BLOCKED" in self.state


def _run(args: list[str], *, input_text: str | None = None) -> str:
    completed = subprocess.run(
        args,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        command = " ".join(args)
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise IntakeError(f"command failed ({completed.returncode}): {command}\n{detail}")
    return completed.stdout


def parse_current_index(text: str) -> BranchState:
    current = re.search(r"(?ms)^current:\s*\n(?P<body>(?:^  .*(?:\n|$))*)", text)
    if not current:
        raise IntakeError("docs/index.yaml has no top-level current block")
    body = current.group("body")

    def field(name: str) -> str:
        match = re.search(rf'(?m)^  {re.escape(name)}:\s*"?([^"\n]+?)"?\s*$', body)
        if not match:
            raise IntakeError(f"docs/index.yaml current.{name} is missing")
        return match.group(1).strip()

    return BranchState(
        branch=field("branch"),
        version=field("distribution_contract_version"),
        state=field("state"),
    )


def parse_report(body: str) -> dict[str, Any] | None:
    start = body.find(REPORT_MARKER_START)
    if start < 0:
        return None
    payload_start = start + len(REPORT_MARKER_START)
    end = body.find(REPORT_MARKER_END, payload_start)
    if end < 0:
        raise IntakeError("Registry SDK report marker is not closed")
    raw = body[payload_start:end].strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise IntakeError(f"Registry SDK report marker does not contain valid JSON: {exc}") from exc
    if data.get("schema") != REPORT_SCHEMA:
        raise IntakeError(f"unsupported report schema: {data.get('schema')!r}")
    if not data.get("report_id"):
        raise IntakeError("Registry SDK report is missing report_id")
    return data


def select_route(states: Iterable[BranchState]) -> dict[str, Any]:
    active = sorted(
        (state for state in states if state.active and state.branch == f"dev/{state.version}"),
        key=lambda state: tuple(int(part) for part in state.version.split(".")),
    )
    if not active:
        return {
            "mode": "NEXT_VERSION_QUEUE",
            "target_branch": None,
            "target_version": None,
            "candidates": [],
        }
    if len(active) > 1:
        return {
            "mode": "ROUTING_BLOCKED",
            "target_branch": None,
            "target_version": None,
            "candidates": [state.branch for state in active],
        }
    state = active[0]
    return {
        "mode": "CURRENT_VERSION",
        "target_branch": state.branch,
        "target_version": state.version,
        "candidates": [state.branch],
    }


def build_queue(issues: Iterable[dict[str, Any]], route: dict[str, Any]) -> dict[str, Any]:
    if route.get("mode") != "CURRENT_VERSION":
        raise IntakeError("queue can only be built for CURRENT_VERSION routing")
    items: list[dict[str, Any]] = []
    for issue in issues:
        report = parse_report(issue.get("body") or "")
        if report is None:
            continue
        source = report.get("source") or {}
        sdk = report.get("sdk") or {}
        item = {
            "issue_number": int(issue["number"]),
            "report_id": str(report["report_id"]),
            "kind": str(report.get("kind") or "OTHER"),
            "severity": str(report.get("severity") or "NORMAL"),
            "source_repository": str(source.get("repository") or ""),
            "source_branch": str(source.get("branch") or ""),
            "source_head": str(source.get("head") or ""),
            "sdk_package": str(sdk.get("package") or ""),
            "sdk_version": str(sdk.get("version") or ""),
        }
        items.append(item)

    items.sort(
        key=lambda item: (
            SEVERITY_ORDER.get(item["severity"], SEVERITY_ORDER["NORMAL"]),
            item["issue_number"],
        )
    )
    return {
        "schema": QUEUE_SCHEMA,
        "target_branch": route["target_branch"],
        "target_version": route["target_version"],
        "issues": items,
    }


def _gh_branch_names(repository: str) -> list[str]:
    endpoint = f"repos/{repository}/branches?per_page=100"
    output = _run(["gh", "api", "--paginate", endpoint, "--jq", ".[].name"])
    return [line.strip() for line in output.splitlines() if line.strip()]


def _gh_index_for_branch(repository: str, branch: str) -> str:
    endpoint = f"repos/{repository}/contents/docs/index.yaml?ref={quote(branch, safe='')}"
    encoded = _run(["gh", "api", endpoint, "--jq", ".content"]).strip().replace("\n", "")
    try:
        return base64.b64decode(encoded).decode("utf-8")
    except Exception as exc:
        raise IntakeError(f"cannot decode docs/index.yaml for {branch}: {exc}") from exc


def _gh_ahead_by_main(repository: str, branch: str) -> int:
    endpoint = f"repos/{repository}/compare/main...{quote(branch, safe='')}"
    output = _run(["gh", "api", endpoint, "--jq", ".ahead_by"]).strip()
    try:
        return int(output)
    except ValueError as exc:
        raise IntakeError(f"invalid compare ahead_by for {branch}: {output!r}") from exc


def discover_branch_states(repository: str) -> list[BranchState]:
    states: list[BranchState] = []
    for branch in _gh_branch_names(repository):
        if not DEV_BRANCH_RE.fullmatch(branch):
            continue
        try:
            state = parse_current_index(_gh_index_for_branch(repository, branch))
        except IntakeError:
            continue
        if state.branch == branch:
            states.append(BranchState(state.branch, state.version, state.state, _gh_ahead_by_main(repository, branch)))
    return states


def discover_route(repository: str) -> dict[str, Any]:
    return select_route(discover_branch_states(repository))


def _gh_open_issues(repository: str) -> list[dict[str, Any]]:
    output = _run(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            repository,
            "--state",
            "open",
            "--limit",
            "500",
            "--json",
            "number,title,body,url,updatedAt",
        ]
    )
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise IntakeError(f"gh issue list returned invalid JSON: {exc}") from exc
    if not isinstance(data, list):
        raise IntakeError("gh issue list did not return an array")
    return data


def _write_json(path: Path, data: dict[str, Any]) -> bool:
    rendered = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    if previous == rendered:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered, encoding="utf-8", newline="\n")
    return True


def command_route(args: argparse.Namespace) -> int:
    route = discover_route(args.repository)
    print(json.dumps(route, ensure_ascii=False, separators=(",", ":")))
    return 0


def command_sync(args: argparse.Namespace) -> int:
    route = discover_route(args.repository)
    if route["mode"] == "ROUTING_BLOCKED":
        print(json.dumps(route, ensure_ascii=False), file=sys.stderr)
        return 2
    if route["mode"] != "CURRENT_VERSION":
        print(json.dumps(route, ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.branch and args.branch != route["target_branch"]:
        print(
            json.dumps(
                {
                    "mode": "NOT_TARGET_BRANCH",
                    "requested_branch": args.branch,
                    "target_branch": route["target_branch"],
                    "target_version": route["target_version"],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )
        return 0

    queue = build_queue(_gh_open_issues(args.repository), route)
    changed = _write_json(Path(args.write), queue)
    print(
        json.dumps(
            {
                "mode": route["mode"],
                "target_branch": route["target_branch"],
                "target_version": route["target_version"],
                "issue_count": len(queue["issues"]),
                "changed": changed,
                "queue_path": args.write,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    return 0


def command_next(args: argparse.Namespace) -> int:
    queue_path = Path(args.queue)
    if not queue_path.exists():
        raise IntakeError(f"queue file does not exist: {queue_path}")
    queue = json.loads(queue_path.read_text(encoding="utf-8"))
    issues = queue.get("issues") or []
    if not issues:
        print(json.dumps({"status": "EMPTY"}, separators=(",", ":")))
        return 0
    issue_number = int(issues[0]["issue_number"])
    output = _run(
        [
            "gh",
            "issue",
            "view",
            str(issue_number),
            "--repo",
            args.repository,
            "--json",
            "number,title,body,url,state",
        ]
    )
    sys.stdout.write(output)
    if not output.endswith("\n"):
        sys.stdout.write("\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    route = sub.add_parser("route", help="Resolve the active version branch or next-version queue")
    route.add_argument("--repository", default="Simple-Connection/sctool-registry")
    route.set_defaults(func=command_route)

    sync = sub.add_parser("sync", help="Synchronize open Registry SDK reports into the active branch queue")
    sync.add_argument("--repository", default="Simple-Connection/sctool-registry")
    sync.add_argument("--branch", default=None)
    sync.add_argument("--write", default=".github/registry-sdk-issue-queue.json")
    sync.set_defaults(func=command_sync)

    nxt = sub.add_parser("next", help="Print the highest-priority queued issue for a coding agent")
    nxt.add_argument("--repository", default="Simple-Connection/sctool-registry")
    nxt.add_argument("--queue", default=".github/registry-sdk-issue-queue.json")
    nxt.set_defaults(func=command_next)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (IntakeError, OSError, json.JSONDecodeError) as exc:
        print(f"registry issue intake error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
