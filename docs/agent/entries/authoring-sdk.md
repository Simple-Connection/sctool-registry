# Authoring SDK entry

Canonical sources:

```text
packages/sctool-sdk/
packages/repository-tool-sdk/
```

The SCTool Authoring SDK owns SCTool authoring validation, localization, host-capability authoring contracts, scaffold/build/test/package behavior, and its CLI.

It must not absorb Registry access, descriptor resolution, artifact retrieval, update-candidate production, or Simple Connection persistent runtime state.

The Repository Tool Authoring SDK owns Repository Tool descriptor/schema validation, canonical identity, runtime-capable classification, scaffold behavior, and its CLI.

It must not own Simple Connection repository binding, host projection, enablement, runtime registration, process lifecycle, or renderer behavior.

Both SDKs use immutable exact-version publication. Consumer repositories pin versions and do not become source/compatibility authorities.
