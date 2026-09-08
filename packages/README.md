# Packages namespace

This directory contains four intentionally distinct namespaces.

## Registry package descriptors

Accepted Registry package descriptors are direct JSON children:

```text
packages/{packageId}.json
```

These descriptors are Registry output and are not SDK source directories.

## Registry Client SDK

```text
packages/registry-client-sdk/**
@simple-connection/sctool-registry-client-sdk
```

Owns Simple Connection runtime consumption of Registry metadata, access, delivery, integrity, and verified update-candidate contracts. It does not own publisher-side tool authoring.

## SCTool Authoring SDK

```text
packages/sctool-sdk/**
@simple-connection/sctool-sdk
```

Owns SCTool manifest validation, localization, host-capability authoring contracts, scaffold templates, build/package verification, and the authoring CLI. Registry access and update-candidate resolution are intentionally excluded and belong to the Registry Client SDK.

## Repository Tool Authoring SDK

```text
packages/repository-tool-sdk/**
@simple-connection/repository-tool-sdk
```

Owns the generic Repository Tool descriptor, semantic validation, canonical identity, runtime-capable classification, scaffold builder, and create/validate CLI. Simple Connection consumes this contract but owns host projection, repository binding, enablement, runtime registration, process lifecycle, and UI.

## Publication

Both Authoring SDKs are published from this repository by:

```text
.github/workflows/publish-authoring-sdks.yml
docs/AUTHORING_SDK_DISTRIBUTION_V1.yaml
```

Published versions are immutable. Consumers pin exact versions. Package consumption does not transfer source, compatibility, version, or publication authority.

Do not commit `.sctool` binaries under `packages/`.
