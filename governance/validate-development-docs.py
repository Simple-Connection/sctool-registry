#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

SAFE = re.compile(r"^[A-Za-z0-9_./:@{}*+<>|?=\-\[\]]+$")
PLAN_STATE = {
    "COMPLETE": "CLOSED",
    "AWAITING_APPROVAL": "AWAITING_APPROVAL",
    "NOT_APPROVED": "AWAITING_APPROVAL",
}


class DocError(Exception):
    pass


def load(root: Path, rel: str) -> dict[str, Any]:
    path = root / rel
    if not path.is_file():
        raise DocError(f"MISSING_FILE:{rel}")
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise DocError(f"YAML_PARSE:{rel}:{exc}") from exc
    if not isinstance(value, dict):
        raise DocError(f"YAML_ROOT:{rel}")
    return value


def machine_safe(value: str) -> bool:
    return " " not in value and "\n" not in value and "\t" not in value and bool(SAFE.fullmatch(value))


def scan_machine(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or not machine_safe(key):
                errors.append(f"NATURAL_LANGUAGE_KEY:{path}:{key!r}")
            scan_machine(child, f"{path}.{key}", errors)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_machine(child, f"{path}[{index}]", errors)
    elif isinstance(value, str) and not machine_safe(value):
        errors.append(f"NATURAL_LANGUAGE_VALUE:{path}:{value!r}")


def need(ok: bool, code: str, errors: list[str]) -> None:
    if not ok:
        errors.append(code)


def current_branch(root: Path) -> str | None:
    try:
        p = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return None
    value = p.stdout.strip()
    return value or None


def derive(doc: dict[str, Any]) -> str:
    if doc["session"]["approval"] != "APPROVED":
        return "AWAITING_APPROVAL"
    units = doc.get("work_units", [])
    gates = [g for g in doc.get("gates", []) if g.get("required") is True]
    if doc.get("blockers"):
        return "BLOCKED"
    if any(u.get("status") == "BLOCKED" for u in units):
        return "BLOCKED"
    if any(g.get("status") in {"BLOCKED", "FAIL"} for g in gates):
        return "BLOCKED"
    if units and gates and all(u.get("status") == "COMPLETE" for u in units) and all(g.get("status") == "PASS" for g in gates):
        return "CLOSED"
    return "ACTIVE"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    errors: list[str] = []

    index = load(root, "docs/index.yaml")
    plan_path = index["current"]["improvement_plan"]
    plan = load(root, plan_path)
    tindex = load(root, "docs/template/index.yaml")
    rindex_path = index["responsibility_index"]
    rindex = load(root, rindex_path)

    routes = rindex["routes"]
    authorities = load(root, routes["authorities"])
    vocabulary = load(root, routes["vocabulary"])
    contracts = load(root, routes["contracts"])
    responsibilities = load(root, routes["responsibilities"])
    descriptions = load(root, routes["descriptions"])
    gate_registry = load(root, routes["gates"])

    machine_docs = {
        "docs/index.yaml": index,
        plan_path: plan,
        "docs/template/index.yaml": tindex,
        "docs/template/improvement_plan.yaml": load(root, "docs/template/improvement_plan.yaml"),
        "docs/template/session_document_template/session_document_essential.yaml": load(root, "docs/template/session_document_template/session_document_essential.yaml"),
        rindex_path: rindex,
        routes["authorities"]: authorities,
        routes["vocabulary"]: vocabulary,
        routes["contracts"]: contracts,
        routes["responsibilities"]: responsibilities,
        routes["gates"]: gate_registry,
    }
    for rel, doc in machine_docs.items():
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, rel, errors)

    need(index["current"]["distribution_contract_version"] == plan["version"]["distribution_contract_version"], "INDEX_PLAN_VERSION", errors)
    need(index["current"]["branch"] == plan["version"]["branch"], "INDEX_PLAN_BRANCH", errors)
    need(tindex["responsibility_index"] == rindex_path, "TEMPLATE_RESPONSIBILITY_ROUTE", errors)

    branch = current_branch(root)
    if branch:
        need(branch == plan["version"]["branch"], f"GIT_BRANCH:{branch}:{plan['version']['branch']}", errors)

    repos = authorities["repositories"]
    components = authorities["components"]
    auths = authorities["authorities"]
    contract_map = contracts["contracts"]
    vocab = {key: set(values) for key, values in vocabulary["dimensions"].items()}
    resp_map = responsibilities["responsibilities"]
    description_map = descriptions.get("descriptions", {})
    ownership_policy = responsibilities.get("ownership_policy", {})
    gate_ids = set(gate_registry["gates"])

    for cid, c in contract_map.items():
        need((root / c["path"]).is_file(), f"CONTRACT_PATH:{cid}:{c['path']}", errors)

    for aid, a in auths.items():
        need(a["repository_id"] in repos, f"AUTH_REPO:{aid}", errors)
        need(a["component_id"] in components, f"AUTH_COMPONENT:{aid}", errors)

    dimensions = {
        "authority_domain": "authority_domain",
        "lifecycle_phase": "lifecycle_phase",
        "operation": "operation",
        "relation": "relation",
        "ownership": "ownership",
        "normative": "normative",
        "state": "responsibility_state",
    }
    for rid, r in resp_map.items():
        need(r["subject"] in auths, f"RESP_SUBJECT:{rid}", errors)
        for field, dim in dimensions.items():
            need(r[field] in vocab[dim], f"RESP_DIM:{rid}:{field}:{r[field]}", errors)
        need(r["object"]["class"] in vocab["object_class"], f"RESP_OBJECT_CLASS:{rid}", errors)
        need(r["object"]["subtype"] in vocab["object_subtype"], f"RESP_OBJECT_SUBTYPE:{rid}", errors)
        need(r["scope"]["repository_id"] in repos, f"RESP_SCOPE_REPO:{rid}", errors)
        need(r["scope"]["component_id"] in components, f"RESP_SCOPE_COMPONENT:{rid}", errors)
        for cref in r.get("contract_refs", []):
            need(cref in contract_map, f"RESP_CONTRACT:{rid}:{cref}", errors)
        transfer = r["transfer"]
        need(transfer["state"] in vocab["transfer_state"], f"RESP_TRANSFER:{rid}", errors)
        need(transfer["predecessor_retirement"] in vocab["retirement_state"], f"RESP_RETIREMENT:{rid}", errors)
        for field in ("from_authority_id", "to_authority_id"):
            ref = transfer.get(field)
            need(ref is None or ref in auths, f"RESP_TRANSFER_AUTH:{rid}:{field}:{ref}", errors)
        desc = r.get("responsibility_description_id")
        need(desc is None or desc in description_map, f"RESP_DESCRIPTION:{rid}:{desc}", errors)
        subject = auths.get(r["subject"], {})
        need(subject.get("component_id") == r["scope"]["component_id"], f"RESP_OWNER_COMPONENT:{rid}", errors)
        rules = ownership_policy.get(r["subject"])
        if rules:
            need(rid in rules.get("allow", []), f"RESP_OWNER_ALLOW:{rid}:{r['subject']}", errors)

    for aid, rules in ownership_policy.items():
        need(aid in auths, f"POLICY_AUTH:{aid}", errors)
        allow = set(rules.get("allow", []))
        deny = set(rules.get("deny", []))
        need(not (allow & deny), f"POLICY_OVERLAP:{aid}", errors)
        for rid in allow | deny:
            need(rid in resp_map, f"POLICY_RESP:{aid}:{rid}", errors)

    version = plan["version"]["distribution_contract_version"]
    plan_sessions = {s["id"]: s for s in plan["sessions"]}
    index_sessions = {s["id"]: s for s in index["versions"][version]["sessions"]}
    need(set(plan_sessions) >= {"P1", "P2", "P3"}, "PLAN_SESSIONS", errors)
    need(set(index_sessions) >= {"P1", "P2", "P3"}, "INDEX_SESSIONS", errors)

    for sid, ps in plan_sessions.items():
        for rid in ps.get("responsibility_refs", []):
            need(rid in resp_map, f"PLAN_RESP:{sid}:{rid}", errors)
        ix = index_sessions.get(sid)
        if ix:
            need(ix["state"] == ps["state"], f"INDEX_STATE:{sid}", errors)
            need(ix.get("document") == ps.get("document"), f"INDEX_DOCUMENT:{sid}", errors)

        rel = ps.get("document")
        if rel is None:
            need(ps["approval"] != "APPROVED", f"APPROVED_WITHOUT_DOC:{sid}", errors)
            need(ps["state"] in {"AWAITING_APPROVAL", "NOT_APPROVED"}, f"UNMATERIALIZED_STATE:{sid}", errors)
            continue

        doc = load(root, rel)
        if doc.get("natural_language") == "FORBIDDEN":
            scan_machine(doc, rel, errors)
        need(doc.get("document_type") == "machine_session", f"SESSION_TYPE:{sid}", errors)
        need(doc["session"]["id"] == sid, f"SESSION_ID:{sid}", errors)
        need(doc["session"]["type"] == ps["type"], f"SESSION_TEMPLATE_TYPE:{sid}", errors)
        need(doc["session"]["approval"] == ps["approval"], f"SESSION_APPROVAL:{sid}", errors)
        need(doc["session"]["distribution_contract_version"] == version, f"SESSION_VERSION:{sid}", errors)
        need(doc["session"]["branch"] == plan["version"]["branch"], f"SESSION_BRANCH:{sid}", errors)
        need(doc["session"]["improvement_plan"] == plan_path, f"SESSION_PLAN:{sid}", errors)
        need(doc["routing"]["responsibility_index"] == rindex_path, f"SESSION_RESP_ROUTE:{sid}", errors)
        need(doc["state"] == {"mode": "DERIVED", "ruleset": "SESSION_STATE_V1"}, f"SESSION_STATE_MODE:{sid}", errors)

        evidence = doc.get("evidence", [])
        evidence_ids = {e["id"] for e in evidence}
        need(len(evidence_ids) == len(evidence), f"EVIDENCE_DUPLICATE:{sid}", errors)

        used: set[str] = set()
        for effect, refs in doc.get("responsibility_model", {}).get("effects", {}).items():
            for rid in refs:
                need(rid in resp_map, f"SESSION_RESP:{sid}:{effect}:{rid}", errors)
                used.add(rid)
        for unit in doc.get("work_units", []):
            for rid in unit.get("responsibility_refs", []):
                need(rid in resp_map, f"WORK_RESP:{sid}:{unit['id']}:{rid}", errors)
                used.add(rid)

        for gate in doc.get("gates", []):
            need(gate["id"] in gate_ids, f"GATE_ID:{sid}:{gate['id']}", errors)
            if gate["status"] == "PASS":
                need(bool(gate.get("evidence_refs")), f"GATE_NO_EVIDENCE:{sid}:{gate['id']}", errors)
            for eid in gate.get("evidence_refs", []):
                need(eid in evidence_ids, f"GATE_EVIDENCE:{sid}:{gate['id']}:{eid}", errors)

        expected = PLAN_STATE.get(ps["state"])
        if expected:
            actual = derive(doc)
            need(actual == expected, f"DERIVED_STATE:{sid}:{actual}:{expected}", errors)

        for rid in ps.get("responsibility_refs", []):
            need(rid in used, f"PLAN_RESP_UNUSED:{sid}:{rid}", errors)

    p3 = plan_sessions["P3"]
    need(p3["state"] == "AWAITING_APPROVAL", "P3_STATE", errors)
    need(p3["approval"] == "REQUIRED", "P3_APPROVAL", errors)
    need(p3["document"] is None, "P3_DOCUMENT", errors)
    need(index["current"]["current_session"] is None, "CURRENT_SESSION", errors)
    need(index["current"]["next_session"]["id"] == "P3", "NEXT_SESSION_ID", errors)
    need(index["current"]["next_session"]["state"] == "AWAITING_APPROVAL", "NEXT_SESSION_STATE", errors)

    if errors:
        for error in errors:
            print(f"ERROR {error}")
        print(f"Development docs validation FAIL errors={len(errors)}")
        return 1

    print(
        "Development docs validation PASS "
        f"versions={len(index['versions'])} "
        f"sessions={len(plan_sessions)} "
        f"responsibilities={len(resp_map)} "
        f"gates={len(gate_ids)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
