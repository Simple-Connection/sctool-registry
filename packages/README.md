# Packages namespace

This directory contains two intentionally distinct namespaces.

## Registry package descriptors

Accepted package descriptors are direct JSON children of `packages/`:

```text
packages/{packageId}.json
```

Package descriptors are Registry output, not publisher-controlled input. Publishers submit a signed `submission` plus the `.sctool` artifact to Registry Intake. The Registry independently validates the submission and then creates or updates the descriptor.

## Registry Client SDK

The reserved implementation namespace is:

```text
packages/registry-client-sdk/**
```

It contains the Registry-owned client SDK used by Simple Connection to consume Registry metadata/access/delivery contracts. It is **not** an SCTool package descriptor and it is **not** the SCTool Authoring SDK.

The Authoring SDK remains owned by `Kinirin/Simple-Connection/program-sdk/sctool-sdk` and supports developers/coding agents that create `.sctool` packages.

Do not commit `.sctool` binaries anywhere under `packages/`.
