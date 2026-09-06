from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    lifecycle = ctx.staged_artifact_lifecycle
    candidate = ctx.update_candidate_contract
    responsibilities = ctx.responsibilities["responsibilities"]

    scan_machine(lifecycle, "docs/STAGED_ARTIFACT_LIFECYCLE_V1.yaml", errors)
    scan_machine(candidate, "docs/UPDATE_CANDIDATE_V1.yaml", errors)

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
    observation = candidate.get("installation_observation", {})
    need(
        observation.get("type") == "CONSUMER_INSTALLATION_OBSERVATION",
        "UPDATE_CANDIDATE_OBSERVATION_TYPE",
        errors,
    )
    need(
        observation.get("authority") == "AUTH_SIMPLE_CONNECTION_DESKTOP",
        "UPDATE_CANDIDATE_OBSERVATION_AUTHORITY",
        errors,
    )
    need(
        observation.get("access") == "READ_ONLY",
        "UPDATE_CANDIDATE_OBSERVATION_ACCESS",
        errors,
    )
    need(
        set(observation.get("required_fields", []))
        == {"authority", "packageId", "targetKey", "installedVersion"},
        "UPDATE_CANDIDATE_OBSERVATION_FIELDS",
        errors,
    )
    need(
        observation.get("additional_fields") == "FORBIDDEN",
        "UPDATE_CANDIDATE_OBSERVATION_ADDITIONAL_FIELDS",
        errors,
    )
    need(
        observation.get("installed_version_role") == "INPUT_ONLY",
        "UPDATE_CANDIDATE_INSTALLED_VERSION_ROLE",
        errors,
    )

    precedence = candidate.get("version_precedence", {})
    need(precedence.get("grammar") == "PACKAGE_SCHEMA_V2_SEMVER", "UPDATE_CANDIDATE_SEMVER_GRAMMAR", errors)
    need(precedence.get("build_metadata") == "IGNORED", "UPDATE_CANDIDATE_BUILD_METADATA", errors)
    need(precedence.get("prerelease") == "SEMVER_PRECEDENCE", "UPDATE_CANDIDATE_PRERELEASE", errors)
    need(precedence.get("numeric_prerelease") == "INTEGER_VALUE", "UPDATE_CANDIDATE_NUMERIC_PRERELEASE", errors)

    states = candidate.get("resolution", {}).get("states", {})
    need(
        states.get("UPDATE_AVAILABLE") == {
            "relation": "RESOLVED_NEWER",
            "artifact_retrieval": "REQUIRED",
            "candidate": "VERIFIED_UPDATE_CANDIDATE",
        },
        "UPDATE_CANDIDATE_NEWER_STATE",
        errors,
    )
    need(
        states.get("CURRENT") == {
            "relation": "EQUAL_PRECEDENCE",
            "artifact_retrieval": "FORBIDDEN",
            "candidate": None,
        },
        "UPDATE_CANDIDATE_CURRENT_STATE",
        errors,
    )
    need(
        states.get("DOWNGRADE_NOT_CANDIDATE") == {
            "relation": "RESOLVED_OLDER",
            "artifact_retrieval": "FORBIDDEN",
            "candidate": None,
        },
        "UPDATE_CANDIDATE_DOWNGRADE_STATE",
        errors,
    )

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
