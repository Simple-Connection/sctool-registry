# SCTool Registry

Public distribution registry for Simple Connection SCTool packages.

This repository is a **public registry for distribution metadata**, not a source-code registry.
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
Public artifact + public registry metadata
        |
        v
Simple Connection
        | anonymous HTTPS download
```

The registry never trusts a publisher-side `PASS` result by itself.
An accepted artifact must be independently revalidated against the canonical SCTool package
and submission contracts before publication.

## Repository responsibilities

```text
registry.json                  package/publisher index
packages/*.json                accepted package/version/artifact descriptors
publishers/*.json              registered publisher verification keys
schemas/*.schema.json          canonical registry contracts
policy/registry-policy.json    machine-readable admission policy
docs/REGISTRY_CONTRACT_V1.md   submission/signature/immutability contract
```

`.sctool` binaries are not committed to Git history. Accepted payloads are published as public
release assets or another anonymous HTTPS artifact endpoint approved by registry policy.

## Core policy

1. Source visibility is not an admission requirement.
2. Publishers do not receive write access to this repository.
3. Publisher submissions are signed with a registered Ed25519 key.
4. Registry intake independently verifies package structure, checksums, identity, ownership, and signatures.
5. `(package id, version, target)` is immutable after publication.
6. Retrying the exact same digest is idempotent; a different digest for the same immutable identity is rejected.
7. Final artifacts must be downloadable without GitHub login or other end-user authentication.
8. Package ownership is bound to a registered publisher identity.

## Initial release namespace

When GitHub Releases are used as the public artifact backend, the canonical tag shape is:

```text
sctool/{packageId}/v{version}
```

Example:

```text
sctool/openai-local-bridge/v0.3.1
```

## Current scope

This scaffold defines registry data contracts and policy only.
Registry intake transport, publisher enrollment workflow, artifact upload service,
SDK `publish` command, and automatic release publication are follow-up implementation work.


## Development governance — PTSIP 0.3.6

Repository architecture is governed from the first commit by PTSIP Tool `0.3.6`
and Specification family `0.3.6-draft`.

Canonical repository profile:

```text
ptsip.yaml
```

PTSIP is an **agent/development tool**, not a runtime or repository package dependency.
Coding-agent execution environments should install the exact tool version:

```powershell
python -m pip install "PTSIP==0.3.6"
```

Before and after structural changes, agents follow `AGENTS.md` and use the PTSIP
`doctor`, `inspect`, `validate`, and `conform` gates. New tracked paths must be assigned
to the Responsibility Map in the same change that introduces them.
