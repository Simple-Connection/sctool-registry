# Registry → Marketplace Consumer-Owned Handoff Reconciliation Policy v1

Status: **POLICY DECIDED — IMPLEMENTATION NOT YET AUTHORIZED**

This document defines the policy for automatically advancing the Registry signed distribution accepted by `Simple-Connection/SCTool_Marketplace_Web`.

It is a decision document. It does **not** authorize implementation by itself. Workflow, script, token, permission, or Marketplace source changes require a separate implementation approval.

The existing machine contract remains authoritative for the signed distribution format and exact handoff identity:

`docs/REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1.yaml`

This policy defines how the Marketplace may discover, verify, accept, persist, and publish a newer valid handoff without transferring Registry authority into the Marketplace or Marketplace mutation authority into the Registry.

## 1. Decision

The handoff update model is **consumer-owned reconciliation**.

`Simple-Connection/sctool-registry` is the producer authority.

`Simple-Connection/SCTool_Marketplace_Web` is the consumer acceptance and public-hosting authority.

The Registry produces immutable signed distribution and handoff artifacts. The Marketplace independently discovers candidate producer runs, verifies the exact artifacts and evidence, decides whether the candidate is eligible to advance its accepted state, and mutates its own accepted lock and persisted handoff copies.

The Registry must not directly mutate Marketplace source, lock state, deployment state, or Git history.

## 2. Authority boundaries

### Registry owns

- canonical Registry source metadata;
- Root trust and Distribution signing authority;
- signed `trust.json`, `registry-head.json`, and immutable snapshot generation;
- exact signed distribution artifact production;
- exact handoff evidence production;
- producer-side schema, signature, integrity, and exact-file-set validation;
- immutable producer coordinates for each successful handoff.

### Marketplace owns

- producer candidate discovery;
- candidate selection;
- consumer-side handoff verification;
- accepted lock mutation;
- persistence of the exact accepted distribution and handoff evidence ZIPs;
- public `/registry/` materialization;
- Marketplace Pages deployment;
- public exact-byte verification;
- its own reconciliation credentials and permissions.

### Forbidden authority transfer

The following are forbidden:

- a Registry credential with write access to the Marketplace repository;
- Registry-side mutation of the Marketplace accepted lock;
- Registry-side commits or pull requests whose purpose is to force acceptance;
- Marketplace signing or re-signing of Registry metadata;
- Marketplace regeneration of canonical Registry snapshots;
- Marketplace transformation of signed Registry bytes;
- acceptance based only on artifact name, mutable "latest" aliases, workflow timestamps, or notification payloads.

An optional producer notification may later be used only as a latency hint. It can never be acceptance authority and can never replace Marketplace discovery and verification.

## 3. Accepted-state identity

The Marketplace accepted state is identified by the exact tuple already represented by the handoff contract and lock:

- producer repository;
- producer workflow;
- producer run ID;
- producer run attempt;
- source ref;
- source revision;
- distribution artifact name;
- distribution artifact ID;
- distribution artifact digest;
- evidence artifact name;
- evidence artifact ID;
- evidence artifact digest;
- Registry trust sequence;
- Registry sequence.

The accepted lock is not a pointer to "latest". It is an immutable-coordinate record of one explicitly accepted producer output.

## 4. Candidate discovery

Reconciliation is initiated by the Marketplace.

The Marketplace queries the Registry producer history and considers only producer runs satisfying all of the following:

1. repository is exactly `Simple-Connection/sctool-registry`;
2. workflow is exactly `.github/workflows/pages.yml`;
3. source ref is exactly `refs/heads/main`;
4. workflow conclusion is `success`;
5. the exact signed distribution artifact exists;
6. the exact handoff evidence artifact exists;
7. both artifacts are retrievable by exact run/artifact identity;
8. the evidence binds the distribution to the same producer run, run attempt, source revision, and artifact identity.

A candidate is not accepted merely because it is the newest GitHub Actions run.

## 5. Candidate ordering and freshness

Freshness is determined from **verified signed Registry state**, not GitHub timestamps.

After the candidate artifacts pass cryptographic and structural verification:

- higher `trustSequence` is newer trust state;
- for the same `trustSequence`, higher Registry `sequence` is newer Registry state;
- equal trust sequence and equal Registry sequence require the same Registry revision;
- equal sequence with a different revision is a conflict and must fail closed;
- lower trust sequence or lower Registry sequence is stale and must never be automatically accepted.

When multiple valid producer runs represent the same verified Registry revision and sequence, the Marketplace may select one exact successful run identity, but the selected run and artifact coordinates must remain fully pinned in the lock.

Run ID, run attempt, artifact ID, creation time, and upload time are identity/evidence fields, not the primary freshness ordering.

## 6. Consumer verification gate

Before accepted state can advance, the Marketplace must independently verify at least the gates already required by `REGISTRY_SIGNED_DISTRIBUTION_HANDOFF_V1`, including:

- producer run success;
- exact producer run ID and attempt binding;
- exact source revision binding;
- exact artifact ID and digest;
- exact evidence artifact ID and digest;
- evidence schema validity;
- exact file set;
- safe ZIP paths and no symlinks;
- file SHA-256 and byte size;
- Root signature verification;
- Distribution signature verification;
- head/trust sequence binding;
- snapshot path, digest, size, revision, source repository, and source commit;
- byte preservation.

A candidate that fails any required check is rejected in full. Partial acceptance is forbidden.

## 7. Reconciliation state machine

The conceptual states are:

### CURRENT

No verified candidate is newer than the accepted lock.

Action: no mutation.

### STALE

A verified candidate newer than the accepted lock exists.

Action: proceed to candidate acceptance.

### ADVANCING

The Marketplace has verified a newer candidate and is preparing one atomic accepted-state update.

Action: persist the exact candidate distribution ZIP, exact handoff evidence ZIP, and matching lock together.

### ACCEPTED

The Marketplace repository records one internally consistent exact handoff set.

Action: normal Marketplace deployment may publish that state.

### PUBLISHED

The Marketplace deployment completed and public `/registry/` bytes were independently verified to equal the accepted signed distribution exactly.

### BLOCKED

Discovery, download, verification, persistence, deployment, or public exact-byte verification failed.

Action: do not synthesize an alternate candidate, do not weaken verification, and do not automatically roll back.

## 8. Atomic accepted-state update

Advancing the Marketplace accepted state must be atomic from the repository's perspective.

The update set consists of:

- `deployment/registry-handoff/lock.json`;
- the exact signed Registry distribution ZIP referenced by the new lock;
- the exact handoff evidence ZIP referenced by the new lock.

The lock must never point to missing, mismatched, partially updated, or differently digested files.

The live handoff directory may retain only the currently accepted artifact pair. Historical accepted states remain recoverable from Git history and deployment evidence; unbounded accumulation of old ZIPs in the live directory is not required.

A failed pre-commit verification must leave the existing accepted state unchanged.

## 9. Failure and availability policy

Reconciliation is **fail closed for advancement** and **fail stable for availability**.

If a newer candidate cannot be discovered, downloaded, verified, or persisted:

- the existing accepted lock remains unchanged;
- the currently deployed previously accepted distribution remains valid;
- public hosting is not intentionally removed;
- the failed candidate is not partially published;
- reconciliation reports failure visibly.

Therefore, handoff staleness is an update-latency condition, not by itself a reason to make the Marketplace unavailable.

This policy does not permit silently ignoring persistent reconciliation failure. Operational alerting may be added during implementation, but it must not mutate acceptance rules.

## 10. Rollback policy

Automatic rollback to a lower trust sequence, lower Registry sequence, or different revision at the same sequence is forbidden.

A previously served lower Registry sequence can be rejected by clients that have already stored newer anti-rollback state. For that reason, rollback is not a normal Marketplace recovery mechanism.

Recovery from a bad newly accepted Registry state must prefer a forward Registry correction that produces a new valid signed handoff with monotonically newer state.

Any exceptional rollback mechanism requires a separate explicit policy decision and must not be introduced as part of the reconciliation implementation.

## 11. Concurrency and idempotence

Only one Marketplace handoff reconciliation may mutate accepted state at a time.

Reconciliation must be idempotent:

- reconciling the already accepted exact handoff is a no-op;
- retrying the same verified candidate must converge to the same accepted state;
- concurrent attempts must not create mixed lock/artifact sets;
- a candidate must be rechecked against the current accepted lock immediately before mutation so an older workflow execution cannot overwrite a newer accepted state.

## 12. Trigger policy

The authoritative model is Marketplace pull/reconcile.

Required trigger capabilities for a future implementation are:

- periodic reconciliation;
- manual reconciliation through `workflow_dispatch`.

The default periodic target should be hourly. The exact schedule is an operational parameter and may be changed without changing this policy, but routine reconciliation should not be intentionally configured with a freshness window greater than 24 hours without an explicit operational reason.

A future Registry-originated notification may be added only as an optimization to reduce latency. The Marketplace must still resolve and verify producer state independently.

## 13. Credential and permission policy

The reconciliation implementation must apply least privilege.

The Marketplace may possess a credential capable of reading the Registry workflow run metadata and exact Actions artifacts required for reconciliation.

That credential must not grant the Registry write authority over the Marketplace.

Marketplace mutation credentials must be scoped to the Marketplace repository and only to the permissions required to persist its own accepted state and run its own deployment.

Registry signing secrets are forbidden in the Marketplace.

Marketplace deployment credentials are forbidden in the Registry producer.

Credentials, tokens, signing keys, and GitHub CLI credential material must never be persisted in the accepted lock, handoff ZIPs, generated public Registry bytes, logs, or committed evidence.

## 14. Deployment boundary

Acceptance and public hosting are related but distinct states.

A successful accepted-state update may trigger the normal Marketplace deployment path. The deployment must materialize the exact accepted signed Registry bytes without transformation.

Deployment completion is not sufficient by itself. The Marketplace must verify the public `/registry/` endpoint against the exact accepted files and produce deployment evidence.

If deployment or public verification fails after the accepted state was committed, the accepted state remains the desired source state and the failure is a hosting convergence failure. The system must retry or repair forward; it must not automatically rewrite the lock to an older distribution.

## 15. Relationship to current lock staleness

A Marketplace lock that references an older still-valid signed distribution is **STALE**, not corrupt, when a newer verified producer state exists.

Staleness becomes a functional freshness problem once Registry data changes that consumers are expected to observe.

This reconciliation policy exists so that Registry source advancement and Marketplace public hosting converge automatically without weakening exact-byte verification or authority separation.

## 16. Implementation constraints

A future implementation must reuse or extend the existing Marketplace verification boundary rather than bypassing it.

Implementation must not change these decisions without revising this policy:

- consumer-owned acceptance;
- Registry has no Marketplace write authority;
- exact immutable producer coordinates;
- sequence-based freshness;
- atomic lock plus artifact update;
- fail-closed advancement;
- fail-stable current hosting;
- no automatic rollback;
- independent public exact-byte verification.

Implementation details that may be selected later include script names, workflow names, credential mechanism, exact schedule, retry count, and alerting surface, provided they preserve the policy above.

## 17. Implementation approval gate

This document intentionally stops before code implementation.

Before implementation begins, a separate approval must authorize changes in `Simple-Connection/SCTool_Marketplace_Web`.

That implementation approval should identify at minimum:

1. the Marketplace workflow responsible for reconciliation;
2. the Marketplace script or tool responsible for producer discovery and atomic lock generation;
3. credential source and exact permissions;
4. concurrency control;
5. periodic and manual triggers;
6. atomic file-update behavior;
7. validation and deployment evidence;
8. failure reporting;
9. tests for stale, current, conflicting, invalid-signature, invalid-digest, missing-artifact, concurrent-update, and retry cases.

Until that approval is given, the current Marketplace lock and deployment behavior remain unchanged.
