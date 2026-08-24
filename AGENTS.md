# AGENTS.md

## Repository authority

This repository is the public SCTool distribution registry for Simple Connection.

Before changing registry identity, schema, publisher trust, package ownership,
artifact immutability, or distribution behavior, read:

```text
docs/REGISTRY_CONTRACT_V1.md
policy/registry-policy.json
ptsip.yaml
```

## PTSIP is mandatory from the first commit

Architecture and responsibility ownership are governed by:

```text
PTSIP Tool:          0.3.6
Specification:       0.3.6-draft
Specification rev:   d6995ed232e845b88d8235b851e80ab54b7804ea
Profile:             ptsip.yaml
```

PTSIP is a coding-agent/development tool. Do **not** add PTSIP to registry runtime
dependencies or package metadata merely to make it available locally.

The coding-agent execution environment should install the exact tool version:

```powershell
python -m pip install "PTSIP==0.3.6"
ptsip --version
```

If the execution environment cannot reach the package index, do not silently add
PTSIP as a repository dependency or vendor it into this repository. Report that
the tool gate could not run and keep the canonical profile/specification revision
unchanged.

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

A new tracked path must be assigned in `ptsip.yaml` in the same change that
introduces it. PTSIP classifications are determined by primary lifecycle ownership,
not by directory name, language, framework, or whether a file is executable.

Do not use legacy `TOOLCHAIN` in new declarations. Tool 0.3.6 canonical
classifications are:

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
= schemas, admission policy, canonical registry contract
= NEUTRAL_CONTRACT

product-documentation
= public registry documentation
= PRODUCT

repository-governance
= PTSIP profile and coding-agent governance
= DEVELOPMENT_TOOLING
```

Do not classify future Registry Intake implementation, CI, release publication,
or operational monitoring by analogy. Determine its actual lifecycle ownership
when that responsibility is introduced and update `ptsip.yaml` explicitly.

## Registry invariants

1. Source repository visibility is not an admission requirement.
2. Publishers do not receive direct write access to the registry repository.
3. Publisher submissions use registered Ed25519 identities.
4. Registry Intake independently revalidates submitted artifacts.
5. `(packageId, version, target)` is immutable after publication.
6. Exact-digest retry is idempotent; different-digest overwrite is rejected.
7. Published artifacts are anonymously downloadable over HTTPS.
8. `.sctool` binaries are not stored in Git history.
