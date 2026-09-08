# Repository Tool SDK

> **Canonical authority:** this package is owned, versioned, tested, and published from `Simple-Connection/sctool-registry/packages/repository-tool-sdk`.

`@simple-connection/repository-tool-sdk`는 Simple Connection canonical workspace의 generic Repository Tool package를 기술하고 검증하기 위한 독립 Program SDK다.

이 SDK가 소유하는 범위:

- `workspace.json`의 `kind: "tool"` Repository Tool Package Descriptor V1
- descriptor schema/semantic validation
- canonical identity `tool:<id>@<version>`
- runtime-capable 여부(`mcp` 존재 여부)
- deterministic package scaffold builder
- create / validate CLI

이 SDK가 소유하지 않는 범위:

- SCTool manifest, selectedVersion, environment/localization 계약
- GitHub account/repository binding
- `{{repo_root}}` host projection
- Desktop enable/disable state
- managed repository descriptor persistence
- process lifecycle, rescan, stop

SCTool Authoring SDK의 정본 소유자는 `Simple-Connection/sctool-registry/packages/sctool-sdk/**`이며 Repository Tool SDK는 SCTool SDK에 의존하지 않는다. SC_Linked_App는 published Authoring SDK packages의 consumer이며 Authoring SDK source authority를 소유하지 않는다.

## Descriptor V1

최소 metadata-only Tool:

```json
{
  "schemaVersion": 1,
  "kind": "tool",
  "id": "demo-tool",
  "name": "Demo Tool",
  "version": "1.0.0",
  "contentRoot": "content"
}
```

이 descriptor는 유효하지만 `mcp`가 없으므로 runtime-capable이 아니다.

Runtime-capable Tool 예:

```json
{
  "schemaVersion": 1,
  "kind": "tool",
  "id": "demo-tool",
  "name": "Demo Tool",
  "version": "1.0.0",
  "contentRoot": "content",
  "mcp": {
    "profileId": "workspace/demo-tool",
    "title": "Demo Tool",
    "entrypoint": {
      "command": "node",
      "path": "{{package_root}}/content/server.mjs",
      "args": ["{{package_root}}/content/server.mjs"],
      "cwd": "{{package_root}}"
    },
    "env": {},
    "toolGroups": {
      "default": ["demo.echo"]
    },
    "tools": ["demo.echo"],
    "docs": ["content/README.md"]
  }
}
```

Public package placeholder는 `{{package_root}}`만 허용한다. `{{repo_root}}` 같은 host placeholder는 package descriptor에 기록하지 않는다.

## CLI

설치된 package의 bin을 사용할 때:

```text
repository-tool validate <workspace.json>
repository-tool create <directory> --id <id> --name <name> --version <version>
```

Repository checkout에서 checked-in runtime을 직접 사용할 때:

```powershell
node packages/repository-tool-sdk/cli/repository-tool.mjs validate `
  packages/repository-tool-sdk/fixtures/runtime.workspace.json
```

Create 예:

```powershell
node packages/repository-tool-sdk/cli/repository-tool.mjs create `
  .\tmp\demo-tool `
  --id demo-tool `
  --name "Demo Tool" `
  --version 1.0.0
```

`create`는 metadata-only `workspace.json`과 `content/` 디렉터리를 만든다. 기존의 비어 있지 않은 target directory에는 쓰지 않는다.

생성 직후에는 runtime-capable=false다. MCP runtime을 제공하려면 descriptor에 `mcp`를 추가하고 다시 `validate`한다.

## Validate output

유효한 descriptor:

```json
{
  "valid": true,
  "identity": "tool:demo-tool@1.0.0",
  "runtimeCapable": true,
  "issues": []
}
```

유효하지 않은 descriptor는 process exit code `1`과 structured `issues`를 반환한다. CLI 사용 자체가 잘못됐거나 JSON/file 처리 예외가 발생하면 exit code `2`다.

## Public API

```ts
import {
  defineRepositoryTool,
  validateRepositoryToolDescriptorV1,
  assertValidRepositoryToolDescriptorV1,
  normalizeRepositoryToolDescriptorV1,
  repositoryToolIdentity,
  isRepositoryToolRuntimeCapable,
  assertRepositoryToolIdentityMatch,
} from "@simple-connection/repository-tool-sdk";
```

주요 책임:

- `validateRepositoryToolDescriptorV1(value)` — structured validation result
- `assertValidRepositoryToolDescriptorV1(value)` — invalid descriptor에서 exception
- `normalizeRepositoryToolDescriptorV1(value)` — canonical normalized descriptor
- `repositoryToolIdentity(descriptor)` — `tool:<id>@<version>`
- `isRepositoryToolRuntimeCapable(descriptor)` — `mcp` 존재 여부
- `assertRepositoryToolIdentityMatch(recovered, descriptor)` — discovery identity와 manifest identity 일치 검증

## Fixtures

SDK에는 contract 설명과 regression test가 같은 입력을 공유하도록 fixture를 둔다.

```text
fixtures/metadata-only.workspace.json
fixtures/runtime.workspace.json
fixtures/invalid-secret-env.workspace.json
```

- `metadata-only.workspace.json`: valid, runtime-capable=false
- `runtime.workspace.json`: valid, runtime-capable=true
- `invalid-secret-env.workspace.json`: secret-like environment key rejection fixture

## Desktop registration boundary

Simple Connection Desktop은 canonical workspace에서 recovered Tool을 읽은 뒤 이 SDK로 manifest를 검증하고 identity/runtime capability를 판정한다.

```text
recovered canonical Tool
→ workspace.json read
→ Repository Tool SDK validation
→ recovered identity match
→ runtime-capable decision
→ Desktop host projection
→ repo-local runtime descriptor / registration
```

Desktop이 이후에 추가하는 account/repository path, `{{repo_root}}`, host environment, enable state와 process lifecycle은 SDK descriptor에 역으로 저장하지 않는다.

## Verification

SDK contract suite:

```powershell
node packages/repository-tool-sdk/tests/run-contract-suite.mjs
```

P6 purpose-first repository verification에서는 이 suite가 VPMS PRODUCT Case `simple-connection.product.repository-tool.sdk-contract`의 runner로 사용된다.
