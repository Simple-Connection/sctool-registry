# SCTool Artifact Content / Delivery Boundary v1

`artifact_delivery_contract_version: 1.0.0`

`package_descriptor_schema_version: 2.0.0`

This document defines the canonical backend-neutral artifact boundary used by SCTool Registry package descriptors.
Registry Distribution `1.0.1` adopts this contract together with `schemas/package.schema.json` schema `2.0.0`.

The contract separates:

```text
content
= what exact artifact bytes are expected

delivery
= how an authorized client locates/retrieves those bytes
```

Changing a delivery backend must not redefine package identity, target identity, expected artifact digest, expected byte size, publisher evidence, or SCTool compatibility.

## 1. Canonical artifact entry

A package descriptor artifact uses this shape:

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

`schemas/package.schema.json` `2.0.0` machine-enforces this envelope.

## 2. Identity and content authority

Registry artifact identity remains:

```text
(packageId, version, target)
```

where the artifact map key must equal:

```text
target.platform + "-" + target.arch
```

`content` owns backend-independent exact-byte facts:

```text
content.filename
content.sha256
content.size
```

Authorities are:

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

A backend observation may be compared with these authorities but may not replace them.

## 3. Delivery discriminator contract

The common delivery envelope is exactly:

```text
delivery.type
  explicit backend discriminator

delivery.access.contract
  access/authorization contract reference

delivery.locator
  backend-specific locator object
```

`delivery.type` is the sole backend discriminator.
It must not be inferred from URL shape, repository name, locator fields, access contract, filename, or any other metadata.

Registry Distribution `1.0.1` accepts only:

```text
github-release-asset
```

Unknown types fail closed. There is no wildcard or generic HTTPS fallback.

For this type:

```text
delivery.access.contract = registry-access-v1
```

`delivery.access` is a contract reference only. It must not contain or redefine:

```text
provider
credential source
required repository permission
repository visibility
authenticated user/login
token or token source
session identifier
private/public key material
device identity
entitlement/license state
```

Those concerns remain owned by `docs/REGISTRY_ACCESS_V1.md` and Registry policy.

## 4. GitHub Release asset locator

The `github-release-asset` locator is intentionally minimal:

```json
{
  "repository": "Simple-Connection/sctool-artifacts",
  "assetId": 123456789
}
```

### `locator.repository`

`repository` is an `owner/name` GitHub repository coordinate.
For Registry Distribution `1.0.1`, it must equal:

```text
Simple-Connection/sctool-artifacts
```

The equality authority is `policy/registry-policy.json`.
A package descriptor cannot redirect itself to a publisher or third-party repository.

### `locator.assetId`

`assetId` is an opaque GitHub Release asset numeric identifier.
For canonical JSON interoperability it is restricted to a positive JavaScript-safe integer:

```text
1 <= assetId <= 9007199254740991
```

`assetId` is delivery metadata, not a fourth Registry artifact identity component.

## 5. Deliberately omitted GitHub fields

The locator does not persist these as parallel authorities:

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

Reasons include:

```text
assetName
  -> content.filename is canonical

releaseTag
  -> derived from packageId/version

URLs
  -> transport representations, not immutable Registry identity

repository visibility/provider/credential source
  -> Registry policy and REGISTRY_ACCESS_V1 own them
```

## 6. Canonical release identity and resolution

The expected release tag is derived rather than stored:

```text
sctool/{packageId}/v{version}
```

After `registry-access-v1` succeeds, a conforming resolver must conceptually:

```text
1. require locator.repository == Registry policy artifact repository
2. derive expectedTag = sctool/{packageId}/v{version}
3. resolve the non-draft release identified by expectedTag
4. inspect that release's assets
5. find exactly one asset whose numeric id == locator.assetId
6. require resolved asset.name == content.filename
7. when backend size is available, require it == content.size
8. retrieve that exact asset through the authenticated access boundary
9. require downloaded byte length == content.size
10. require SHA-256(downloaded bytes) == content.sha256
```

The following fail closed:

```text
repository mismatch
missing expected release
expected release is draft
assetId absent from expected release
resolved asset name mismatch
backend-reported size mismatch
retrieved byte-length mismatch
retrieved SHA-256 mismatch
```

Failure does not authorize cross-release search, same-name fallback, arbitrary URL fallback, or anonymous HTTPS fallback.

## 7. Immutability interaction

Publication remains content-immutable:

```text
same packageId + version + target + same content.sha256
= idempotent publication retry

same packageId + version + target + different content.sha256
= hard reject
```

A disappeared or invalid locator is a delivery failure. It does not authorize rewriting immutable publication history or silently substituting replacement bytes.

## 8. Machine enforcement

`schemas/package.schema.json` `2.0.0` enforces:

```text
artifact requires target/content/delivery/publishedAt/contract/signature
content requires filename/sha256/size
legacy flat assetName/url/sha256/size artifact shape is rejected
delivery.type is const github-release-asset
delivery.access.contract is const registry-access-v1
locator requires repository + assetId
assetId and content.size are positive JavaScript-safe integers
unknown delivery/access/locator fields are rejected
```

`tools/validate-registry.py` additionally enforces cross-field and policy consistency:

```text
package id == registry index key
defaultChannel exists in channels
all channel versions exist in versions
artifact map key == target.platform-target.arch
delivery.type == Registry policy backend
delivery.access.contract == Registry policy contract
locator.repository == Registry policy artifact repository
```

`tools/test-delivery-package-schema-v2.py` provides one positive and thirteen negative regression cases for these rules.

## 9. Pages distribution compatibility

GitHub Pages signed snapshots aggregate complete package descriptors rather than interpreting individual artifact transport fields.
The snapshot schema resolves `package.schema.json`, so package descriptor `2.0.0` remains inside the existing signed snapshot envelope without changing head/snapshot identity semantics.

P2-W5 validation used the exact `dev/1.0.1` `tools/validate-pages.py` and exact schema blobs with a synthetic snapshot containing a valid package descriptor `2.0.0`; validation passed.

The numeric `assetId` safe-integer restriction is compatible with SCTool canonical JSON v1 signed metadata.

## 10. Security invariants

```text
knowledge of repository + assetId is not authorization
credentials are never package metadata
unknown delivery types fail closed
unregistered type/access combinations fail closed
repository self-redirection is forbidden
assetId must resolve inside the derived expected release
no same-name, cross-release, arbitrary-URL, or anonymous fallback is permitted
artifact bytes are verified against content.sha256
artifact byte length is verified against content.size
publisher submission signature scope remains sctool-submission-v1
private/public source-repository visibility does not redefine artifact access
```

## 11. Transition status

The descriptor `1.0.0` flat transport shape:

```text
assetName
url
sha256
size
```

has been replaced by package descriptor schema `2.0.0`:

```text
assetName -> content.filename
sha256    -> content.sha256
size      -> content.size
url       -> removed as a common artifact field
             delivery.type/access/locator own retrieval description
```

No compatibility bridge is required for this transition because `registry.json` currently contains zero packages and production trust remains inactive.

## 12. Non-goals

This contract does not implement:

```text
artifact download commands
SCTool CLI update/install behavior
production Root trust activation
additional delivery backends
per-device entitlement
commercial licensing
application attestation
```

Those require separate approved work.