# SCTool Registry

Public metadata registry and authenticated artifact distribution authority for Simple Connection SCTool packages.

This repository is a **public registry for distribution metadata**, not a source-code or binary-artifact repository.
A publisher's source repository may be public, private, self-hosted, or undisclosed.
Source visibility is not a package admission requirement.

## Trust boundary

```text
Publisher repository (public or private)
        |
        | @simple-connection/sctool-sdk
        | build -> test -> sign -> publish
        v
Registry intake
        |
        | independent server-side verification
        v
Public signed registry metadata
        |
        | package/channel/version resolution
        v
GitHub-authenticated client
        |
        | authorized private Release access
        v
Simple-Connection/sctool-artifacts
        |
        v
Simple Connection
```

The registry never trusts a publisher-side `PASS` result by itself.
An accepted artifact must be independently revalidated against the canonical SCTool package and submission contracts before publication.

## Repository responsibilities

```text
registry.json                    package/publisher index
packages/*.json                  accepted package/version/artifact descriptors
publishers/*.json                registered publisher verification keys
schemas/*.schema.json            canonical registry contracts
policy/registry-policy.json      machine-readable admission/access policy
docs/REGISTRY_CONTRACT_V1.md     historical anonymous-download Registry contract
docs/REGISTRY_CONTRACT_V2.md     current authenticated Registry contract
docs/REGISTRY_ACCESS_V1.md       GitHub identity/private artifact access contract
docs/PAGES_DISTRIBUTION_V1.md    GitHub Pages signed metadata distribution contract
trust/README.md                   Root/Distribution Actions Secret bootstrap guidance
.github/workflows/sign-trust.yml  manual Root trust-signing workflow
.github/workflows/pages.yml       signed Pages metadata delivery workflow
```

`.sctool` binaries are not committed to this Git history. Accepted payloads are published as private GitHub Release assets in the canonical artifact repository:

```text
Simple-Connection/sctool-artifacts
```

## Core policy

1. Source visibility is not an admission requirement.
2. Publishers do not receive write access to this repository.
3. Publisher submissions are signed with a registered Ed25519 key.
4. Registry intake independently verifies package structure, checksums, identity, ownership, and signatures.
5. `(package id, version, target)` is immutable after publication.
6. Retrying the exact same digest is idempotent; a different digest for the same immutable identity is rejected.
7. Final artifacts require authenticated GitHub access to the canonical private artifact repository.
8. Artifact credentials are not embedded in Registry metadata or Simple Connection; the SCTool Registry access path uses the GitHub CLI credential store.
9. Package ownership is bound to a registered publisher identity.
10. `.sctool` binaries are not stored in Registry Git history.

## Initial release namespace

When GitHub Releases are used as the private artifact backend, the canonical tag shape is:

```text
sctool/{packageId}/v{version}
```

Example:

```text
sctool/openai-local-bridge/v0.3.1
```

## Distribution architecture

Registry source metadata remains canonical in this repository. Simple Connection does not use the GitHub REST API for public package discovery. Public metadata distribution is designed as:

```text
Git repository
  -> signed GitHub Pages trust/head/snapshot metadata
  -> Simple Connection verifies the pinned Registry Root key
  -> package artifact selected through a signed registry channel
  -> GitHub identity/access verification through the SCTool Registry CLI/SDK
  -> authenticated private GitHub Release .sctool retrieval
```

The client bootstrap contract pins the Pages head URL and Registry Root public key, not individual SCTool versions. Package descriptors resolve `defaultChannel` / `channels` to concrete versions at runtime.

Registry Root and Distribution private keys are stored as separate GitHub Actions Secrets. The Root private secret is used only by the manually dispatched trust-signing workflow; routine Pages publication receives only the Root public key and Distribution private key. Pages publication remains intentionally inactive until a valid Root-signed `trust/trust.json` exists. See `docs/PAGES_DISTRIBUTION_V1.md` and `trust/README.md`.

Artifact access is a separate boundary. Registry Contract v2 adopts `docs/REGISTRY_ACCESS_V1.md`: the active GitHub CLI account must be authenticated and authorized to read `Simple-Connection/sctool-artifacts`. Registry access code must not extract or expose GitHub token material merely to establish identity.

Registry Intake transport, publisher enrollment workflow, authenticated artifact upload/download implementation, and SDK `publish` are follow-up implementation work.

## Development governance — PTSIP 0.3.6

Repository architecture is governed from the first commit by PTSIP Tool `0.3.6` and Specification family `0.3.6-draft`.

Canonical repository profile:

```text
ptsip.yaml
```

PTSIP is an **agent/development tool**, not a runtime or repository package dependency.
Coding-agent execution environments should install the exact tool version:

```powershell
python -m pip install "PTSIP==0.3.6"
```

Before and after structural changes, agents follow `AGENTS.md` and use the PTSIP `doctor`, `inspect`, `validate`, and `conform` gates. New tracked paths must be assigned to the Responsibility Map in the same change that introduces them.
