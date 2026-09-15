# AGENTS.md

## Machine entry

Read only this file and `docs/agent/index.yaml` at initial entry.
Do not preload contracts, policies, responsibility records, version folders, or package documentation.

Resolve the current task to one or more `TASK_CLASS` values, then obtain the exact read-set:

```text
python docs/governance/agent-entry.py --task-class <TASK_CLASS>
```

When the changed path is already known:

```text
python docs/governance/agent-entry.py --path <REPOSITORY_PATH>
```

Read only the returned `read_set`.
If a task spans multiple classes, pass multiple `--task-class` values and use the returned union.
Expand beyond that set only when a selected authority document explicitly references another required authority or the task scope changes.

## Entry rules

- `docs/agent/index.yaml` is the canonical agent table of contents.
- `docs/index.yaml` is read only when the selected task class routes to repository/version state.
- `docs/ver*/**` is not a default entry surface. Historical/version-scoped records require an explicit routed task.
- Do not infer an active version, session, branch, or authority from filenames or historical records.
- Branch creation requires explicit user approval.
- Cross-repository mutation requires separate authority.
- Never commit secrets, private keys, access tokens, or credential-store contents.

## Validation

Repository governance changes must preserve:

```text
python docs/governance/validate.py --root .
ptsip validate .
```

Detailed rules are intentionally outside this bootstrap file and are reachable only through the machine entry index.
