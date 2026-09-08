# @simple-connection/sctool-sdk

Canonical SCTool Authoring SDK for developers and coding agents.

## Authority

```text
repository: Simple-Connection/sctool-registry
source:     packages/sctool-sdk/
package:    @simple-connection/sctool-sdk
```

This package owns SCTool authoring, manifest validation, localization contracts, host-capability declarations, scaffold templates, build/package verification, and the authoring CLI.

It does **not** own Registry access, Registry descriptor/channel/version resolution, authenticated artifact retrieval, verified update-candidate production, or Simple Connection local installation/runtime state. Those responsibilities belong to the Registry Client SDK or the Simple Connection Product.

## Main surfaces

```text
src/index.ts
  SCTool Manifest v1 types and validators
  environment declaration/value validation

src/localization.ts
  localization manifest/bundle contract
  locale resolution and source fallback

src/host-capabilities.ts
  host capability types and validation

schemas/
  tool.schema.json
  sctool-build.schema.json
  sctool-projects.schema.json
  host-capabilities.schema.json

capabilities/
  simple-connection.host-capabilities.json

builder/sctool-builder.mjs
  build, stage, normalize, checksum, verify, package

cli/sctool.mjs
  list, build, test, scaffold

templates/
  repository-independent authoring templates
```

## Install

The package is published to GitHub Packages and consumers must pin an exact version.

```text
@simple-connection/sctool-sdk@0.1.0
```

Registry source checkout validation:

```powershell
npm --prefix packages/sctool-sdk ci
npm --prefix packages/sctool-sdk run typecheck
npm --prefix packages/sctool-sdk run build
npm --prefix packages/sctool-sdk run test:localization
npm --prefix packages/sctool-sdk run test:host-capabilities
node --check packages/sctool-sdk/cli/sctool.mjs
```

## CLI

After package installation:

```text
sctool list [--registry <projects.json>]
sctool build (--tool <name> [--registry <projects.json>] | --project <sctool.build.json>) --version <semver>
sctool test (--tool <name> [--registry <projects.json>] | --package <file.sctool>) [--project <sctool.build.json>] [--expected-version <semver>]
sctool scaffold --template <name> --destination <path> --package-id <id> --display-name <name> --command-name <name> [--module-path <path>]
```

The CLI's project-registry option is an authoring-workspace project list; it is not the network Registry Client SDK boundary.

## Package exports

- `@simple-connection/sctool-sdk`
- `@simple-connection/sctool-sdk/localization`
- `@simple-connection/sctool-sdk/host-capabilities`
- `@simple-connection/sctool-sdk/schema`
- `@simple-connection/sctool-sdk/build-schema`
- `@simple-connection/sctool-sdk/registry-schema`
- `@simple-connection/sctool-sdk/host-capabilities-schema`
- `@simple-connection/sctool-sdk/host-capabilities-manifest`
- `@simple-connection/sctool-sdk/builder`
- `@simple-connection/sctool-sdk/cli`

There is intentionally no `registry-access` export. Runtime Registry access is owned by `@simple-connection/sctool-registry-client-sdk`.

## Publication

Publication is governed by:

```text
docs/AUTHORING_SDK_DISTRIBUTION_V1.yaml
.github/workflows/publish-authoring-sdks.yml
```

Versions are immutable. Existing versions are reused only when remote npm integrity exactly matches the package built from the canonical source revision.
