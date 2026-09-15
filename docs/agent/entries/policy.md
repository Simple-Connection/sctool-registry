# Policy entry

Use `docs/policy/index.yaml` as the policy table of contents.

Policy entry states are:

```text
ACTIVE       -> routed from docs/policy/index.yaml
HISTORICAL   -> version history, INDEX_ONLY
EXPIRED      -> removed from repository
```

Do not scan historical version folders to discover policy authority.
Do not treat a historical policy or contract as active merely because a current document references its history.

Policy implementation status and implementation authorization are distinct. A policy can be active as a decision record while implementation remains separately unapproved.

When policy changes alter responsibility or component ownership, also enter the responsibility and PTSIP task classes rather than inferring that those authorities remain unchanged.
