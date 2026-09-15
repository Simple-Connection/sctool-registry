# Responsibility and authority entry

Canonical routing starts at `docs/responsibility/index.yaml`.

Authority responsibility is represented by closed machine dimensions. Do not replace missing semantics with opaque ad-hoc constants.

If a stable, reusable, orthogonal semantic is missing, it may become a candidate dimension/value. Otherwise preserve it through a registered `responsibility_description_id`.

`docs/responsibility/descriptions.yaml` preserves authority-relevant semantics not represented by closed dimensions.
`docs/responsibility/rationale.yaml` preserves why boundaries were chosen and when they must be reviewed.

`interpretation.semantic_coverage: COMPLETE` requires no description reference.
`PARTIAL` requires a registered description.

Responsibilities requiring rationale must reference active rationale entries whose scope includes that responsibility. Superseded rationale is historical and must not be used as active authority.

When a change matches a rationale `review_on` trigger, re-evaluate that rationale before changing responsibility dimensions.
