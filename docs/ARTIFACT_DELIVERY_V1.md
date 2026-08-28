# SCTool Artifact Content / Delivery Boundary v1

`artifact_delivery_contract_version: 1.0.0`

This document defines the backend-neutral artifact boundary used by SCTool Registry package descriptors.
It is intentionally limited to the separation between immutable artifact content metadata and transport-specific delivery metadata.
Backend discriminator rules, concrete GitHub Release asset locator requirements, and the package descriptor schema migration are defined by later P2 work units.

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
    "type": "<delivery discriminator>",
    "access": {},
    "locator": {}
  },
  "publishedAt": "2026-08-28T00:00:00Z",
  "contract": {
    "sctoolSpecVersion": "1.0.0"
  },
  "signature": {}
}
```

This example shows field placement only. It does not activate or define a concrete delivery backend.

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

`delivery` contains only information required to select an approved retrieval adapter, establish the applicable access contract, and locate the artifact inside that backend.

The boundary is:

```text
delivery.type
  selects the backend adapter

delivery.access
  references the authorization/access contract

delivery.locator
  contains backend-specific locator fields
```

P2-W1 does not define the allowed values or provider-specific schema for these fields.
Those rules belong to P2-W2 and P2-W3.

Delivery metadata must never become an alternative integrity authority.
In particular, a backend-specific digest, size, filename, or derived package identity must not override `content` or `target`.

## 6. Authority table

| Concern | Canonical authority |
|---|---|
| Package identity | package descriptor `id` |
| Version identity | `versions` key |
| Target identity | artifact map key + `target` |
| Canonical filename | `content.filename` |
| Artifact digest | `content.sha256` |
| Artifact byte length | `content.size` |
| Retrieval backend | `delivery.type` |
| Access contract | `delivery.access` |
| Backend locator | `delivery.locator` |
| Publication timestamp | `publishedAt` |
| SCTool compatibility | `contract` |
| Publisher submission evidence | `signature` |

No delivery backend may redefine an authority owned by another row.

## 7. Duplication rules

A package descriptor should not duplicate values that can be derived from canonical Registry identity or another authoritative field when duplication creates consistency risk.

Examples of values that should not become parallel authorities:

```text
backend asset/object name vs content.filename
backend checksum vs content.sha256
backend reported size vs content.size
release/tag path derivable from packageId/version
provider name duplicated outside delivery.type
repository visibility duplicated from Registry policy
```

A backend adapter may observe these values while resolving or retrieving an artifact, but Registry validation must compare them against the canonical authority rather than persist competing copies without a specific contract requirement.

## 8. Security invariants

The separation must preserve all of these properties:

```text
knowledge of a locator is not authorization
credentials are never package metadata
artifact bytes are verified against content.sha256 after retrieval
artifact byte length is verified against content.size
same packageId + version + target with different digest remains a hard reject
publisher submission signature scope is unchanged by delivery separation
private/public source-repository visibility does not redefine artifact access
```

`delivery` may reference an access contract, but must not carry tokens, credential material, private keys, authenticated user identity, or device entitlement state.

## 9. Transition from descriptor schema 1.0.0

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
url       -> removed as a common artifact field; delivery metadata owns retrieval location
```

This document does not itself change `schemas/package.schema.json`.
The breaking package schema revision and validation rules are implemented in P2-W4 after the delivery discriminator and concrete locator contracts are defined.

## 10. Pages distribution compatibility

GitHub Pages signed snapshots aggregate complete package descriptors rather than interpreting individual artifact transport fields.
Therefore this content/delivery boundary does not require a Pages snapshot format change by itself.
When package descriptor schema 2.0.0 is implemented, Pages regression validation must still confirm that descriptor aggregation and signature generation remain unchanged in meaning.

## 11. Non-goals of this contract unit

P2-W1 does not define:

```text
allowed delivery.type values
GitHub repository/assetId locator schema
artifact download commands
GitHub CLI invocation details
channel/version resolution changes
production trust activation
additional delivery backends
per-device/commercial entitlement
```

Those concerns remain outside this work unit or are assigned to later approved sessions/work units.
