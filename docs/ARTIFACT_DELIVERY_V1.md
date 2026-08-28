# SCTool Artifact Content / Delivery Boundary v1

`artifact_delivery_contract_version: 1.0.0`

This document defines the backend-neutral artifact boundary used by SCTool Registry package descriptors.
It separates immutable artifact content metadata from transport-specific delivery metadata and defines the common delivery discriminator/access/locator dispatch contract.
Concrete GitHub Release asset locator fields and the package descriptor schema migration are defined by later P2 work units.

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
    "access": {
      "contract": "<registered access contract>"
    },
    "locator": {}
  },
  "publishedAt": "2026-08-28T00:00:00Z",
  "contract": {
    "sctoolSpecVersion": "1.0.0"
  },
  "signature": {}
}
```

This example shows common field placement only. Provider-specific locator fields are intentionally omitted until their own locator contract is adopted.

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

Registering the discriminator does not define the GitHub locator fields themselves; those fields remain P2-W3 responsibility.
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

P2-W2 deliberately does not define the concrete fields inside the `github-release-asset` locator. P2-W3 owns that contract.

### 5.4 Registered delivery dispatch table

Registry Distribution `1.0.1` defines this dispatch registration:

| `delivery.type` | access contract | locator contract | state |
|---|---|---|---|
| `github-release-asset` | `registry-access-v1` | P2-W3 GitHub Release asset locator | registered; locator fields pending W3 |

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
10. only after access succeeds may retrieval be attempted
11. retrieved bytes are then verified against content.size/content.sha256
```

Metadata dispatch itself performs no authentication and grants no authorization.

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
| Access contract | `delivery.access.contract` |
| Backend locator | `delivery.locator` interpreted only by the selected type contract |
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
credential source duplicated from Registry access policy
```

A backend adapter may observe these values while resolving or retrieving an artifact, but Registry validation must compare them against the canonical authority rather than persist competing copies without a specific contract requirement.

## 8. Security invariants

The separation and discriminator contract must preserve all of these properties:

```text
knowledge of a locator is not authorization
credentials are never package metadata
unknown delivery types fail closed
unregistered type/access combinations fail closed
missing type-specific locator validation fails closed
no generic transport fallback is permitted
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
The breaking package schema revision and machine-enforced `oneOf`/`const` dispatch rules are implemented in P2-W4 after the concrete locator contract is defined in P2-W3.

## 10. Pages distribution compatibility

GitHub Pages signed snapshots aggregate complete package descriptors rather than interpreting individual artifact transport fields.
Therefore this content/delivery/discriminator contract does not require a Pages snapshot format change by itself.
When package descriptor schema 2.0.0 is implemented, Pages regression validation must still confirm that descriptor aggregation and signature generation remain unchanged in meaning.

## 11. Work-unit boundary after P2-W2

P2-W1 established:

```text
artifact content authority vs delivery authority
```

P2-W2 establishes:

```text
explicit delivery.type dispatch
registered type/access pairing
delivery.access as a contract reference only
delivery.locator as a type-isolated object
unknown/missing dispatch fail-closed behavior
```

Still not defined by P2-W2:

```text
GitHub repository/assetId locator fields             -> P2-W3
package.schema.json 2.0.0 machine enforcement        -> P2-W4
REGISTRY_CONTRACT_V2 transition closeout             -> P2-W5
artifact download commands                           -> outside P2
production trust activation                          -> outside P2
additional delivery backends                         -> outside 1.0.1
per-device/commercial entitlement                    -> outside P2
```
