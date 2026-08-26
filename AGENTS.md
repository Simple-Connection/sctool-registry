# AGENTS.md

## Repository authority

This repository is the public SCTool metadata registry and authenticated artifact-distribution authority for Simple Connection.

Before changing registry identity, schema, publisher trust, package ownership, artifact access/immutability, or distribution behavior, read:

```text
docs/REGISTRY_CONTRACT_V2.md
docs/REGISTRY_ACCESS_V1.md
docs/PAGES_DISTRIBUTION_V1.md
policy/registry-policy.json
ptsip.yaml
```

`docs/REGISTRY_CONTRACT_V1.md` and `schemas/policy-v1.schema.json` are retained as historical v1 references. Do not silently restore v1 anonymous artifact delivery into the current v2 policy.

## Version-scoped development branches

Development work is organized by `distribution_contract_version`. One distribution contract version may contain multiple implementation sessions or work units.

For each version, create one persistent development branch using exactly:

```text
dev/{major}.{minor}.{micro}
```

Examples:

```text
dev/1.0.0
dev/1.1.0
dev/2.0.0
```

The version in the branch name is the version being developed for that distribution contract. Do not infer a different branch version from an unrelated package, schema, policy, SDK, or tool version.

Multiple sessions belonging to the same version must remain on the same `dev/{major}.{minor}.{micro}` branch. At the end of an individual session:

```text
commit the completed session to the version branch
run the session's required validation
continue later sessions from the same version branch
```

Do **not** create a new branch for every session and do **not** merge the version branch to `main` merely because one session is complete.

The version branch is merged to `main` only when all planned sessions for that version are complete and the version-level acceptance, Registry validation, and applicable PTSIP gates have passed.

Each version has one canonical improvement-plan document named exactly:

```text
{major}.{minor}.{micro}_Improvement_plan.md
```

Examples:

```text
1.0.0_Improvement_plan.md
1.1.0_Improvement_plan.md
2.0.0_Improvement_plan.md
```

The improvement plan is the version-level index for its sessions. It should record the version objective, session/work-unit breakdown, completion state, acceptance criteria, and final merge gate so that session completion does not get confused with version completion.

Before creating a new development branch, determine the target `distribution_contract_version` and use this naming/document policy. Reuse an existing matching `dev/{major}.{minor}.{micro}` branch when that version is already in progress.

## PTSIP is mandatory from the first commit

Architecture and responsibility ownership are governed by:

```text
PTSIP Tool:          0.3.6
Specification:       0.3.6-draft
Specification rev:   d6995ed232e845b88d8235b851e80ab54b7804ea
Profile:             ptsip.yaml
```

PTSIP is a coding-agent/development tool. Do **not** add PTSIP to registry runtime dependencies or package metadata merely to make it available locally.

The coding-agent execution environment should install the exact tool version:

```powershell
python -m pip install "PTSIP==0.3.6"
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

Do not use legacy `TOOLCHAIN` in new declarations. Tool 0.3.6 canonical classifications are:

```text
PRODUCT
DEVELOPMENT_TOOLING
DELIVERY
OPERATIONS
NEUTRAL_CONTRACT
```

## Current responsibility boundaries

```text
registry-catalog
= public runtime-consumed registry metadata
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

Do not classify future Registry Intake implementation, artifact release publication outside this Pages metadata boundary, authenticated download implementation, or operational monitoring by analogy. Determine its actual lifecycle ownership when that responsibility is introduced and update `ptsip.yaml` explicitly.

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

GitHub end-user credentials are also never Registry repository content. Registry access consumers use the GitHub CLI credential store and must not add GitHub access tokens, OAuth tokens, client private keys, or credential-store material to Registry metadata.

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
12. Simple Connection UI/install/runtime policy remains outside the Registry access contract.
