# SCTool Artifact Content / Delivery Boundary v1

`artifact_delivery_contract_version: 1.0.0`

This document defines the backend-neutral artifact boundary used by SCTool Registry package descriptors.
It separates immutable artifact content metadata from transport-specific delivery metadata, defines the common delivery discriminator/access/locator dispatch contract, and defines the concrete GitHub Release asset locator used by Registry Distribution `1.0.1`.
The package descriptor schema migration is defined by later P2 work.

## 1. Scope

For every concrete package artifact selected by:

```text
(packageId, version, target)
```

the Registry must describe two different responsibilities separately:

```text
content
= what exact artifact bytes are expected

delivery
= how an authorized client locates/retrieves those bytes
```

Changing a delivery backend must not redefine package identity, target identity, expected artifact digest, expected byte size, publisher signature evidence, or SCTool compatibility contract.

## 2. Canonical artifact entry boundary

The target package descriptor schema is organized around this artifact entry boundary:

```json
{
  "target": {
    "platform": "win",
    "arch": "x64"
  },
  "content": {
    "filename": "example-1.2.3-win-x64.sctool",
    "sha256": "<64 lowercase hex characters>",
    "size": 123456
  },
  "delivery": {
    "type": "github-release-asset",
    "access": {
      "contract": "registry-access-v1"
    },
    "locator": {
      "repository": "Simple-Connection/sctool-artifacts",
      "assetId": 123456789
    }
  },
  "publishedAt": "2026-08-28T00:00:00Z",
  "contract": {
    "sctoolSpecVersion": "1.0.0"
  },
  "signature": {}
}
```

This example shows the adopted `github-release-asset` locator shape. It is still a contract example until `schemas/package.schema.json` 2.0.0 machine-enforces it in P2-W4.

## 3. `target` responsibility

`target` identifies the artifact variant selected for a platform and architecture.

Required conceptual fields:

```text
platform
arch
```

The surrounding artifact map key and the `target` object must remain consistent.
Target identity belongs to Registry package/version selection and is not a delivery locator.

## 4. `content` responsibility

`content` contains backend-independent facts about the exact artifact expected after retrieval.

The canonical fields are:

```text
filename
sha256
size
```

### `content.filename`

`filename` is the canonical artifact filename published by the Registry.
A delivery backend may expose its own object/asset name, but that backend value is not a second naming authority.
Where a backend has an independently observable name, Registry validation must verify that it matches `content.filename`.

### `content.sha256`

`sha256` is the lowercase hexadecimal SHA-256 digest of the exact `.sctool` bytes.
It remains authoritative regardless of delivery backend.

### `content.size`

`size` is the exact artifact byte length represented as a positive integer.
It remains authoritative regardless of delivery backend.

## 5. `delivery` responsibility

`delivery` contains only information required to select an approved retrieval adapter, identify the applicable access contract, and locate the artifact inside that backend.

The common shape is exactly:

```text
delivery.type
  explicit backend discriminator

delivery.access.contract
  access/authorization contract reference

delivery.locator
  backend-specific locator object
```

The common delivery envelope must not infer one field from another. A client or Registry validator must not infer `type` from a URL, repository name, locator shape, access contract, filename, or any other metadata.

### 5.1 `delivery.type` — sole backend discriminator

`delivery.type` is the only field that selects a delivery adapter and locator schema branch.

Rules:

```text
- it is explicit, never inferred
- one value selects exactly one registered delivery contract branch
- unknown values fail closed
- a missing registered validator fails closed
- clients must not fall back to generic HTTPS or another backend
- provider/backend aliases outside the registered value are not accepted
```

For Registry Distribution `1.0.1`, the only registered delivery type is:

```text
github-release-asset
```

No additional backend is implicitly authorized by the extensible envelope.

### 5.2 `delivery.access` — contract reference, not credential configuration

`delivery.access` identifies which Registry access contract must be satisfied before retrieval is attempted.

The common shape is:

```json
{
  "contract": "registry-access-v1"
}
```

For `github-release-asset` in Registry Distribution `1.0.1`, the registered access contract is exactly:

```text
registry-access-v1
```

This reference points to `docs/REGISTRY_ACCESS_V1.md`. It does not duplicate that contract's operational policy.

Therefore `delivery.access` must not contain or redefine:

```text
provider
credentialSource
requiredRepositoryPermission
repositoryVisibility
authenticated user/login
token or token source
session identifier
private/public key material
device identity
entitlement/license state
```

Those concerns are owned by the Registry access contract and Registry policy, not by a package descriptor.
A client must evaluate the referenced access contract independently and fail closed when it is not satisfied.

### 5.3 `delivery.locator` — isolated provider-specific location data

`delivery.locator` is a required object whose allowed fields are determined only after `delivery.type` has selected a registered locator validator.

Common rules:

```text
- locator fields are backend-specific
- locator cannot change package/version/target identity
- locator cannot redefine content.filename/content.sha256/content.size
- locator cannot contain credential or authenticated-user material
- locator cannot select a different access contract
- an unknown or structurally invalid locator fails closed
```

For `github-release-asset`, the concrete locator is defined in section 6.

### 5.4 Registered delivery dispatch table

Registry Distribution `1.0.1` defines this dispatch registration:

| `delivery.type` | access contract | locator contract | state |
|---|---|---|---|
| `github-release-asset` | `registry-access-v1` | section 6 GitHub Release asset locator | active contract |

There is no wildcard backend and no generic fallback branch.
Future backends require an explicit contract revision that registers their discriminator, access mapping, locator schema, validation behavior, and security invariants.

### 5.5 Canonical dispatch algorithm

A conforming Registry validator/client must conceptually process delivery metadata in this order:

```text
1. require delivery.type, delivery.access, delivery.locator
2. resolve delivery.type against the registered delivery table
3. reject if the type is unknown
4. require the access contract registered for that type
5. reject an unregistered or mismatched access contract
6. select the locator validator registered for that type
7. reject if no locator validator exists
8. validate delivery.locator with that type-specific contract
9. only after metadata validation, evaluate the referenced access contract
10. only after access succeeds may backend resolution/retrieval be attempted
11. validate backend observations against package/version/content authorities
12. retrieved bytes are verified against content.size/content.sha256
```

Metadata dispatch itself performs no authentication and grants no authorization.

## 6. GitHub Release asset locator contract

The `github-release-asset` locator is intentionally minimal:

```json
{
  "repository": "Simple-Connection/sctool-artifacts",
  "assetId": 123456789
}
```

Exactly these two concepts identify where the selected Registry artifact is expected to exist. Other GitHub response fields are observations, not package metadata authorities.

### 6.1 `locator.repository`

`repository` is the GitHub repository coordinate in canonical:

```text
owner/name
```

form.

For Registry Distribution `1.0.1`, it must equal the canonical artifact backend repository owned by `policy/registry-policy.json`:

```text
Simple-Connection/sctool-artifacts
```

The descriptor carries the repository coordinate because the GitHub Release asset API resolves an asset in repository context. The descriptor does not own repository visibility, provider identity, credential source, or required permission; those remain Registry policy/access-contract concerns.

Validation requirements:

```text
- repository is present
- repository uses canonical owner/name form
- repository exactly matches the Registry policy artifact repository
- repository mismatch fails closed
```

A future backend-repository migration requires an explicit Registry policy/contract revision. A package descriptor cannot redirect itself to an arbitrary publisher or third-party repository.

### 6.2 `locator.assetId`

`assetId` is the GitHub Release asset numeric identifier used inside the canonical repository.

It is treated as an opaque locator identity, not as an ordered Registry version number and not as an authorization token.

For JSON/canonical-signing interoperability it must be a positive JavaScript-safe integer:

```text
1 <= assetId <= 9007199254740991
```

This aligns the locator with the Registry Pages canonical JSON rule that signed metadata contains only safe integers and prevents cross-language precision loss.

Validation requirements:

```text
- assetId is present
- assetId is an integer
- assetId is positive
- assetId is a safe integer
- zero, negative, fractional, NaN/infinite, string aliases, and out-of-range values are invalid
```

Deleting and re-uploading an asset produces a different backend locator identity. The Registry must not silently reinterpret an old `assetId` as a replacement artifact.

### 6.3 Deliberately omitted GitHub fields

The locator must not persist these as parallel authorities:

```text
assetName
releaseTag
browserDownloadUrl
API URL
release ID
node ID
content type
uploader identity
repository visibility
provider
credential source
```

Reasons:

```text
assetName
  -> content.filename is canonical; GitHub name is verified against it

releaseTag
  -> derived from canonical packageId/version

browserDownloadUrl / API URL
  -> transport representations, not immutable Registry identity

release ID / node ID
  -> unnecessary when the expected release is derived by tag and assetId selects the asset

content type
  -> not an artifact identity or integrity authority

uploader identity
  -> not client authorization and not package identity

repository visibility/provider/credential source
  -> Registry policy and REGISTRY_ACCESS_V1 own these concerns
```

### 6.4 Canonical release identity

The expected GitHub Release tag is not stored in the locator. It is derived from canonical Registry package identity:

```text
sctool/{packageId}/v{version}
```

For example:

```text
packageId = openai-local-bridge
version   = 0.3.4

expected release tag
= sctool/openai-local-bridge/v0.3.4
```

This derivation is authoritative for locating the release that is allowed to contain the artifact. A descriptor cannot redirect its `assetId` to another release tag.

### 6.5 Canonical GitHub resolution algorithm

After `registry-access-v1` succeeds, a conforming resolver must conceptually:

```text
1. read locator.repository and require policy equality
2. derive expectedTag = sctool/{packageId}/v{version}
3. resolve the non-draft GitHub Release identified by expectedTag in locator.repository
4. inspect that release's assets
5. find exactly one asset whose numeric id equals locator.assetId
6. reject if the asset is absent or ambiguous
7. require resolved asset.name == content.filename
8. when GitHub reports asset size, require it to agree with content.size before download
9. retrieve that exact resolved asset through the authenticated GitHub access boundary
10. require downloaded byte length == content.size
11. require SHA-256(downloaded bytes) == content.sha256
```

The backend-reported size is an early consistency observation only. `content.size` and the downloaded byte count remain authoritative.
The downloaded SHA-256 is always checked against `content.sha256`; GitHub metadata does not replace Registry integrity verification.

### 6.6 Release and asset consistency failures

All of the following fail closed:

```text
repository differs from Registry policy
expected release tag does not exist
resolved release is draft
assetId is not present in the expected release
more than one backend observation is inconsistent with assetId
resolved asset name differs from content.filename
resolved asset reported size differs from content.size
retrieved byte length differs from content.size
retrieved SHA-256 differs from content.sha256
```

A failure does not authorize searching other releases, trying a same-named asset elsewhere, following an arbitrary URL, or falling back to anonymous HTTPS.

### 6.7 Immutability interaction

Registry artifact identity remains:

```text
(packageId, version, target)
```

and immutability remains content-based:

```text
same packageId + version + target + same content.sha256
= idempotent publication retry

same packageId + version + target + different content.sha256
= hard reject
```

`assetId` is a delivery locator, not a fourth Registry artifact identity component. Once a descriptor is published, however, its locator must not be silently mutated to point to replacement bytes. Any backend disappearance or locator mismatch is a delivery failure, not permission to rewrite immutable publication history.

## 7. Authority table

| Concern | Canonical authority |
|---|---|
| Package identity | package descriptor `id` |
| Version identity | `versions` key |
| Target identity | artifact map key + `target` |
| Canonical filename | `content.filename` |
| Artifact digest | `content.sha256` |
| Artifact byte length | `content.size` |
| Retrieval backend | `delivery.type` |
| Access contract | `delivery.access.contract` |
| Backend repository coordinate | `delivery.locator.repository`, constrained by Registry policy |
| Backend asset locator | `delivery.locator.assetId` |
| Expected GitHub release tag | derived from package `id` + version |
| Publication timestamp | `publishedAt` |
| SCTool compatibility | `contract` |
| Publisher submission evidence | `signature` |

No delivery backend may redefine an authority owned by another row.

## 8. Duplication rules

A package descriptor should not duplicate values that can be derived from canonical Registry identity or another authoritative field when duplication creates consistency risk.

Examples of values that should not become parallel authorities:

```text
backend asset/object name vs content.filename
backend checksum vs content.sha256
backend reported size vs content.size
release/tag path derivable from packageId/version
provider name duplicated outside delivery.type
repository visibility duplicated from Registry policy
credential source duplicated from Registry access policy
```

A backend adapter may observe these values while resolving or retrieving an artifact, but Registry validation must compare them against the canonical authority rather than persist competing copies without a specific contract requirement.

## 9. Security invariants

The separation, discriminator contract, and GitHub locator contract must preserve all of these properties:

```text
knowledge of repository + assetId is not authorization
credentials are never package metadata
unknown delivery types fail closed
unregistered type/access combinations fail closed
missing type-specific locator validation fails closed
repository self-redirection is forbidden
assetId must resolve inside the derived expected release
no same-name or cross-release fallback is permitted
no generic transport fallback is permitted
artifact bytes are verified against content.sha256 after retrieval
artifact byte length is verified against content.size
same packageId + version + target with different digest remains a hard reject
publisher submission signature scope is unchanged by delivery separation
private/public source-repository visibility does not redefine artifact access
```

`delivery` may reference an access contract, but must not carry tokens, credential material, private keys, authenticated user identity, or device entitlement state.

## 10. Transition from descriptor schema 1.0.0

The current package descriptor schema stores these artifact fields flat:

```text
assetName
url
sha256
size
```

The target boundary is:

```text
assetName -> content.filename
sha256    -> content.sha256
size      -> content.size
url       -> removed as a common artifact field
             delivery.type/access/locator own retrieval description
```

For Registry Distribution `1.0.1`, the target GitHub locator is:

```text
delivery.type                  = github-release-asset
delivery.access.contract       = registry-access-v1
delivery.locator.repository    = Simple-Connection/sctool-artifacts
delivery.locator.assetId       = positive safe integer
```

This document does not itself change `schemas/package.schema.json`.
The breaking package schema revision and machine-enforced `oneOf`/`const`/locator constraints are implemented in P2-W4.

## 11. Pages distribution compatibility

GitHub Pages signed snapshots aggregate complete package descriptors rather than interpreting individual artifact transport fields.
Therefore this content/delivery/discriminator/locator contract does not require a Pages snapshot format change by itself.
When package descriptor schema 2.0.0 is implemented, Pages regression validation must still confirm that descriptor aggregation and signature generation remain unchanged in meaning.

The use of a numeric `assetId` is constrained to the JavaScript safe-integer range so it remains compatible with the existing SCTool canonical JSON v1 signed-metadata representation.

## 12. Work-unit boundary after P2-W3

P2-W1 established:

```text
artifact content authority vs delivery authority
```

P2-W2 established:

```text
explicit delivery.type dispatch
registered type/access pairing
delivery.access as a contract reference only
delivery.locator as a type-isolated object
unknown/missing dispatch fail-closed behavior
```

P2-W3 establishes:

```text
github-release-asset locator = repository + assetId
repository must equal Registry policy canonical artifact repository
assetId is a positive safe integer and opaque backend locator
derived expected release tag = sctool/{packageId}/v{version}
assetId must belong to that expected non-draft release
resolved asset name must equal content.filename
backend-reported size must agree with content.size when available
retrieved bytes must match content.size/content.sha256
no cross-release, same-name, arbitrary-URL, or anonymous fallback
```

Still not implemented by P2-W3:

```text
package.schema.json 2.0.0 machine enforcement        -> P2-W4
REGISTRY_CONTRACT_V2 transition closeout             -> P2-W5
artifact download commands                           -> outside P2
production trust activation                          -> outside P2
additional delivery backends                         -> outside 1.0.1
per-device/commercial entitlement                    -> outside P2
```
