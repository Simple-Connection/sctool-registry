# Packages namespace

This directory contains three intentionally distinct namespaces.

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

## SCTool Authoring SDK

The canonical source authority is:

```text
packages/sctool-sdk/**
```

This SDK supports developers and coding agents that author, validate, build, test, version, and prepare `.sctool` packages for Registry publication. It remains a separate SDK product from `packages/registry-client-sdk/**` even though both are owned by this repository.

`Simple-Connection/SC_Linked_App/program-sdk/sctool-sdk/**` is a transitional predecessor source until physical migration and consumer rebinding are completed. SC_Linked_App may expose the canonical SDK locator and consume the published package, but it does not own Authoring SDK source, version, compatibility, or publication policy.

Do not commit `.sctool` binaries anywhere under `packages/`.
