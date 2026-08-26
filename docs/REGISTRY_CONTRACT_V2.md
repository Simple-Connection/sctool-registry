# SCTool Registry Contract v2

`contract_version: 2.0.0`

This document is the canonical SCTool Registry admission and artifact-distribution contract after v2 activation.
It supersedes `docs/REGISTRY_CONTRACT_V1.md` for current Registry admission/distribution behavior while retaining v1 as historical documentation.

The breaking change from v1 is deliberate:

```text
v1: final .sctool artifacts are anonymously downloadable over HTTPS
v2: final .sctool artifacts require authenticated GitHub access to the canonical private artifact repository
```

GitHub Pages metadata signing, Root/Distribution trust, immutable snapshots, and client anti-rollback remain governed by `docs/PAGES_DISTRIBUTION_V1.md`. Where that v1 Pages document describes `.sctool` payloads as anonymous assets, this Registry Contract v2 and `docs/REGISTRY_ACCESS_V1.md` supersede only that payload-access assumption; the signed metadata mechanics remain unchanged.

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

The v2 Registry contract does not change the signed submission payload merely because artifact delivery becomes authenticated.

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

Authenticated delivery does not weaken artifact integrity requirements.

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

Authentication controls who may retrieve an artifact; it does not redefine artifact identity or allow mutable replacement.

## 7. Authenticated distribution

The canonical Registry metadata remains public and may be distributed through signed GitHub Pages metadata.

The final `.sctool` artifact backend is:

```text
provider:             github.com
backend:              github-release-asset
repository:           Simple-Connection/sctool-artifacts
repositoryVisibility: private
```

End-user artifact retrieval requires the GitHub identity/access contract defined by:

```text
docs/REGISTRY_ACCESS_V1.md
```

A conforming client must establish:

```text
GitHub CLI available
+ authenticated github.com session
+ canonical GitHub identity resolved via `gh api user`
+ authenticated read access to Simple-Connection/sctool-artifacts
```

before attempting private `.sctool` artifact retrieval.

The client must not require publisher repository permission or a publisher API token. Access is granted against the canonical Registry artifact repository, not the publisher source repository.

The canonical release tag shape remains:

```text
sctool/{packageId}/v{version}
```

Example:

```text
sctool/openai-local-bridge/v0.3.1
```

`.sctool` payloads must not be committed into Registry Git history.

Knowing an artifact URL, asset ID, tag, or asset name is not itself authorization to read a private artifact.

## 8. GitHub identity boundary

GitHub authentication and Registry authorization are distinct:

```text
authentication
= establish which github.com account is active

authorization
= establish whether that account may read Simple-Connection/sctool-artifacts
```

The canonical current identity is the login returned by:

```text
gh api user --jq ".login"
```

The Registry SDK/CLI must not mint a separate Simple Connection private client key for Registry access and must not extract GitHub token material merely to establish identity.

Inherited `GH_TOKEN` and `GITHUB_TOKEN` values must not override the interactive GitHub CLI credential-store identity used for Registry access.

Detailed state normalization and failure semantics are defined by `REGISTRY_ACCESS_V1`.

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

Private GitHub artifact repository
= authenticated immutable .sctool payload backend

GitHub
= end-user identity provider + private repository authorization

Simple Connection / SCTool Registry CLI
= Registry metadata consumer + GitHub identity/access consumer + artifact verifier
```

Simple Connection UI, local install state, activation, and runtime policy are outside the Registry contract.

## 10. Version/channel indirection

Simple Connection must not hardcode individual SCTool package versions.

Package descriptors continue to resolve:

```text
defaultChannel
channels
versions
```

to a concrete version at runtime.

Authenticated artifact delivery changes how the selected payload is retrieved, not how the package version is selected.

## 11. Current descriptor transition

Registry Contract v2 activates authenticated artifact access before the later CLI/download work is complete.

The current package descriptor schema still requires an HTTPS artifact `url`. A later P2 artifact-delivery revision may replace or augment this with a structured GitHub Release asset locator such as repository/asset identity.

Until that descriptor revision is adopted:

```text
packages = 0
production trust = inactive
```

means no published package depends on the transitional locator shape.

The Registry must not publish a package whose descriptor cannot be retrieved and verified through the authenticated v2 access boundary.

## 12. Security properties and non-goals

This contract provides GitHub-account authorization for private Registry artifacts.

It does not claim:

```text
per-device entitlement
application attestation
DRM
prevention of copying by an already-authorized user
commercial license enforcement
```

An authorized GitHub user may use their own valid GitHub credentials outside Simple Connection to access a permitted artifact.

Commercial entitlement or per-device access may be introduced by a future contract without weakening the v2 artifact integrity and immutability rules.
