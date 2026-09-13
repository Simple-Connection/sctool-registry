# SCTool Registry

Public metadata registry and integrity-verified artifact distribution authority for Simple Connection SCTool packages.

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
Registry client
        |
        | public exact Release retrieval
        | + fail-closed integrity verification
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
docs/REGISTRY_CONTRACT_V2.md     current Registry admission/distribution contract
docs/REGISTRY_ACCESS_V1.md       historical private artifact access contract
docs/REGISTRY_PUBLIC_ARTIFACT_INTEGRITY_POLICY_V1.md current public artifact integrity/access authority
docs/ARTIFACT_DELIVERY_V2.md      current publisher-origin + bounded-cache delivery contract
docs/PAGES_DISTRIBUTION_V1.md    signed metadata distribution contract (legacy filename)
trust/README.md                   Root/Distribution Actions Secret bootstrap guidance
.github/workflows/sign-trust.yml  manual Root trust-signing workflow
.github/workflows/pages.yml       signed distribution + exact handoff producer workflow
```

`.sctool` binaries are not committed to this Git history. Publisher-owned GitHub Releases are the long-term origin. Current default-channel payloads may additionally be cached as public GitHub Release assets in the canonical cache repository:

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
7. Public cache retrieval does not require private repository read permission; successful download alone is not artifact trust.
8. Artifact trust requires exact identity, publisher evidence, signed Registry state, byte-size, and SHA-256 verification.
9. Package ownership is bound to a registered publisher identity.
10. `.sctool` binaries are not stored in Registry Git history.

## Artifact locator model

Package schema `3.0.0` stores exact GitHub Release identities as `repository + releaseId + assetId`. Publisher tag names are not locator authority. The bounded central cache uses the same exact identity fields and is optional.

## Distribution architecture

Registry source metadata remains canonical in this repository. Simple Connection does not use the GitHub REST API for public package discovery. Public metadata distribution is designed as:

```text
Git repository
  -> signed Registry trust/head/snapshot distribution artifact
  -> SCTool_Marketplace_Web materializes exact bytes at /registry/
  -> Registry consumers verify the pinned Registry Root key
  -> package artifact selected through a signed registry channel
  -> current default version: bounded cache preferred when present
  -> cache failure: exact publisher-origin fallback
  -> historical/alternate version: exact publisher origin
  -> fail-closed artifact integrity verification
```

The client bootstrap contract pins the public Registry head URL and Registry Root public key, not individual SCTool versions. Package descriptors resolve `defaultChannel` / `channels` to concrete versions at runtime.

Registry Root and Distribution private keys are stored as separate GitHub Actions Secrets. The Root private secret is used only by the manually dispatched trust-signing workflow; routine signed distribution production receives only the Root public key and Distribution private key. Signed distribution production remains intentionally inactive until a valid Root-signed `trust/trust.json` exists. See `docs/PAGES_DISTRIBUTION_V1.md` and `trust/README.md`.

Artifact transport is a separate boundary. `docs/ARTIFACT_DELIVERY_V2.md` and `docs/REGISTRY_PUBLIC_ARTIFACT_INTEGRITY_POLICY_V1.md` define the current model: publisher origin is always retained, `Simple-Connection/sctool-artifacts` is only a bounded current-version cache, and successful download is not trust. Accepted Registry metadata, publisher evidence, exact locator identity, byte size, and SHA-256 establish the fail-closed delivery boundary.

Registry Intake service implementation, publisher enrollment workflow, SDK `publish`, and GitHub Release cache mutation automation are follow-up implementation work. The current repository already enforces package/submission contracts, client retrieval/fallback semantics, and machine cache lifecycle planning.

## Development governance — PTSIP 0.3.6

Repository architecture is governed by PTSIP Tool `0.3.7` and Specification family `0.3.6-draft`.

Canonical repository profile:

```text
ptsip.yaml
```

PTSIP is an **agent/development tool**, not a runtime or repository package dependency.
Coding-agent execution environments should install the exact tool version:

```powershell
python -m pip install "PTSIP==0.3.7"
```

Before and after structural changes, agents follow `AGENTS.md` and use the PTSIP `doctor`, `inspect`, `validate`, and `conform` gates. New tracked paths must be assigned to the Responsibility Map in the same change that introduces them.
