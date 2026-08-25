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
  stored as GitHub Actions Secret SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64
  used only by the manually dispatched trust-signing workflow
  signs trust/trust.json

Registry Root public key
  pinned by Simple Connection
  stored as GitHub Actions Variable SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64
  used to independently verify trust and Pages metadata

Distribution private key
  routine Pages head signer
  stored as GitHub Actions Secret SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64

Distribution public key
  authorized inside root-signed trust/trust.json
```

The routine Pages workflow must never reference `SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64`.
Root and Distribution private keys remain separate even though both are managed through GitHub Actions Secrets.

This separation limits accidental exposure from the routine publication path, but it is not equivalent to an offline root: an administrator or workflow change with sufficient access to repository Actions Secrets is inside the root trust domain.

## Bootstrap procedure

Generate the root and first distribution key outside the repository:

```powershell
node .\tools\generate-ed25519-keypair.mjs --out C:\secure\sctool-registry --name registry-root
node .\tools\generate-ed25519-keypair.mjs --out C:\secure\sctool-registry --name registry-distribution-2026-01
```

Configure GitHub repository Actions settings with the generated values:

```text
Actions secret:
  SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64
    = contents of registry-root-private.pk8.b64

Actions secret:
  SCTOOL_REGISTRY_DISTRIBUTION_PRIVATE_KEY_B64
    = contents of registry-distribution-2026-01-private.pk8.b64

Actions variable:
  SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64
    = contents of registry-root-public.raw.b64

Pages source:
  GitHub Actions
```

The Root private secret is consumed only by `.github/workflows/sign-trust.yml`.
The Distribution private secret is consumed by `.github/workflows/pages.yml`.

## Trust publication

Prepare an unsigned trust document according to `schemas/trust.schema.json`, containing only `schemaVersion` and `signed` and omitting `proof`.
The descriptor may authorize one or more Distribution public keys and their lifecycle states.

Encode the unsigned JSON for the manual workflow:

```powershell
$UnsignedB64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\secure\sctool-registry\trust-unsigned.json")
)
```

After P1 is merged to `main`, run the `Sign SCTool Registry trust` workflow on `main` with:

```text
unsigned_trust_b64 = $UnsignedB64
expected_sequence  = the signed.sequence value
```

The workflow:

```text
validates current PTSIP / Registry contracts
-> decodes the unsigned trust descriptor
-> signs it with SCTOOL_REGISTRY_ROOT_PRIVATE_KEY_B64
-> verifies the derived Root public key against SCTOOL_REGISTRY_ROOT_PUBLIC_KEY_B64
-> validates the signed trust schema
-> independently verifies the Root signature
-> commits only trust/trust.json to main
```

`tools/sign-trust.mjs` also supports `--root-private-key` as a local recovery/testing path, but production Root signing uses the Actions Secret.
