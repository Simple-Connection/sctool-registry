# AGENTS.md

## Machine entry

Do not preload repository documentation or read `docs/agent/index.yaml` directly.

Use the resolver:

```text
python tools/policy_automatic_engine/governance/agent-entry.py --path <REPOSITORY_PATH>
python tools/policy_automatic_engine/governance/agent-entry.py --task-class <TASK_CLASS>
```

If classification is unclear:

```text
python tools/policy_automatic_engine/governance/agent-entry.py --catalog
```

The resolver parses the machine table of contents and returns selected machine directives plus the minimal `read_set`.
Executable automation is returned as `commands.<COMMAND_ID>.argv[]`, not prose shell strings.

Read only `read_set`. Expand it only when a selected authority explicitly requires another authority or the task scope changes.

## Hard boundaries

- `docs/ver*/**` is not a default entry surface.
- Do not infer active version/session/branch from filenames or history.
- Branch creation requires explicit user approval.
- Cross-repository mutation requires separate authority.
- Never commit secrets, private keys, access tokens, or credential-store contents.

## Governance gate

```text
python tools/policy_automatic_engine/governance/validate.py --root .
python tools/policy_automatic_engine/governance/tests/test-agent-entry.py
ptsip validate .
```
