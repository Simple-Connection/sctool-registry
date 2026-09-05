# SCTool Registry Client SDK

Package: `@simple-connection/sctool-registry-client-sdk`

This SDK is owned by `Simple-Connection/sctool-registry` and exists for **Simple Connection Registry consumption**.

It is intentionally separate from `Kinirin/Simple-Connection/program-sdk/sctool-sdk`, which is the SCTool **Authoring SDK** used by developers and coding agents to design, validate, build, test, and package their own tools as `.sctool` artifacts.

## Responsibilities

The Registry Client SDK owns the consumer-side implementation of Registry contracts, including:

- Registry metadata and package descriptor consumption;
- `registry-access-v1` identity/authorization behavior;
- package/channel/version/target resolution;
- delivery discriminator and exact backend locator handling;
- authenticated streaming artifact retrieval;
- ephemeral Registry-owned staging;
- filename/size/SHA-256 verification;
- read-only verified artifact access;
- normalized verified update candidates for Simple Connection.

## Current public surfaces

```text
@simple-connection/sctool-registry-client-sdk
@simple-connection/sctool-registry-client-sdk/registry-access
@simple-connection/sctool-registry-client-sdk/package-descriptor
@simple-connection/sctool-registry-client-sdk/resolution
@simple-connection/sctool-registry-client-sdk/artifact-delivery
@simple-connection/sctool-registry-client-sdk/update-candidate
```

`package-descriptor` validates the current package descriptor contract (`schemaVersion = 2.0.0`) and the Registry policy consistency needed by a consumer. Validation is fail-closed and returns an immutable validated descriptor or structured issues.

`resolution` deterministically resolves:

```text
defaultChannel or explicit channel
-> concrete version
-> exact platform-arch target
-> content + delivery metadata
```

No version or target fallback is performed.

## P2 boundary

Distribution `1.0.2` P2 owns descriptor/channel/version/target resolution only.

P2 may validate and preserve:

```text
content.filename
content.sha256
content.size
delivery.type
delivery.access.contract
delivery.locator.repository
delivery.locator.assetId
```

P2 does **not** use the locator to query a live GitHub Release or download bytes.

## P3 boundary

Distribution `1.0.2` P3 established exact release/asset binding and authenticated GitHub CLI retrieval. P4 preserves that authority while replacing whole-artifact buffering with a streaming transport.

`artifact-delivery` resolves the derived release tag `sctool/{packageId}/v{version}`, requires the exact numeric `delivery.locator.assetId` inside that non-draft release, and opens the exact authenticated asset as a binary stream. Backend asset name and size remain observations until P4 integrity verification.

## P4 boundary

Distribution `1.0.2` P4 owns file-backed verification without creating Simple Connection install state:

```text
authenticated asset stream
-> SDK-internal OS temporary staging
-> single-pass byte count + SHA-256
-> filename/backend-size/downloaded-size/digest verification
-> VERIFIED staging resource
-> read-only VerifiedArtifactLease
-> VerifiedUpdateCandidate
```

The staging filename is SDK-internal and never derived from `content.filename`. Partial or failed staging resources are disposed. Oversized streams abort as soon as the declared `content.size` is exceeded. The public candidate does not expose the raw staging path or write access.

A `VerifiedUpdateCandidate` contains Registry metadata and an `artifact` lease with:

```text
openReadStream()
dispose()
```

It deliberately does not contain GitHub credentials/identity, installed version, update availability decisions, install paths, activation, rollback, runtime state, or renderer state. Persistent product-owned installation begins only after a later approved Simple Connection integration boundary.

## Non-goals

This SDK must not implement:

- SCTool scaffold/build/test/sign/package authoring;
- publisher submission production;
- Simple Connection local install state;
- active-version selection or rollback;
- renderer/UI behavior;
- production Root trust activation.

The package is currently marked `private` to prevent accidental publication before an explicit SDK distribution mechanism is approved.
