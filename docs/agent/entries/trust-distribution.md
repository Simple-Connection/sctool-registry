# Trust and signed-distribution entry

Private key values are never repository content.

Canonical Actions secret names:

```text
SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64
SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64
```

Root private signing is restricted to the manually dispatched trust-signing path.
Routine signed distribution production may use the Distribution private key but must not consume the Root private key.

The Root public key is non-secret bootstrap configuration and is pinned independently by consumers.

Never place private key material in signed public output, logs, workflow artifacts, fixtures, committed configuration, or documentation examples.

GitHub end-user credentials are also not Registry content. Registry access consumers must not expose token values or credential-store material through Registry metadata/SDK results.

Signed distribution generation, verification, and exact Marketplace handoff remain separate from consumer installation/runtime policy.
