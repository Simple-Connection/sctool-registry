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
Where that v1 Pages document describes `.sctool` payloads as anonymous assets, this contract, `docs/REGISTRY_ACCESS_V1.md`, and `docs/ARTIFACT_DELIVERY_V2.md` supersede only that payload-access/delivery assumption; signed metadata mechanics remain unchanged.

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

The submission signature algorithm is Ed25519.

The active submission schema and signature scope are:

```text
schemas/submission.schema.json
schemaVersion = 2.0.0
scope = sctool-submission-v2
```

Submission v2 binds both the exact publisher-origin locator and explicit publication intent into publisher-signed evidence.

The canonical UTF-8 payload is LF-delimited in the exact order below, with no trailing LF:

```text
SCTOOL-SUBMISSION-V2
{submission.id}
{submission.createdAt}
{package.id}
{package.version}
{target.platform}
{target.arch}
{artifact.filename}
{artifact.sha256}
{artifact.size}
{origin.type}
{origin.repository}
{origin.releaseId}
{origin.assetId}
{publication.marketplace}
{publication.publicRedistribution}
{contract.sctoolSpecVersion}
{contract.sdkVersion}
{publisher.id}
{publisher.keyId}
```

Boolean publication fields are serialized as lowercase `true` or `false`.

`artifact.sha256` is lowercase hexadecimal SHA-256 of the exact submitted `.sctool` bytes.
`artifact.size`, `origin.releaseId`, and `origin.assetId` are unsigned base-10 integers.

The Registry reconstructs this payload from the submission and verifies the signature against the registered publisher public key.

`publication.marketplace = true` is explicit Marketplace publication intent.
`publication.publicRedistribution = true` additionally grants Simple-Connection permission to place the exact accepted bytes in the bounded public central cache.

A publisher Release existing by itself is not publication intent.

Package descriptor field placement after admission is governed by `ARTIFACT_DELIVERY_V2`. The accepted package descriptor preserves the v2 publication intent and signature evidence.

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

Long-term artifact custody belongs to the publisher origin recorded in the accepted package descriptor.

The bounded Simple-Connection cache backend is:

```text
provider:             github.com
backend:              github-release-asset
repository:           Simple-Connection/sctool-artifacts
repositoryVisibility: public
accessContract:       registry-public-integrity-v1
role:                 current-default-channel-cache
```

The current default-channel version is exactly:

```text
package.channels[package.defaultChannel]
```

Only that version may carry a central-cache locator in steady-state Registry metadata, and only when publisher-signed submission evidence permits public redistribution.

Historical and alternate-channel versions are retrieved from their exact publisher origin.

Package schema `3.0.0` records exact GitHub locators as:

```text
repository
releaseId
assetId
```

Release tags are observations only and are not locator authority. A conforming client resolves the exact numeric release ID and exact numeric asset ID.

For a current version with a valid cache locator, the cache is preferred. If cache retrieval or integrity verification fails, the client may retry the exact publisher origin for the same accepted content identity.

If every allowed exact location is unavailable or fails verification, the result is:

```text
ARTIFACT_UNAVAILABLE
```

No failure permits version substitution, target substitution, cross-release search, same-name search, mutable-latest lookup, or digest substitution.

`.sctool` payloads must not be committed into Registry Git history.

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

The canonical package descriptor schema is:

```text
schemas/package.schema.json
schemaVersion = 3.0.0
```

The current artifact delivery contract is:

```text
docs/ARTIFACT_DELIVERY_V2.md
artifact_delivery_contract_version = 2.0.0
```

`ARTIFACT_DELIVERY_V1` remains the historical single-central-locator reference.

The canonical artifact shape separates immutable content identity from delivery locations:

```text
artifact
├─ target
├─ content
│  ├─ filename
│  ├─ sha256
│  └─ size
├─ delivery
│  ├─ type = github-release-asset
│  ├─ access.contract = registry-public-integrity-v1
│  ├─ origin
│  │  ├─ repository
│  │  ├─ releaseId
│  │  └─ assetId
│  └─ cache (optional)
│     ├─ repository
│     ├─ releaseId
│     └─ assetId
├─ publication
│  ├─ marketplace = true
│  └─ publicRedistribution = true | false
├─ publishedAt
├─ contract
└─ signature.scope = sctool-submission-v2
```

`delivery.origin` is always required.

`delivery.cache` is optional and may exist only for the current default-channel version. Its repository must equal `Simple-Connection/sctool-artifacts`, and signed publication evidence must have `publicRedistribution = true`.

The publisher origin repository is not constrained to the central cache repository.

Unknown delivery types, malformed locators, historical cache locators, unconsented cache locators, and content identity mismatches fail closed.

No compatibility bridge is required for the package-schema-2 to package-schema-3 transition because the Registry currently contains zero published packages.

## 12. Pages distribution compatibility

Signed GitHub Pages snapshots continue to aggregate complete package descriptors.
The existing head/snapshot signing and anti-rollback model is unchanged by package descriptor schema `3.0.0`.

`registry-snapshot.schema.json` resolves `package.schema.json`, so a package descriptor `3.0.0` is validated inside the existing signed snapshot envelope.

The numeric `assetId` is restricted to the JavaScript safe-integer range to remain compatible with SCTool canonical JSON v1 signed metadata.

Production trust activation remains separately deferred. Adoption of descriptor schema `3.0.0` does not activate Root trust or Pages publication by itself.

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
