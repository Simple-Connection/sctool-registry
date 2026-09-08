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
- deterministic update-candidate resolution from a product-authoritative installed-version observation.

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

## P3 boundary

Distribution `1.0.2` P3 established exact release/asset binding and authenticated GitHub CLI retrieval. P4 preserves that authority while using streaming transport.

## P4 boundary

P4 owns both verified file-backed artifact production and update-candidate **eligibility resolution**.

Simple Connection remains authoritative for local installation state. It may pass only this read-only observation into the Registry Client SDK:

```text
authority = AUTH_SIMPLE_CONNECTION_DESKTOP
packageId
targetKey
installedVersion
```

The SDK does not retain or mutate that product state. It compares `installedVersion` with the already-resolved Registry version using package-schema semantic-version precedence:

```text
resolved version newer
-> UPDATE_AVAILABLE
-> authenticated retrieval
-> SDK-internal staging
-> integrity verification
-> VerifiedUpdateCandidate

equal precedence
-> CURRENT
-> no release query
-> no artifact retrieval
-> candidate = null

resolved version older
-> DOWNGRADE_NOT_CANDIDATE
-> no release query
-> no artifact retrieval
-> candidate = null
```

Build metadata is ignored for precedence. Prerelease ordering follows semantic-version precedence; numeric prerelease identifiers are compared by integer value to remain compatible with the package schema accepted grammar.

The file-backed verification pipeline is:

```text
authenticated asset stream
-> SDK-internal OS temporary staging
-> single-pass byte count + SHA-256
-> filename/backend-size/downloaded-size/digest verification
-> VERIFIED staging resource
-> read-only VerifiedArtifactLease
-> VerifiedUpdateCandidate
```

The staging filename is SDK-internal and never derived from `content.filename`. Partial or failed staging resources are disposed. The public candidate exposes no raw path or write access.

A `VerifiedUpdateCandidate` deliberately does not contain:

```text
installedVersion
isUpdateAvailable
shouldInstall
installPath
persistentInstallState
activation
rollback
runtime state
renderer state
GitHub credentials/identity
```

Update availability is represented by the surrounding candidate-resolution state, not by a mutable boolean inside the candidate.

## P5 boundary

P5 is not materialized. Its planned responsibility is only `RESP_SIMPLE_CONNECTION_INSTALL`. It may consume a P4 verified update candidate and decide/create product-owned persistent installation state, but P4 does not make that installation decision.

## Non-goals

This SDK must not implement:

- SCTool scaffold/build/test/sign/package authoring;
- publisher submission production;
- Simple Connection local install-state ownership or mutation;
- install-path selection or install policy;
- active-version selection or rollback;
- renderer/UI behavior;
- production Root trust activation.

The package is currently marked `private` to prevent accidental publication before an explicit SDK distribution mechanism is approved.
