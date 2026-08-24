# SCTool Registry Contract v1

`contract_version: 1.0.0`

This document defines the first canonical boundary between the SCTool SDK publisher side and Registry Intake.

## 1. Identity

The immutable artifact identity is:

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

Source code is outside the Registry trust boundary.

A source repository may be:

```text
public
private
self-hosted
undisclosed
```

No source repository URL or source visibility declaration is required for package admission.
If a package descriptor includes `source`, it is informational provenance only.

## 3. Publisher-side lifecycle

The intended SDK lifecycle is:

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

The only v1 submission signature algorithm is Ed25519.

The signature scope is:

```text
sctool-submission-v1
```

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

The registry reconstructs this payload from the received submission and verifies the signature
against the registered publisher public key.

## 5. Registry Intake validation

Acceptance requires independent Registry-side validation.

Minimum checks:

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

The registry must validate the uploaded artifact itself. A publisher-provided `PASS` field,
test log, or checksum report is not authoritative.

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

## 7. Distribution

The final artifact endpoint must use HTTPS and be anonymously downloadable by Simple Connection.
The end user must not need a GitHub account, publisher repository permission, or publisher API token.

When this registry uses GitHub Releases as the public artifact backend, the canonical tag is:

```text
sctool/{packageId}/v{version}
```

`.sctool` payloads must not be committed into Registry Git history.

## 8. Authority split

```text
Publisher repository
= source + local build configuration

SCTool SDK
= canonical package/submission producer + publisher-side validation

Registry Intake
= independent verifier + ownership/immutability enforcement

Registry Git metadata
= public discovery authority

Public artifact backend
= immutable downloadable payload

Simple Connection
= registry consumer + verifier + installer
```
