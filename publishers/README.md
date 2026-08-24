# Publisher descriptors

Registered publisher identities and Ed25519 verification keys belong in this directory.

Canonical path:

```text
publishers/{publisherId}.json
```

A registered publisher key may be:

- `active`: accepted for new submissions and historical verification
- `retired`: not accepted for new submissions; retained for historical verification
- `revoked`: compromised or invalidated; Registry policy decides rejection/remediation for affected artifacts

Publisher enrollment is a separate trusted operation.
A publisher does not receive direct write access to this registry repository.
