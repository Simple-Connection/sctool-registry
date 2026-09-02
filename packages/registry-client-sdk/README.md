# SCTool Registry Client SDK

Package: `@simple-connection/sctool-registry-client-sdk`

This SDK is owned by `Simple-Connection/sctool-registry` and exists for **Simple Connection Registry consumption**.

It is intentionally separate from `Kinirin/Simple-Connection/program-sdk/sctool-sdk`, which is the SCTool **Authoring SDK** used by developers and coding agents to design, validate, build, test, and package their own tools as `.sctool` artifacts.

## Responsibilities

The Registry Client SDK owns the consumer-side implementation of Registry contracts, including:

- Registry metadata and package descriptor consumption;
- `registry-access-v1` identity/authorization behavior;
- package/channel/version/target resolution;
- delivery discriminator and exact backend locator resolution;
- authenticated artifact retrieval;
- filename/size/SHA-256 verification;
- normalized verified update candidates for Simple Connection.

## Non-goals

This SDK must not implement:

- SCTool scaffold/build/test/sign/package authoring;
- publisher submission production;
- Simple Connection local install state;
- active-version selection or rollback;
- renderer/UI behavior;
- production Root trust activation.

## Current state

Distribution `1.0.2` begins with the package boundary and canonical Registry contract identity. Registry access behavior is migrated into this package in the next work unit before the old misplaced access surface is removed from the Simple Connection Authoring SDK.

The package is currently marked `private` to prevent accidental publication before an explicit SDK distribution mechanism is approved.
