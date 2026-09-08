from __future__ import annotations

from .common import need
from .context import ValidationContext


def validate(ctx: ValidationContext, errors: list[str]) -> None:
    repos = ctx.authorities["repositories"]
    components = ctx.authorities["components"]
    authorities = ctx.authorities["authorities"]
    contracts = ctx.contracts["contracts"]
    vocabulary = {key: set(values) for key, values in ctx.vocabulary["dimensions"].items()}
    responsibilities = ctx.responsibilities["responsibilities"]
    ownership_policy = ctx.responsibilities.get("ownership_policy", {})

    for contract_id, contract in contracts.items():
        need(
            (ctx.root / contract["path"]).is_file(),
            f"CONTRACT_PATH:{contract_id}:{contract['path']}",
            errors,
        )

    for authority_id, authority in authorities.items():
        need(
            authority["repository_id"] in repos,
            f"AUTH_REPO:{authority_id}",
            errors,
        )
        need(
            authority["component_id"] in components,
            f"AUTH_COMPONENT:{authority_id}",
            errors,
        )

    dimensions = {
        "authority_domain": "authority_domain",
        "lifecycle_phase": "lifecycle_phase",
        "operation": "operation",
        "relation": "relation",
        "ownership": "ownership",
        "normative": "normative",
        "state": "responsibility_state",
    }

    for responsibility_id, responsibility in responsibilities.items():
        subject_id = responsibility["subject"]
        need(subject_id in authorities, f"RESP_SUBJECT:{responsibility_id}", errors)

        for field, dimension in dimensions.items():
            value = responsibility[field]
            need(
                value in vocabulary[dimension],
                f"RESP_DIM:{responsibility_id}:{field}:{value}",
                errors,
            )

        need(
            responsibility["object"]["class"] in vocabulary["object_class"],
            f"RESP_OBJECT_CLASS:{responsibility_id}",
            errors,
        )
        need(
            responsibility["object"]["subtype"] in vocabulary["object_subtype"],
            f"RESP_OBJECT_SUBTYPE:{responsibility_id}",
            errors,
        )
        need(
            responsibility["scope"]["repository_id"] in repos,
            f"RESP_SCOPE_REPO:{responsibility_id}",
            errors,
        )
        need(
            responsibility["scope"]["component_id"] in components,
            f"RESP_SCOPE_COMPONENT:{responsibility_id}",
            errors,
        )

        for contract_ref in responsibility.get("contract_refs", []):
            need(
                contract_ref in contracts,
                f"RESP_CONTRACT:{responsibility_id}:{contract_ref}",
                errors,
            )

        transfer = responsibility["transfer"]
        need(
            transfer["state"] in vocabulary["transfer_state"],
            f"RESP_TRANSFER:{responsibility_id}",
            errors,
        )
        need(
            transfer["predecessor_retirement"] in vocabulary["retirement_state"],
            f"RESP_RETIREMENT:{responsibility_id}",
            errors,
        )
        for field in ("from_authority_id", "to_authority_id"):
            authority_ref = transfer.get(field)
            need(
                authority_ref is None or authority_ref in authorities,
                f"RESP_TRANSFER_AUTH:{responsibility_id}:{field}:{authority_ref}",
                errors,
            )

        subject = authorities.get(subject_id, {})
        need(
            subject.get("component_id") == responsibility["scope"]["component_id"],
            f"RESP_OWNER_COMPONENT:{responsibility_id}",
            errors,
        )

        owner_rules = ownership_policy.get(subject_id)
        if owner_rules:
            need(
                responsibility_id in owner_rules.get("allow", []),
                f"RESP_OWNER_ALLOW:{responsibility_id}:{subject_id}",
                errors,
            )

    for authority_id, rules in ownership_policy.items():
        need(authority_id in authorities, f"POLICY_AUTH:{authority_id}", errors)
        allow = set(rules.get("allow", []))
        deny = set(rules.get("deny", []))
        need(not (allow & deny), f"POLICY_OVERLAP:{authority_id}", errors)
        for responsibility_id in allow | deny:
            need(
                responsibility_id in responsibilities,
                f"POLICY_RESP:{authority_id}:{responsibility_id}",
                errors,
            )
