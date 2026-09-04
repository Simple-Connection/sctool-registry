# AGENTS.md

## Repository authority

This repository is the public SCTool metadata registry, authenticated artifact-distribution authority, and Registry Client SDK authority for Simple Connection.

Before changing registry identity, schema, publisher trust, package ownership, artifact access/immutability, distribution behavior, or Registry Client SDK behavior, read:

```text
docs/REGISTRY_CONTRACT_V2.md
docs/REGISTRY_ACCESS_V1.md
docs/ARTIFACT_DELIVERY_V1.md
docs/PAGES_DISTRIBUTION_V1.md
policy/registry-policy.json
ptsip.yaml
```

`docs/REGISTRY_CONTRACT_V1.md` and `schemas/policy-v1.schema.json` are retained as historical v1 references. Do not silently restore v1 anonymous artifact delivery into the current v2 policy.

## Version-scoped development branches

Development work is organized by `distribution_contract_version`. One version uses one persistent branch:

```text
dev/{major}.{minor}.{micro}
```

Do not create a branch per session. Do not infer the active version or session from prose, package versions, schema versions, SDK versions, or Tool versions.

The canonical machine entry point for development documentation is:

```text
docs/index.yaml
```

A coding agent entering version/session work must resolve routing in this order:

```text
docs/index.yaml
-> docs/template/index.yaml
-> current version improvement_plan
-> approved current session_document
-> session_document_essential template
-> selected session_type template
```

`docs/index.yaml` is authoritative for the current distribution contract version, version state, current/next session state, version-plan path, session-document paths, and template routing. It must contain machine values only and must not contain free-form natural-language planning text.

Each version has one canonical machine improvement plan named exactly:

```text
{major}.{minor}.{micro}_Improvement_plan.yaml
```

The improvement plan must follow `docs/template/improvement_plan.yaml`. Natural-language fields are forbidden in the improvement plan. Version goals and future work must be represented by stable machine identifiers, enums, paths, states, gate IDs, and evidence references.

Before creating a new development branch, resolve the target version from `docs/index.yaml`. Reuse an existing matching `dev/{major}.{minor}.{micro}` branch when that version is already active.

Multiple sessions belonging to the same version remain on that version branch. Session completion does not authorize a merge to `main`. The version branch becomes merge-eligible only after version-level machine gates are satisfied and any required explicit approval is recorded.

## Machine session entry and documentation layout

Canonical layout:

```text
docs/
├─ index.yaml
├─ template/
│  ├─ index.yaml
│  ├─ improvement_plan.yaml
│  └─ session_document_template/
│     ├─ session_document_essential.yaml
│     ├─ session_type_A.yaml
│     ├─ session_type_B.yaml
│     └─ session_type_C.yaml
└─ ver{major}.{minor}.{micro}/
   ├─ {major}.{minor}.{micro}_Improvement_plan.yaml
   └─ session_document/
      └─ ver.{major}.{minor}.{micro}_P{N}_{topic}.yaml
```

`session_document_essential.yaml` defines the common machine-only routing/state/evidence fields. It must not introduce natural-language payload fields.

Natural-language planning payload is isolated behind a selected session type template:

```text
A = DECISION
B = IMPLEMENTATION
C = VALIDATION_CLOSEOUT
```

The type templates define the payload shape and the fields where natural language may appear. Do not move free-form planning text back into `docs/index.yaml`, the improvement plan, or the essential session template.

A new primary session is not materialized before explicit approval. After approval, create exactly one session YAML by combining the essential machine fields with the selected type payload, then update the version improvement plan and `docs/index.yaml` in the same logical change.

Primary sessions use `P1`, `P2`, `P3`, ... . Use `P1.1`, `P1.2`, ... only when an already approved primary session must be split into a subordinate session.

Historical session documents created before this machine-entry model may retain their recorded payload. Their routing references must point to the current YAML improvement plan, and new sessions must use the template routing above.

All version/session/template/index governance paths are owned by `repository-governance` in `ptsip.yaml`.

## PTSIP is mandatory from the first commit

Architecture and responsibility ownership are governed by:

```text
PTSIP Tool:          0.3.7
Specification:       0.3.6-draft
Specification rev:   d6995ed232e845b88d8235b851e80ab54b7804ea
Profile:             ptsip.yaml
```

Tool version and bound Specification identity are separate. A compatible Tool update must not silently rewrite the historical Specification binding.

PTSIP is a coding-agent/development tool. Do **not** add PTSIP to registry runtime dependencies or Registry Client SDK dependencies merely to make it available locally.

The coding-agent execution environment should install the exact maintained tool version:

```powershell
python -m pip install "PTSIP==0.3.7"
ptsip --version
```

If the execution environment cannot reach the package index, do not silently add PTSIP as a repository dependency or vendor it into this repository. Report that the tool gate could not run and keep the canonical profile/specification revision unchanged.

## Required structural workflow

Before an architecture or path-placement change:

```powershell
ptsip doctor .
ptsip inspect .
```

After the change:

```powershell
ptsip validate .
ptsip conform .
```

For release/merge gating when applicable:

```powershell
ptsip gate .
```

A new tracked path must be assigned in `ptsip.yaml` in the same change that introduces it. PTSIP classifications are determined by primary lifecycle ownership, not by directory name, language, framework, or whether a file is executable.

Canonical classifications are:

```text
PRODUCT
DEVELOPMENT_TOOLING
DELIVERY
OPERATIONS
NEUTRAL_CONTRACT
```

## Packages namespace

`packages/` has two distinct meanings that must remain unambiguous:

```text
packages/{packageId}.json
= accepted Registry package descriptor

packages/registry-client-sdk/**
= Registry-owned Simple Connection integration/client SDK
```

The Registry Client SDK must not implement SCTool scaffold/build/test/sign/package authoring. That responsibility belongs to the separate SCTool Authoring SDK in `Kinirin/Simple-Connection/program-sdk/sctool-sdk`.

## Current responsibility boundaries

```text
registry-catalog
= public runtime-consumed registry metadata
= PRODUCT

registry-client-sdk
= Simple Connection runtime client for Registry metadata/access/delivery/integrity contracts
= PRODUCT

registry-contracts
= schemas, admission/access/distribution/trust policy and canonical contracts
= NEUTRAL_CONTRACT

registry-pages-delivery
= Root trust signing, snapshot assembly/verification and GitHub Pages metadata publication
= DELIVERY

product-documentation
= public registry documentation
= PRODUCT

repository-governance
= PTSIP profile and coding-agent governance
= DEVELOPMENT_TOOLING
```

Do not classify future Registry Intake implementation, artifact release publication outside this Pages metadata boundary, or operational monitoring by analogy. Determine its actual lifecycle ownership when that responsibility is introduced and update `ptsip.yaml` explicitly.

## Registry Client SDK boundary

Canonical path:

```text
packages/registry-client-sdk/
```

The SDK owns consumer-side implementation of Registry contracts, including Registry access state semantics, descriptor/channel/version/target resolution, exact delivery locator handling, authenticated artifact retrieval, content integrity verification, and normalized update candidates.

It must not own Simple Connection local installation state, active-version selection, rollback, renderer UI, runtime reconcile policy, or publisher-side `.sctool` authoring.

The package remains non-published/private until an explicit SDK distribution mechanism is approved. Do not invent an npm/GitHub Packages publication path merely because the package directory exists.

## Registry trust secret boundary

Private key values are never repository content.

Canonical GitHub Actions secret names are:

```text
SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64
SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64
```

The Root private secret may be referenced only by the manually dispatched `.github/workflows/sign-trust.yml` trust-signing path. Routine Pages publication must never request, echo, copy, persist, or otherwise consume the Root private secret.

The Distribution private secret may be used by `.github/workflows/pages.yml` for routine `registry-head.json` signing. The corresponding Registry Root public key is non-secret configuration and is pinned independently by Simple Connection.

Never place private key material in generated Pages artifacts, logs, workflow artifacts, test fixtures, committed configuration, or documentation examples.

GitHub end-user credentials are also never Registry repository content. Registry access consumers use the GitHub CLI credential store and must not add GitHub access tokens, OAuth tokens, client private keys, or credential-store material to Registry metadata or SDK results.

## Registry invariants

1. Source repository visibility is not an admission requirement.
2. Publishers do not receive direct write access to the registry repository.
3. Publisher submissions use registered Ed25519 identities.
4. Registry Intake independently revalidates submitted artifacts.
5. `(packageId, version, target)` is immutable after publication.
6. Exact-digest retry is idempotent; different-digest overwrite is rejected.
7. Published `.sctool` artifacts require authenticated GitHub access to `Simple-Connection/sctool-artifacts`.
8. GitHub authentication identity is resolved through the GitHub CLI credential-store session; Registry access code must not extract credential material merely to establish identity.
9. `.sctool` binaries are not stored in Registry Git history.
10. Simple Connection does not hardcode individual SCTool versions; signed Registry channels resolve versions.
11. Root trust signing and routine Distribution signing use separate Actions Secrets.
12. Simple Connection UI/install/runtime policy remains outside the Registry access contract and Registry Client SDK ownership.
