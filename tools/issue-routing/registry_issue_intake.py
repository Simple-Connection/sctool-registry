#!/usr/bin/env python3
"""Route Registry SDK and Product/package reports into the active Registry version queue.

GitHub Issues remain the source of truth. The tracked queue stores only stable,
copy-safe machine identifiers needed by coding agents to select work for the active
dev/<semver> branch. Product reports use a separate marker/schema and never overload
the Registry Client SDK defect report contract.
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

SDK_REPORT_MARKER_START = "<!-- sctool-registry-sdk-report:v1"
PRODUCT_REPORT_MARKER_START = "<!-- sctool-registry-product-report:v1"
REPORT_MARKER_START = SDK_REPORT_MARKER_START  # Backward-compatible public constant.
REPORT_MARKER_END = "-->"
QUEUE_SCHEMA = "sctool-registry-sdk-issue-queue/v1"
SDK_REPORT_SCHEMA = "sctool-registry-sdk-report/v1"
PRODUCT_REPORT_SCHEMA = "sctool-registry-product-report/v1"
REPORT_SCHEMA = SDK_REPORT_SCHEMA  # Backward-compatible public constant.
DEV_BRANCH_RE = re.compile(r"^dev/(\d+)\.(\d+)\.(\d+)$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
REPORT_ID_RE = re.compile(r"^[A-Za-z0-9._:@/+\-]+$")
FAILURE_CODE_RE = re.compile(r"^[A-Z0-9_]+$")
TERMINAL_VERSION_STATES = {
    "COMPLETE",
    "CLOSED",
    "HISTORICAL_COMPLETE",
    "MERGED",
    "RELEASED",
}
SEVERITY_ORDER = {"BLOCKER": 0, "HIGH": 1, "NORMAL": 2, "LOW": 3}
PRODUCT_KINDS = {
    "VALIDATION_FAILURE",
    "REGISTRATION_FAILURE",
    "DISCOVERY_FAILURE",
    "PACKAGE_CONTRACT",
    "INTEGRATION_BLOCKER",
    "OTHER",
}
PRODUCT_OPERATIONS = {
    "MARKETPLACE_VALIDATION",
    "MARKETPLACE_REGISTRATION",
    "REGISTRY_DISCOVERY",
    "PACKAGE_RESOLUTION",
    "PACKAGE_DELIVERY",
    "OTHER",
}
PRODUCT_SDK_PACKAGES = {
    "@simple-connection/sctool-sdk",
    "@simple-connection/sctool-registry-client-sdk",
}
COPY_UNSAFE_VALUE_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b", re.IGNORECASE),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)


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


def _require_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise IntakeError(f"{label} must be an object")
    return value


def _reject_unknown(mapping: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise IntakeError(f"{label} contains unsupported fields: {unknown}")


def _require_fields(mapping: dict[str, Any], required: set[str], label: str) -> None:
    missing = sorted(key for key in required if key not in mapping)
    if missing:
        raise IntakeError(f"{label} is missing required fields: {missing}")


def _string(
    mapping: dict[str, Any],
    key: str,
    label: str,
    *,
    minimum: int = 1,
    maximum: int = 1200,
    pattern: re.Pattern[str] | None = None,
) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise IntakeError(f"{label}.{key} must be a string")
    if len(value) < minimum or len(value) > maximum:
        raise IntakeError(f"{label}.{key} length must be between {minimum} and {maximum}")
    if pattern and not pattern.fullmatch(value):
        raise IntakeError(f"{label}.{key} has invalid format")
    return value


def _copy_safe(value: Any, path: str = "report") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lowered = key.lower().replace("-", "_")
            if any(token in lowered for token in ("secret", "token", "credential", "password", "authorization", "private_key", "client_secret")):
                raise IntakeError(f"copy-unsafe field is forbidden: {path}.{key}")
            if lowered in {"log", "logs", "raw_log", "raw_logs", "stdout", "stderr", "environment", "env"}:
                raise IntakeError(f"raw log/environment field is forbidden: {path}.{key}")
            _copy_safe(child, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _copy_safe(child, f"{path}[{index}]")
        return
    if isinstance(value, str):
        for pattern in COPY_UNSAFE_VALUE_PATTERNS:
            if pattern.search(value):
                raise IntakeError(f"copy-unsafe credential pattern detected at {path}")


def validate_product_report(data: dict[str, Any]) -> dict[str, Any]:
    top_allowed = {"schema", "report_id", "kind", "severity", "fingerprint", "source", "package", "failure", "sdk"}
    _reject_unknown(data, top_allowed, "product report")
    _require_fields(data, {"schema", "report_id", "kind", "severity", "source", "failure"}, "product report")
    if data.get("schema") != PRODUCT_REPORT_SCHEMA:
        raise IntakeError(f"unsupported Product report schema: {data.get('schema')!r}")
    _string(data, "report_id", "product report", maximum=160, pattern=REPORT_ID_RE)
    if data.get("kind") not in PRODUCT_KINDS:
        raise IntakeError(f"unsupported Product report kind: {data.get('kind')!r}")
    if data.get("severity") not in SEVERITY_ORDER:
        raise IntakeError(f"unsupported Product report severity: {data.get('severity')!r}")
    if "fingerprint" in data:
        _string(data, "fingerprint", "product report", maximum=160, pattern=REPORT_ID_RE)

    source = _require_mapping(data.get("source"), "product report.source")
    _reject_unknown(source, {"repository", "branch", "head", "session", "work_item"}, "product report.source")
    _require_fields(source, {"repository", "branch", "head"}, "product report.source")
    repository = _string(source, "repository", "product report.source", maximum=200)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise IntakeError("product report.source.repository has invalid format")
    _string(source, "branch", "product report.source", maximum=240)
    _string(source, "head", "product report.source", maximum=40, pattern=SHA_RE)
    if "session" in source:
        _string(source, "session", "product report.source", maximum=80)
    if "work_item" in source:
        _string(source, "work_item", "product report.source", maximum=80)

    package = data.get("package")
    if package is not None:
        package = _require_mapping(package, "product report.package")
        _reject_unknown(package, {"id", "version", "artifact_sha256", "profile_schema_version"}, "product report.package")
        for key in ("id", "version", "profile_schema_version"):
            if key in package:
                _string(package, key, "product report.package", maximum=200 if key == "id" else 120)
        if "artifact_sha256" in package:
            artifact = _string(package, "artifact_sha256", "product report.package", maximum=64)
            if not re.fullmatch(r"[0-9a-f]{64}", artifact):
                raise IntakeError("product report.package.artifact_sha256 has invalid format")

    failure = _require_mapping(data.get("failure"), "product report.failure")
    _reject_unknown(failure, {"operation", "code", "path", "observed", "expected", "repair_hint", "evidence_ref"}, "product report.failure")
    _require_fields(failure, {"operation", "code", "path", "observed", "expected"}, "product report.failure")
    if failure.get("operation") not in PRODUCT_OPERATIONS:
        raise IntakeError(f"unsupported Product report operation: {failure.get('operation')!r}")
    _string(failure, "code", "product report.failure", maximum=160, pattern=FAILURE_CODE_RE)
    _string(failure, "path", "product report.failure", maximum=300)
    _string(failure, "observed", "product report.failure", maximum=1200)
    _string(failure, "expected", "product report.failure", maximum=1200)
    if "repair_hint" in failure:
        _string(failure, "repair_hint", "product report.failure", maximum=1200)
    if "evidence_ref" in failure:
        _string(failure, "evidence_ref", "product report.failure", maximum=500)

    sdk = data.get("sdk")
    if sdk is not None:
        sdk = _require_mapping(sdk, "product report.sdk")
        _reject_unknown(sdk, {"package", "version", "contract"}, "product report.sdk")
        if "package" in sdk and sdk.get("package") not in PRODUCT_SDK_PACKAGES:
            raise IntakeError(f"unsupported Product report SDK package: {sdk.get('package')!r}")
        for key in ("version", "contract"):
            if key in sdk:
                _string(sdk, key, "product report.sdk", maximum=160)

    _copy_safe(data)
    return data


def _extract_marker(body: str) -> tuple[str, str] | None:
    matches: list[tuple[int, str, str]] = []
    for report_kind, marker in (("SDK", SDK_REPORT_MARKER_START), ("PRODUCT_PACKAGE", PRODUCT_REPORT_MARKER_START)):
        start = body.find(marker)
        if start >= 0:
            matches.append((start, report_kind, marker))
    if not matches:
        return None
    if len(matches) > 1:
        raise IntakeError("issue body contains multiple Registry report marker kinds")
    start, report_kind, marker = matches[0]
    payload_start = start + len(marker)
    end = body.find(REPORT_MARKER_END, payload_start)
    if end < 0:
        raise IntakeError(f"Registry {report_kind} report marker is not closed")
    return report_kind, body[payload_start:end].strip()


def parse_report(body: str) -> dict[str, Any] | None:
    extracted = _extract_marker(body)
    if extracted is None:
        return None
    report_kind, raw = extracted
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise IntakeError(f"Registry {report_kind} report marker does not contain valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise IntakeError(f"Registry {report_kind} report payload must be a JSON object")
    if report_kind == "SDK":
        if data.get("schema") != SDK_REPORT_SCHEMA:
            raise IntakeError(f"unsupported report schema: {data.get('schema')!r}")
        if not data.get("report_id"):
            raise IntakeError("Registry SDK report is missing report_id")
        return data
    return validate_product_report(data)


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
        if report.get("schema") == PRODUCT_REPORT_SCHEMA:
            package = report.get("package") or {}
            failure = report.get("failure") or {}
            sdk = report.get("sdk") or {}
            item = {
                "issue_number": int(issue["number"]),
                "report_kind": "PRODUCT_PACKAGE",
                "report_id": str(report["report_id"]),
                "kind": str(report.get("kind") or "OTHER"),
                "severity": str(report.get("severity") or "NORMAL"),
                "source_repository": str(source.get("repository") or ""),
                "source_branch": str(source.get("branch") or ""),
                "source_head": str(source.get("head") or ""),
                "product_fingerprint": str(report.get("fingerprint") or ""),
                "package_id": str(package.get("id") or ""),
                "package_version": str(package.get("version") or ""),
                "profile_schema_version": str(package.get("profile_schema_version") or ""),
                "failure_operation": str(failure.get("operation") or ""),
                "failure_code": str(failure.get("code") or ""),
                "failure_path": str(failure.get("path") or ""),
                "sdk_package": str(sdk.get("package") or ""),
                "sdk_version": str(sdk.get("version") or ""),
                "sdk_contract": str(sdk.get("contract") or ""),
            }
        else:
            sdk = report.get("sdk") or {}
            item = {
                "issue_number": int(issue["number"]),
                "report_kind": "SDK",
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

    sync = sub.add_parser("sync", help="Synchronize open Registry reports into the active branch queue")
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
