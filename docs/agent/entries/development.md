# Version and session development entry

Use this entry only for version/session work selected by `VERSION_DEVELOPMENT`.

## Version branch model

Development is organized by `distribution_contract_version`. One active version uses one persistent branch:

```text
dev/{major}.{minor}.{micro}
```

Do not create a branch per session. Do not infer an active version or session from package versions, schema versions, Tool versions, issue prose, or historical documents.

`docs/index.yaml` is authoritative for current version state, current/next session, version plan, and session-document routing.

Before creating a development branch, resolve the target version from `docs/index.yaml` and obtain explicit user approval. Reuse the matching active version branch when it already exists.

Session completion does not authorize merge to `main`. Version merge eligibility requires version-level machine gates and required explicit approval.

## Version/session routing

Follow the routed order only after this task class is selected:

```text
docs/index.yaml
-> docs/rules/index.yaml
-> docs/template/index.yaml
-> docs/responsibility/index.yaml
-> current improvement_plan
-> approved current session_document
-> essential session template
-> selected session_type template
```

Machine-governed improvement plans live at:

```text
docs/ver{version}/{version}_Improvement_plan.yaml
```

New primary sessions are materialized only after explicit approval. Primary IDs are `P1`, `P2`, ...; subordinate IDs are used only when an approved primary session is intentionally split.

Version folders that are not routed by `docs/index.yaml -> current` are historical/version-scoped records and are not normal entry material.
