# Package descriptors

Only accepted package descriptors belong in this directory.

Canonical path:

```text
packages/{packageId}.json
```

Package descriptors are registry output, not publisher-controlled input.
Publishers submit a signed `submission` plus the `.sctool` artifact to Registry Intake.
The registry independently validates the submission and then creates or updates the descriptor.

Do not commit `.sctool` binaries here.
