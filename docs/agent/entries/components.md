# Component and package boundary entry

Canonical package namespaces:

```text
packages/{packageId}.json
packages/registry-client-sdk/**
packages/sctool-sdk/**
packages/repository-tool-sdk/**
```

Registry Client SDK, SCTool Authoring SDK, and Repository Tool Authoring SDK are independent Product components.

Current lifecycle ownership is machine-authoritative in `ptsip.yaml`. Do not duplicate that complete map here.

Key boundary rule: consumer repositories remain consumers. Authoring source/build/test/compatibility authority must not be moved into `Simple-Connection/SC_Linked_App`.

Future components such as Registry Intake, artifact release publication beyond signed metadata handoff, or operational monitoring must be classified from actual lifecycle ownership rather than analogy with existing components.
