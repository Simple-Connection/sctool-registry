# Registry Client SDK entry

Canonical source:

```text
packages/registry-client-sdk/
```

The SDK owns consumer-side implementation of active Registry contracts: Registry access semantics, descriptor/channel/version/target resolution, exact delivery resolution, Registry-owned artifact retrieval/staging/integrity, and verified candidate/lease production as authorized by active contracts.

It must not own Simple Connection persistent installation state, active-version selection, activation, rollback, renderer UI, runtime reconciliation policy, or publisher-side SCTool authoring.

Use the narrow task class whenever possible:

```text
REGISTRY_CLIENT_SDK_ACCESS
REGISTRY_CLIENT_SDK_DELIVERY
REGISTRY_CLIENT_SDK_UPDATE
REGISTRY_CLIENT_SDK_PUBLICATION
```

Do not preload all SDK contracts when only one boundary is being changed.

Registry Client SDK publication is a separate immutable Delivery boundary governed by the routed distribution contract/workflow.
