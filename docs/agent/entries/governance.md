# Repository governance entry

Use this entry for governance rules, templates, machine state, validator behavior, and agent routing.

Canonical machine authorities remain siblings under `docs/`:

```text
docs/index.yaml
docs/rules/**
docs/template/**
docs/responsibility/**
docs/agent/**
docs/ver*/**
```

Validator implementation is isolated under:

```text
docs/governance/validate.py
docs/governance/validation/**
```

Do not move machine state, rules, templates, responsibility semantics, agent entry state, or version/session records into the validator namespace.

The public governance validator is:

```text
python docs/governance/validate.py --root .
```

Domain checks stay behind that command.

Session state is derived from machine rules. Do not independently assert audit/apply/test/closeout state to bypass a failing gate.

Machine-only documents must not gain free-form planning prose. Authority-relevant semantics belong in the registered responsibility description/rationale layer.

Agent entry is also machine-governed: `docs/agent/index.yaml` selects the minimum read-set; unindexed agent entry documents or invalid routes must fail governance validation.
