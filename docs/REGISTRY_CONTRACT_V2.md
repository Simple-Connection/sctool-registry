# SCTool Registry Contract v2

`contract_version: 2.0.0`

> **1.0.3a1 migration:** artifact transport is public and artifact trust is integrity-based. `docs/REGISTRY_PUBLIC_ARTIFACT_INTEGRITY_POLICY_V1.md` is the active access/security authority with access contract `registry-public-integrity-v1`. GitHub user authentication may remain a separate product identity flow but is not a precondition for reading public cache assets.

This document is the canonical SCTool Registry admission and artifact-distribution contract after v2 activation.
It supersedes `docs/REGISTRY_CONTRACT_V1.md` for current Registry admission/distribution behavior while retaining v1 as historical documentation.

The current delivery model is deliberate:

```text
canonical Registry metadata = public + signed
current central .sctool cache = public GitHub Release assets
artifact trust = exact identity + publisher evidence + signed Registry state + size + SHA-256
GitHub login = optional separate user-identity flow, not cache read authorization
```

GitHub Pages metadata signing, Root/Distribution trust, immutable snapshots, and client anti-rollback remain governed by `docs/PAGES_DISTRIBUTION_V1.md`.
Where that v1 Pages document describes `.sctool` payloads as anonymous assets, this contract, `docs/REGISTRY_ACCESS_V1.md`, and `docs/ARTIFACT_DELIVERY_V1.md` supersede only that payload-access/delivery assumption; signed metadata mechanics remain unchanged.

## 1. Identity

The immutable artifact identity remains:

```text
(packageId, version, target)
```

where:

```text
target = platform + "-" + arch
```

Examples:

```text
win-x64
win-arm64
linux-x64
darwin-arm64
```

A package ID is owned by one registered publisher identity.

## 2. Source visibility

Publisher source code remains outside the Registry trust boundary.

A source repository may be:

```text
public
private
self-hosted
undisclosed
```

No publisher source repository URL or source visibility declaration is required for package admission.
If a package descriptor includes `source`, it is informational provenance only.

Publisher source visibility and end-user artifact access are separate concerns. A private or undisclosed publisher repository does not by itself grant or deny access to the canonical Registry artifact backend.

## 3. Publisher-side lifecycle

The intended SDK lifecycle remains:

```text
sctool build
-> sctool test
-> sctool sign
-> sctool publish
```

The SDK produces:

```text
*.sctool
*.submission.json
```

Registry Intake does not trust a publisher-side validation result as proof of acceptance.

## 4. Submission signature

The only v2 submission signature algorithm is Ed25519.

The signature scope remains:

```text
sctool-submission-v1
```

The v2 Registry contract does not change the signed submission payload merely because artifact delivery is authenticated.

The canonical UTF-8 payload is LF-delimited in the exact order below, with no trailing LF:

```text
SCTOOL-SUBMISSION-V1
{submission.id}
{submission.createdAt}
{package.id}
{package.version}
{target.platform}
{target.arch}
{artifact.filename}
{artifact.sha256}
{artifact.size}
{contract.sctoolSpecVersion}
{contract.sdkVersion}
{publisher.id}
{publisher.keyId}
```

`artifact.sha256` is lowercase hexadecimal SHA-256 of the exact submitted `.sctool` bytes.
`artifact.size` is the exact byte length represented as an unsigned base-10 integer.

The Registry reconstructs this payload from the received submission and verifies the signature against the registered publisher public key.

Package descriptor field placement after admission is governed separately by `ARTIFACT_DELIVERY_V1`; that structural separation does not alter the submission signature scope or payload above.

## 5. Registry Intake validation

Acceptance requires independent Registry-side validation.

Minimum checks remain:

```text
manifest schema
package identity
semantic version
target identity
SCTool contract compatibility
archive path safety
internal checksums
artifact SHA-256
publisher signature
package ownership
version immutability
```

The Registry must validate the uploaded artifact itself. A publisher-provided `PASS` field, test log, or checksum report is not authoritative.

Public delivery does not weaken artifact integrity requirements; it makes those integrity requirements the security boundary.

## 6. Immutability

After publication:

```text
same packageId
+ same version
+ same target
+ same SHA-256
= idempotent success
```

but:

```text
same packageId
+ same version
+ same target
+ different SHA-256
= hard reject
```

Published artifact bytes are never overwritten in place.

Repository visibility and successful retrieval do not redefine artifact identity or allow mutable replacement.
A delivery locator is not part of immutable Registry identity and may not be used to substitute different bytes for an existing identity.

## 7. Public integrity distribution

Canonical Registry metadata remains public and is distributed as signed metadata.

The current central `.sctool` cache backend is:

```text
provider:             github.com
backend:              github-release-asset
repository:           Simple-Connection/sctool-artifacts
repositoryVisibility: public
accessContract:       registry-public-integrity-v1
```

A conforming client does **not** require collaborator membership, private-repository read permission, or GitHub authentication solely to retrieve a public central-cache asset.

Public retrieval is transport only. Before bytes become a verified artifact, the client must preserve exact release/asset binding and verify the accepted filename, byte size, SHA-256, publisher evidence, and signed Registry state required by the applicable contracts.

The canonical release tag shape remains:

```text
sctool/{packageId}/v{version}
```

Example:

```text
sctool/openai-local-bridge/v0.3.1
```

`.sctool` payloads must not be committed into Registry Git history.

Knowing a release URL, asset ID, tag, or asset name does not establish artifact trust.

## 8. GitHub identity boundary

GitHub user identity and public artifact transport are separate responsibilities.

```text
GitHub identity
= optional Simple Connection / Marketplace user-identity input

public artifact transport
= unauthenticated read of allowed public Release metadata/assets

artifact trust
= fail-closed Registry/publisher/integrity verification
```

The Registry SDK may expose GitHub CLI identity helpers for product identity flows, but artifact retrieval must not probe or require read authorization to `Simple-Connection/sctool-artifacts`.

The Registry SDK/CLI must not extract or expose credential material merely to establish identity.

## 9. Authority split

```text
Publisher repository
= source + local build configuration

SCTool SDK
= canonical package/submission producer + publisher-side validation

Registry Intake
= independent verifier + ownership/immutability enforcement

Registry Git metadata
= public discovery authority

Signed GitHub Pages metadata
= public trust/head/snapshot distribution

Public GitHub artifact cache
= bounded current-version .sctool transport backend

GitHub
= public Release transport + optional end-user identity provider

Simple Connection / SCTool Registry CLI
= Registry metadata consumer + exact public artifact retriever + artifact verifier
```

Simple Connection UI, local install state, activation, and runtime policy are outside the Registry contract.

## 10. Version/channel indirection

Simple Connection must not hardcode individual SCTool package versions.

Package descriptors resolve:

```text
defaultChannel
channels
versions
```

to a concrete version at runtime.

Public-integrity artifact delivery changes how the selected payload is retrieved, not how the package version is selected.

## 11. Package descriptor and artifact delivery contract

The transitional flat HTTPS locator is retired.
The canonical package descriptor schema is now:

```text
schemas/package.schema.json
schemaVersion = 2.0.0
```

Artifact content and delivery are separated according to:

```text
docs/ARTIFACT_DELIVERY_V1.md
```

The canonical artifact shape is:

```text
artifact
├─ target
├─ content
│  ├─ filename
│  ├─ sha256
│  └─ size
├─ delivery
│  ├─ type = github-release-asset
│  ├─ access
│  │  └─ contract = registry-public-integrity-v1
│  └─ locator
│     ├─ repository
│     └─ assetId
├─ publishedAt
├─ contract
└─ signature
```

For Registry Distribution `1.0.1`:

```text
delivery.locator.repository
= Simple-Connection/sctool-artifacts

delivery.locator.assetId
= positive JavaScript-safe GitHub Release asset integer
```

The expected release tag is not duplicated in package metadata. It is derived from canonical package identity:

```text
sctool/{packageId}/v{version}
```

The backend asset name is not a second naming authority; a resolved GitHub asset must match `content.filename`.
Retrieved bytes must match `content.size` and `content.sha256`.

The package descriptor must not contain credential material, authenticated user identity, private keys, token sources, or entitlement state.

Unknown delivery types and invalid/mismatched delivery metadata fail closed. There is no generic HTTPS fallback.

The earlier descriptor fields:

```text
assetName
url
sha256
size
```

are not accepted as the v2 artifact shape. Their responsibilities are now represented as:

```text
assetName -> content.filename
sha256    -> content.sha256
size      -> content.size
url       -> removed from the common artifact envelope
```

No compatibility bridge is required because the Registry currently contains zero published packages and production trust remains inactive.

## 12. Pages distribution compatibility

Signed GitHub Pages snapshots continue to aggregate complete package descriptors.
The existing head/snapshot signing and anti-rollback model is unchanged by package descriptor schema `2.0.0`.

`registry-snapshot.schema.json` resolves `package.schema.json`, so a package descriptor `2.0.0` is validated inside the existing signed snapshot envelope.

The numeric `assetId` is restricted to the JavaScript safe-integer range to remain compatible with SCTool canonical JSON v1 signed metadata.

Production trust activation remains separately deferred. Adoption of descriptor schema `2.0.0` does not activate Root trust or Pages publication by itself.

## 13. Security properties and non-goals

This contract provides public artifact transport with cryptographically and structurally verified artifact identity. It does not use repository secrecy as the artifact trust boundary.

It does not claim:

```text
per-device entitlement
application attestation
DRM
prevention of copying by an already-authorized user
commercial license enforcement
```

A public central-cache artifact may be downloaded outside Simple Connection; direct download does not establish Registry acceptance or verified installation eligibility.

Commercial entitlement or per-device access may be introduced by a future contract without weakening v2 artifact integrity, immutability, and fail-closed delivery rules.
