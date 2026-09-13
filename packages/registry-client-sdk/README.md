# SCTool Registry Client SDK

Package: `@simple-connection/sctool-registry-client-sdk`

This SDK is owned by `Simple-Connection/sctool-registry` and exists for **Simple Connection Registry consumption**.

It is intentionally separate from `Kinirin/Simple-Connection/program-sdk/sctool-sdk`, which is the SCTool **Authoring SDK** used by developers and coding agents to design, validate, build, test, and package their own tools as `.sctool` artifacts.

## Responsibilities

The Registry Client SDK owns the consumer-side implementation of Registry contracts, including:

- Registry metadata and package descriptor consumption;
- optional GitHub user-identity behavior, separate from public artifact transport;
- package/channel/version/target resolution;
- delivery discriminator and exact backend locator handling;
- public GitHub Release streaming retrieval without private repository read grants;
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

`package-descriptor` validates the current package descriptor contract (`schemaVersion = 3.0.0`) and the Registry policy consistency needed by a consumer. Validation is fail-closed and returns an immutable validated descriptor or structured issues.

`resolution` deterministically resolves:

```text
defaultChannel or explicit channel
-> concrete version
-> exact platform-arch target
-> current-default classification
-> exact origin + optional cache delivery plan
```

No version or target fallback is performed.

Current artifact access contract:

```text
registry-public-integrity-v1
```

The public cache is transport only. Publisher origin is always retained. Current default-channel artifacts may prefer the bounded cache and fall back to the exact origin; historical and alternate-channel artifacts use origin only. Filename, byte size, SHA-256, publisher evidence, and signed Registry state remain the trust boundary.

## P2 boundary

Distribution `1.0.2` P2 owns descriptor/channel/version/target resolution only.

## P3 boundary

Distribution `1.0.2` P3 established exact release/asset binding. Distribution `1.0.3a1` migrates retrieval from private GitHub CLI authorization to public HTTP transport while preserving exact release/asset binding and fail-closed integrity verification.

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
-> current: exact cache retrieval when present
-> cache failure: exact publisher-origin fallback
-> historical/alternate: exact publisher-origin retrieval
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
exact cache or publisher-origin stream
-> SDK-internal OS temporary staging
-> single-pass byte count + SHA-256
-> filename/backend-size/downloaded-size/digest verification
-> VERIFIED staging resource
-> read-only VerifiedArtifactLease
-> VerifiedUpdateCandidate
```

The staging filename is SDK-internal and never derived from `content.filename`. Partial or failed staging resources are disposed. If every allowed exact location fails retrieval or integrity verification, delivery fails closed as `ARTIFACT_UNAVAILABLE`. The public candidate exposes no raw path or write access.

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

The package is not marked npm-private. Publication remains governed by the Registry Client SDK distribution workflow and restricted GitHub Packages configuration.
