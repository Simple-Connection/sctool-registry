# Registry trust bootstrap

This directory contains public trust material only.

Never commit:

```text
root private key
distribution private key
GitHub Actions secret values
```

## Key roles

```text
Registry Root private key
  offline only
  signs trust/trust.json

Registry Root public key
  pinned by Simple Connection
  supplied to the Pages verification/build environment as public configuration

Distribution private key
  routine Pages head signer
  stored as GitHub Actions secret SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64

Distribution public key
  authorized inside root-signed trust/trust.json
```

## Bootstrap procedure

Generate the root and first distribution key outside the repository:

```powershell
node .\tools\generate-ed25519-keypair.mjs --out C:\secure\sctool-registry --name registry-root
node .\tools\generate-ed25519-keypair.mjs --out C:\secure\sctool-registry --name registry-distribution-2026-01
```

Create an unsigned trust document according to `schemas/trust.schema.json`, omitting `proof`, then sign it with the offline root key:

```powershell
node .\tools\sign-trust.mjs `
  --input C:\secure\sctool-registry\trust-unsigned.json `
  --root-private-key C:\secure\sctool-registry\registry-root-private.pk8.b64 `
  --out .\trust\trust.json
```

Before activation, configure GitHub repository settings:

```text
Actions variable:
  SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64

Actions secret:
  SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64

Pages source:
  GitHub Actions
```

The root private key remains offline after signing.
