# AGENTS.md

## Purpose

This file is the minimal coding-agent entry point for `Simple-Connection/sctool-registry`.
Do not preload repository policy, historical version documents, or implementation details from this file.

## Required entry order

Start with:

```text
docs/index.yaml
ptsip.yaml
```

Then read only the routes required by the task.

```text
development/version/session work
-> docs/index.yaml

policy work
-> docs/policy/index.yaml

responsibility/authority work
-> docs/responsibility/index.yaml

governance rules/templates
-> docs/rules/index.yaml
-> docs/template/index.yaml

active contract work
-> follow the contract path referenced by the relevant active index/responsibility entry
```

Do not scan `docs/ver*/**` during normal entry.
Version folders are historical/version-scoped records and are entered only when `docs/index.yaml` routes to them or the task explicitly requires history.

## Repository state rules

`docs/index.yaml` is the authority for active development routing.

If:

```yaml
current:
  state: IDLE
  distribution_contract_version: null
```

there is no active version-development session.

Do not infer or create a version, session, or `dev/**` branch from package versions, issue text, historical documents, or repository contents.

Creating a branch requires explicit user approval.
Do not create a version branch, hotfix branch, or operational branch without that approval.

## PTSIP

The maintained development Tool is:

```text
PTSIP Tool: 0.3.8a1
Project Profile: pp.1.01
Profile: ptsip.yaml
```

Use the profile as machine authority. Do not restate its component ownership model here.

Minimum validation after repository/governance changes:

```text
python docs/governance/validate.py --root .
ptsip validate .
```

Run additional PTSIP inspection/conformance commands only when required by the task or release gate.

## Read-on-demand rule

Do not read all contracts, policies, responsibility records, templates, version plans, session documents, or history up front.

Resolve the smallest authoritative route from the indexes above, read only that material, perform the task, and expand the read set only when a referenced dependency requires it.

## Hard boundaries

- Never commit private keys, GitHub tokens, credential-store contents, or secret values.
- Do not treat historical documents as active authority unless an active index explicitly routes to them.
- Do not bypass governance/PTSIP validation by changing machine state to make a failing gate disappear.
- Do not modify another repository merely because it consumes Registry output; cross-repository mutation requires separate authority.
- `.sctool` binaries are not Registry Git content.

## Validation entry point

The public repository-governance command is:

```text
python docs/governance/validate.py --root .
```

Domain validation remains behind this command. Do not invent parallel governance entry points when the existing validator can own the check.
