#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from ptsip.inspection.dependencies_030 import scan_dependency_edges
from ptsip.model import EvidenceNodeScope, ResolutionStatus


PRODUCER_ID = "sctool-registry-deterministic-dependency-observer"
PRODUCER_VERSION = "2"

JS_TO_SOURCE_EXTENSIONS = {
    ".js": (".ts", ".mts", ".cts"),
    ".mjs": (".mts", ".ts"),
    ".cjs": (".cts", ".ts"),
}
SOURCE_EXTENSIONS = (".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs")
_REQUIREMENT_NAME_RE = re.compile(r"^([A-Za-z0-9_.-]+)")


def load_json(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("validation document root must be an object")
    return value


def tracked_repository_paths(repo_root: Path) -> set[str]:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    return {
        item.decode("utf-8")
        for item in result.stdout.split(b"\0")
        if item
    }


def tracked_file(repo_root: Path, candidate: Path, tracked: set[str]) -> str | None:
    try:
        resolved = candidate.resolve()
        if not resolved.is_relative_to(repo_root):
            return None
        relative = resolved.relative_to(repo_root).as_posix()
    except (OSError, ValueError):
        return None
    return relative if relative in tracked and resolved.is_file() else None


def resolve_project_candidate(
    repo_root: Path,
    candidate: Path,
    tracked: set[str],
) -> str | None:
    exact = tracked_file(repo_root, candidate, tracked)
    if exact:
        return exact

    suffix = candidate.suffix.lower()
    for replacement in JS_TO_SOURCE_EXTENSIONS.get(suffix, ()):
        resolved = tracked_file(repo_root, candidate.with_suffix(replacement), tracked)
        if resolved:
            return resolved

    if not suffix:
        for extension in SOURCE_EXTENSIONS:
            resolved = tracked_file(repo_root, Path(str(candidate) + extension), tracked)
            if resolved:
                return resolved

    for extension in SOURCE_EXTENSIONS:
        resolved = tracked_file(repo_root, candidate / f"index{extension}", tracked)
        if resolved:
            return resolved
    return None


def resolve_generated_relative_import(
    repo_root: Path,
    source: str,
    target: str,
    tracked: set[str],
) -> str | None:
    if not target.startswith(("./", "../")):
        return None

    source_path = repo_root / source
    candidate = (source_path.parent / target).resolve()

    direct = resolve_project_candidate(repo_root, candidate, tracked)
    if direct:
        return direct

    try:
        relative = candidate.relative_to(repo_root)
    except ValueError:
        return None

    parts = list(relative.parts)
    dist_positions = [index for index, part in enumerate(parts) if part == "dist"]
    for index in reversed(dist_positions):
        source_parts = list(parts)
        source_parts[index] = "src"
        mapped = resolve_project_candidate(repo_root, repo_root.joinpath(*source_parts), tracked)
        if mapped:
            return mapped

    return None


def normalize_dependency_name(value: str) -> str:
    return re.sub(r"[-.]", "_", value.strip().lower())


def package_local_requirements_declare(
    repo_root: Path,
    source: str,
    target: str,
    tracked: set[str],
) -> bool:
    root_name = target.lstrip(".").split(".", 1)[0]
    if not root_name:
        return False

    wanted = normalize_dependency_name(root_name)
    current = (repo_root / source).parent.resolve()

    while True:
        try:
            if not current.is_relative_to(repo_root):
                return False
        except (OSError, ValueError):
            return False

        candidates = sorted(current.glob("requirements*.txt")) + sorted(current.glob("requirements*.in"))
        for requirements in candidates:
            try:
                relative = requirements.relative_to(repo_root).as_posix()
            except ValueError:
                continue
            if relative not in tracked:
                continue
            try:
                lines = requirements.read_text(encoding="utf-8-sig").splitlines()
            except (OSError, UnicodeError):
                continue

            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith(
                    ("#", "-r", "--requirement", "-c", "--constraint", "-e", "--editable")
                ):
                    continue
                match = _REQUIREMENT_NAME_RE.match(stripped)
                if match and normalize_dependency_name(match.group(1)) == wanted:
                    return True

        if current == repo_root:
            break
        current = current.parent

    return False


def node_builtin_modules() -> set[str]:
    script = (
        "const { builtinModules } = require('node:module');"
        "process.stdout.write(JSON.stringify(builtinModules));"
    )
    result = subprocess.run(
        ["node", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    if not isinstance(payload, list):
        raise ValueError("Node builtinModules result must be an array")
    modules = {str(item) for item in payload}
    modules.update(f"node:{item}" for item in list(modules) if not item.startswith("node:"))
    modules.update({"test", "node:test"})
    return modules


def evidence_entry(
    edge,
    *,
    resolved_path: str | None = None,
    external_scope: str = "PLATFORM",
) -> dict[str, object]:
    identity = resolved_path or external_scope
    material = "\n".join((edge.evidence_id, edge.source, edge.target, identity))
    payload: dict[str, object] = {
        "kind": "dependency",
        "evidence_id": "registry-dependency:" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:20],
        "source": edge.source,
        "target": edge.target,
        "relationship_type": edge.edge_type.value,
        "phase": edge.phase.value,
        "resolution": "RESOLVED" if resolved_path else "EXTERNAL",
        "target_scope": "PROJECT_COMPONENT" if resolved_path else external_scope,
        "provenance": "OBSERVED",
    }
    if resolved_path:
        payload["resolved_path"] = resolved_path
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validation", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()

    repo_root = Path(".").resolve()
    validation = load_json(Path(args.validation))
    if validation.get("valid") is not True:
        raise ValueError("PTSIP validation payload must be valid before dependency evidence is generated")

    scan = scan_dependency_edges(repo_root)
    if scan.issues:
        raise ValueError(
            "PTSIP dependency scan has unresolved collection issues: "
            + "; ".join(f"{item.adapter}:{item.path}:{item.message}" for item in scan.issues)
        )

    builtins = node_builtin_modules()
    tracked = tracked_repository_paths(repo_root)
    evidence: list[dict[str, object]] = []
    unrecognized_node: list[str] = []
    platform_count = 0
    project_count = 0
    package_count = 0

    for edge in scan.edges:
        if edge.resolution != ResolutionStatus.UNRESOLVED:
            continue
        if edge.target_scope != EvidenceNodeScope.UNRESOLVED_TARGET:
            continue

        target = edge.target

        if target.startswith("node:"):
            if target not in builtins and target.removeprefix("node:") not in builtins:
                unrecognized_node.append(target)
                continue
            evidence.append(evidence_entry(edge))
            platform_count += 1
            continue

        if package_local_requirements_declare(repo_root, edge.source, target, tracked):
            evidence.append(evidence_entry(edge, external_scope="EXTERNAL_DEPENDENCY"))
            package_count += 1
            continue

        resolved_path = resolve_generated_relative_import(
            repo_root,
            edge.source,
            target,
            tracked,
        )
        if resolved_path:
            evidence.append(evidence_entry(edge, resolved_path=resolved_path))
            project_count += 1

    if unrecognized_node:
        raise ValueError(
            "unrecognized node: imports cannot be classified as PLATFORM: "
            + ",".join(sorted(set(unrecognized_node)))
        )

    evidence.sort(key=lambda item: (str(item["source"]), str(item["target"]), str(item["evidence_id"])))
    output = {
        "format": "ptsip-external-evidence/v1",
        "producer": {"id": PRODUCER_ID, "version": PRODUCER_VERSION},
        "subject": {
            "repository": args.repository,
            "revision": args.revision,
        },
        "evidence": evidence,
    }
    Path(args.out).write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "PTSIP deterministic dependency evidence PASS "
        f"edges={len(evidence)} platform={platform_count} "
        f"project={project_count} external_dependency={package_count}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
