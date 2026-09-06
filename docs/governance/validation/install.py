from __future__ import annotations

from .common import need, scan_machine
from .context import ValidationContext


R1 = {
    "RESP_SIMPLE_CONNECTION_INSTALL_INTENT",
    "RESP_SIMPLE_CONNECTION_INSTALL_TRANSACTION_LIFECYCLE",
    "RESP_SIMPLE_CONNECTION_PACKAGE_MATERIALIZATION",
    "RESP_SIMPLE_CONNECTION_INSTALL_STATE_COMMIT",
}


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    contract = ctx.simple_connection_install_transaction
    responsibilities = ctx.responsibilities["responsibilities"]
    scan_machine(contract, "docs/SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1.yaml", errors)

    need(
        contract.get("contract_id") == "SIMPLE_CONNECTION_INSTALL_TRANSACTION_V1",
        "INSTALL_TRANSACTION_CONTRACT_ID",
        errors,
    )
    need(
        contract.get("authority") == "AUTH_SIMPLE_CONNECTION_DESKTOP",
        "INSTALL_TRANSACTION_AUTHORITY",
        errors,
    )
    need(R1 <= set(responsibilities), "INSTALL_TRANSACTION_R1_RESPONSIBILITIES", errors)

    broad = responsibilities.get("RESP_SIMPLE_CONNECTION_INSTALL", {})
    need(broad.get("state") == "DEPRECATED", "INSTALL_BROAD_RESP_NOT_DEPRECATED", errors)

    expected = {
        "RESP_SIMPLE_CONNECTION_INSTALL_INTENT": ("DECIDE", "INSTALL_INTENT", "PRODUCES"),
        "RESP_SIMPLE_CONNECTION_INSTALL_TRANSACTION_LIFECYCLE": ("CONTROL_LIFECYCLE", "INSTALL_TRANSACTION", "OWNS"),
        "RESP_SIMPLE_CONNECTION_PACKAGE_MATERIALIZATION": ("MATERIALIZE", "INSTALLED_PACKAGE_TREE", "PRODUCES"),
        "RESP_SIMPLE_CONNECTION_INSTALL_STATE_COMMIT": ("COMMIT", "LOCAL_INSTALL_STATE", "OWNS"),
    }
    for rid, (operation, object_class, relation) in expected.items():
        entry = responsibilities.get(rid, {})
        need(entry.get("subject") == "AUTH_SIMPLE_CONNECTION_DESKTOP", f"INSTALL_R1_SUBJECT:{rid}", errors)
        need(entry.get("authority_domain") == "LOCAL_INSTALLATION", f"INSTALL_R1_DOMAIN:{rid}", errors)
        need(entry.get("lifecycle_phase") == "INSTALLATION", f"INSTALL_R1_PHASE:{rid}", errors)
        need(entry.get("operation") == operation, f"INSTALL_R1_OPERATION:{rid}", errors)
        need(entry.get("object", {}).get("class") == object_class, f"INSTALL_R1_OBJECT:{rid}", errors)
        need(entry.get("relation") == relation, f"INSTALL_R1_RELATION:{rid}", errors)

    input_contract = contract.get("input", {})
    need(input_contract.get("resolution_state") == "UPDATE_AVAILABLE", "INSTALL_INPUT_STATE", errors)
    need(input_contract.get("candidate_type") == "VERIFIED_UPDATE_CANDIDATE", "INSTALL_INPUT_CANDIDATE", errors)
    need(input_contract.get("artifact_type") == "VERIFIED_ARTIFACT_LEASE", "INSTALL_INPUT_ARTIFACT", errors)
    need(input_contract.get("raw_registry_staging_path") == "FORBIDDEN", "INSTALL_INPUT_RAW_PATH", errors)

    tx = contract.get("transaction", {})
    states = tx.get("states", [])
    state_set = set(states)
    need(len(states) == len(state_set), "INSTALL_STATE_DUPLICATE", errors)
    need(tx.get("initial_state") in state_set, "INSTALL_INITIAL_STATE", errors)
    terminals = set(tx.get("terminal_states", []))
    need(terminals == {"INSTALLED", "ABORTED"}, "INSTALL_TERMINALS", errors)

    graph = {state: set() for state in states}
    for transition in tx.get("transitions", []):
        source = transition.get("from")
        target = transition.get("to")
        owner = transition.get("owner")
        need(source in state_set, f"INSTALL_TRANSITION_FROM:{source}", errors)
        need(target in state_set, f"INSTALL_TRANSITION_TO:{target}", errors)
        need(owner in R1, f"INSTALL_TRANSITION_OWNER:{owner}", errors)
        if source in graph and target in state_set:
            graph[source].add(target)

    need(not graph.get("INSTALLED"), "INSTALL_INSTALLED_OUTGOING", errors)
    need(not graph.get("ABORTED"), "INSTALL_ABORTED_OUTGOING", errors)
    need(
        tx.get("failure", {}).get("to") == "ABORTED",
        "INSTALL_FAILURE_TERMINAL",
        errors,
    )

    materialization = contract.get("materialization", {})
    need(materialization.get("source") == "VERIFIED_ARTIFACT_LEASE", "INSTALL_MATERIALIZATION_SOURCE", errors)
    need(materialization.get("same_filesystem_as_final_install") == "REQUIRED", "INSTALL_SAME_FS", errors)
    need(materialization.get("candidate_lease_disposal") == "ALL_TERMINAL_PATHS", "INSTALL_LEASE_DISPOSAL", errors)

    commit = contract.get("commit", {})
    need(commit.get("final_directory_publication") == "ATOMIC_RENAME", "INSTALL_ATOMIC_RENAME", errors)
    need(commit.get("existing_final_directory_predelete") == "FORBIDDEN", "INSTALL_PREDELETE", errors)
    need(commit.get("install_registry_write") == "ATOMIC", "INSTALL_REGISTRY_ATOMIC", errors)
    need(commit.get("partial_state_visibility") == "FORBIDDEN", "INSTALL_PARTIAL_VISIBILITY", errors)
    need(commit.get("sibling_versions") == "PRESERVE", "INSTALL_SIBLING_PRESERVE", errors)
    need(commit.get("same_id_version", {}).get("identical") == "IDEMPOTENT_NOOP", "INSTALL_IDEMPOTENT", errors)
    need(commit.get("same_id_version", {}).get("conflicting") == "FAIL_CLOSED", "INSTALL_CONFLICT", errors)

    recovery = contract.get("recovery", {})
    need(recovery.get("persistent_journal") == "REQUIRED", "INSTALL_JOURNAL", errors)
    need(
        recovery.get("markers") == ["PREPARED", "FILES_COMMITTED", "STATE_COMMITTED"],
        "INSTALL_JOURNAL_MARKERS",
        errors,
    )
    need(recovery.get("policy") == "DETERMINISTIC_FORWARD_OR_ROLLBACK", "INSTALL_RECOVERY_POLICY", errors)

    need(contract.get("output", {}).get("state") == "INSTALLED_NOT_ACTIVATED", "INSTALL_OUTPUT_STATE", errors)
    forbidden = set(contract.get("forbidden_effects", []))
    expected_forbidden = {
        "SELECTED_VERSION_MUTATION",
        "ACTIVATION",
        "RUNTIME_DESCRIPTOR_MUTATION",
        "RUNTIME_RESCAN",
        "ROLLBACK",
        "RENDERER_UI_MUTATION",
        "REGISTRY_UPDATE_ELIGIBILITY_REDECISION",
    }
    need(forbidden == expected_forbidden, "INSTALL_FORBIDDEN_EFFECTS", errors)
    need(contract.get("initial_install", {}).get("state") == "OUT_OF_SCOPE", "INSTALL_INITIAL_SCOPE", errors)
