# Registry contract and invariant entry

This repository is authority for SCTool Registry metadata, Registry trust/integrity contracts, Registry Client SDK behavior, and Registry-owned Authoring SDK publication/source boundaries.

Use current active contracts and `policy/registry-policy.json`; historical V1 material is not active authority unless explicitly routed for history.

Core invariants:

1. Source repository visibility is not an admission requirement.
2. Publishers do not receive direct Registry repository write access.
3. Publisher submissions use registered Ed25519 identities.
4. Registry Intake independently revalidates accepted submissions.
5. `(packageId, version, target)` is immutable after publication.
6. Exact-digest retry is idempotent; different-digest overwrite is rejected.
7. Artifact transport availability is not artifact trust authority.
8. Artifact trust is fail-closed against accepted Registry content identity, publisher evidence, signed Registry state, exact byte size, and SHA-256.
9. SCTool binaries are not stored in Registry Git history.
10. Consumers resolve versions through signed Registry channels rather than hardcoded per-tool versions.
11. Root signing and routine Distribution signing use separate credentials.
12. Simple Connection install/runtime/UI policy remains outside Registry Client SDK ownership unless a separately approved contract changes that boundary.
