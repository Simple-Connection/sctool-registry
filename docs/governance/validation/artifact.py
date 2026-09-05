from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    lifecycle = ctx.staged_artifact_lifecycle
    candidate = ctx.update_candidate_contract
    responsibilities = ctx.responsibilities["responsibilities"]

    scan_machine(lifecycle, "docs/rules/staged-artifact-lifecycle-v1.yaml", errors)
    scan_machine(candidate, "docs/rules/update-candidate-v1.yaml", errors)

    need(
        lifecycle.get("contract_id") == "STAGED_ARTIFACT_LIFECYCLE_V1",
        "STAGED_ARTIFACT_CONTRACT_ID",
        errors,
    )
    states = lifecycle.get("states", [])
    need(len(states) == len(set(states)), "STAGED_ARTIFACT_STATE_DUPLICATE", errors)
    state_set = set(states)
    initial = lifecycle.get("initial_state")
    terminals = set(lifecycle.get("terminal_states", []))
    need(initial in state_set, f"STAGED_ARTIFACT_INITIAL:{initial}", errors)
    need(bool(terminals) and terminals <= state_set, "STAGED_ARTIFACT_TERMINALS", errors)

    transitions = lifecycle.get("transitions", [])
    transition_ids = [entry.get("id") for entry in transitions]
    need(len(transition_ids) == len(set(transition_ids)), "STAGED_ARTIFACT_TRANSITION_DUPLICATE", errors)
    graph = {state: set() for state in states}
    for entry in transitions:
        source = entry.get("from")
        target = entry.get("to")
        owner = entry.get("owner")
        need(source in state_set, f"STAGED_ARTIFACT_FROM:{source}", errors)
        need(target in state_set, f"STAGED_ARTIFACT_TO:{target}", errors)
        need(owner in responsibilities, f"STAGED_ARTIFACT_OWNER:{owner}", errors)
        if source in graph and target in state_set:
            graph[source].add(target)

    for terminal in terminals:
        need(not graph.get(terminal), f"STAGED_ARTIFACT_TERMINAL_OUTGOING:{terminal}", errors)

    reachable = set()
    frontier = [initial] if initial in state_set else []
    while frontier:
        state = frontier.pop()
        if state in reachable:
            continue
        reachable.add(state)
        frontier.extend(graph.get(state, set()) - reachable)
    need(reachable == state_set, "STAGED_ARTIFACT_UNREACHABLE_STATE", errors)

    def reaches_terminal(start: str) -> bool:
        seen = set()
        stack = [start]
        while stack:
            state = stack.pop()
            if state in terminals:
                return True
            if state in seen:
                continue
            seen.add(state)
            stack.extend(graph.get(state, set()) - seen)
        return False

    for state in state_set - terminals:
        need(reaches_terminal(state), f"STAGED_ARTIFACT_NO_DISPOSAL_PATH:{state}", errors)

    need(
        candidate.get("contract_id") == "UPDATE_CANDIDATE_V1",
        "UPDATE_CANDIDATE_CONTRACT_ID",
        errors,
    )
    required = candidate.get("required_fields", [])
    forbidden = candidate.get("forbidden_fields", [])
    need(len(required) == len(set(required)), "UPDATE_CANDIDATE_REQUIRED_DUPLICATE", errors)
    need(len(forbidden) == len(set(forbidden)), "UPDATE_CANDIDATE_FORBIDDEN_DUPLICATE", errors)
    need(not (set(required) & set(forbidden)), "UPDATE_CANDIDATE_FIELD_OVERLAP", errors)
    artifact = candidate.get("artifact", {})
    need(
        artifact.get("type") == "VERIFIED_ARTIFACT_LEASE",
        "UPDATE_CANDIDATE_ARTIFACT_TYPE",
        errors,
    )
    need(
        artifact.get("raw_path") == "FORBIDDEN",
        "UPDATE_CANDIDATE_RAW_PATH",
        errors,
    )
    need(
        artifact.get("write_access") == "FORBIDDEN",
        "UPDATE_CANDIDATE_WRITE_ACCESS",
        errors,
    )
    need(
        artifact.get("disposed_access") == "FORBIDDEN",
        "UPDATE_CANDIDATE_DISPOSED_ACCESS",
        errors,
    )
