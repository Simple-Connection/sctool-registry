from __future__ import annotations

from typing import Any


def derive_session_state(doc: dict[str, Any], state_rules: dict[str, Any]) -> str:
    rules = state_rules["derivation"]
    if doc["session"]["approval"] != rules["approved_value"]:
        return rules["unapproved_state"]

    work_units = doc.get("work_units", [])
    required_gates = [gate for gate in doc.get("gates", []) if gate.get("required") is True]

    if doc.get("blockers"):
        return rules["blocked_state"]
    if any(unit.get("status") in set(rules["blocking_work_unit_statuses"]) for unit in work_units):
        return rules["blocked_state"]
    if any(gate.get("status") in set(rules["blocking_gate_statuses"]) for gate in required_gates):
        return rules["blocked_state"]

    work_units_ready = all(
        unit.get("status") == rules["closed_work_unit_status"] for unit in work_units
    )
    gates_ready = all(
        gate.get("status") == rules["closed_gate_status"] for gate in required_gates
    )

    if rules["require_nonempty_work_units_for_closed"] and not work_units:
        work_units_ready = False
    if rules["require_nonempty_required_gates_for_closed"] and not required_gates:
        gates_ready = False

    if work_units_ready and gates_ready:
        return rules["closed_state"]
    return rules["fallback_state"]
