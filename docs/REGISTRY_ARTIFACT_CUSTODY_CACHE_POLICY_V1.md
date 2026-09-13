# SCTool Artifact Custody and Current-Version Cache Policy v1

Status: **POLICY DECIDED — IMPLEMENTATION NOT YET AUTHORIZED**

This document fixes the long-term custody, cache, publication-intent, and historical-artifact availability policy for publisher-produced `.sctool` payloads.

It is a policy decision, not an implementation authorization. Existing runtime contracts, schemas, Registry Client SDK behavior, Registry Intake behavior, and artifact backends remain unchanged until a separately approved migration implements this policy.

The existing repository coordinate `Simple-Connection/sctool-artifacts` is retained as the canonical Simple-Connection central-cache repository identity. The repository may be recreated under the same name when implementation begins.

The current contracts that use that repository as permanent custody for all accepted payloads are **migration inputs**. The repository identity is preserved, but its long-term role changes from unbounded all-version custody to bounded current-version cache:

- `docs/REGISTRY_CONTRACT_V2.md`
- `docs/ARTIFACT_DELIVERY_V1.md`
- `docs/REGISTRY_ACCESS_V1.md`
- `policy/registry-policy.json`
- `schemas/package.schema.json`

A later implementation must revise those authorities together rather than partially applying this policy.

## 1. Decision

Publisher-owned GitHub Releases are the canonical long-term origin for publisher `.sctool` payloads.

Simple-Connection does not accept permanent custody responsibility for every historical publisher payload.

Simple-Connection may centrally cache or mirror only the **current default-channel accepted version** of each Registry package.

Historical accepted versions remain represented by immutable Registry metadata but are retrieved from the publisher origin. If the publisher no longer serves the exact accepted historical artifact, that historical artifact becomes unavailable.

## 2. Publication is explicit publisher intent

Creating a source commit, tag, GitHub Release, or Release asset does not automatically request Registry or Marketplace publication.

Marketplace admission requires an explicit publisher-initiated publish/submission action.

The Registry and Marketplace must not:

- crawl publisher repositories for new tools;
- poll publisher repositories for new Releases;
- automatically register every publisher Release;
- infer Marketplace publication intent from a Release existing;
- advance a package merely because a higher semantic version exists at the publisher origin.

A publisher may release versions that are never submitted to the Registry or Marketplace.

## 3. Artifact authority split

### Publisher origin owns

The publisher is responsible for long-term hosting of the artifacts it chooses to keep available.

For each accepted Registry artifact, the Registry must retain enough exact origin identity to locate and verify the publisher-hosted artifact according to the future delivery contract.

The origin remains publisher-owned even when the same exact bytes are centrally cached.

### Registry metadata owns

The Registry owns accepted metadata and verification facts, including at minimum:

- package identity;
- accepted version;
- target identity;
- canonical filename;
- exact SHA-256;
- exact byte size;
- publisher identity;
- publisher signature/evidence;
- exact publisher-origin locator;
- channel state;
- cache state when a central cache exists.

The Registry must not treat a cache locator as content identity.

### Simple-Connection central cache owns

The central cache is a bounded delivery optimization for the current default-channel accepted version.

Its canonical repository identity is `Simple-Connection/sctool-artifacts`.

It is not the canonical historical archive and must not become the only provenance record for publisher content. Recreating that repository does not restore the former all-version custody policy.

## 4. Definition of current version

For this policy, the centrally cached "current version" of a package is:

`package.channels[package.defaultChannel]`

It is not defined as:

- the numerically greatest semantic version;
- the newest publisher Release timestamp;
- the newest GitHub tag;
- the newest artifact discovered by crawling;
- an unpublished beta or alternate channel merely because its version number is higher.

All accepted target artifacts belonging to the current default-channel version are eligible for central caching.

## 5. Bounded central custody

In steady state, Simple-Connection centrally retains no more than one default-channel version per package, with all accepted target artifacts for that version.

Conceptually:

`central custody ~= package count × current default-channel targets`

and not:

`central custody ~= package count × all historical versions × targets`

A short overlap between the old and new current version is allowed only while rotating the cache safely. After the new current version has been verified, accepted, and made the active central cache, the previous central copy becomes eviction-eligible.

Central `.sctool` payloads must not be committed to Registry Git history.

The canonical central cache repository is:

`Simple-Connection/sctool-artifacts`

A separate `Simple-Connection/sctool-cache` repository must not be introduced merely to implement this policy. Reusing the established repository coordinate reduces unnecessary contract, SDK, policy, and operational churn.

The repository is a cache/delivery backend only. Git history remains forbidden as payload storage; cached `.sctool` bytes must use a release-asset or another separately approved non-Git-history storage surface within that repository.

Repository visibility is fixed by `REGISTRY_PUBLIC_ARTIFACT_INTEGRITY_POLICY_V1` as `PUBLIC`.

The cache is a delivery optimization, not an access-control boundary. Public cache bytes remain untrusted until exact integrity and signature verification succeeds.

## 6. Origin and cache are separate locators

A future package/delivery contract must model publisher origin and central cache separately.

Conceptually:

`content`
- canonical filename;
- SHA-256;
- byte size.

`origin`
- publisher-controlled repository/release/asset identity.

`cache`
- optional Simple-Connection-controlled repository/release/asset identity.

The same accepted artifact content identity must be verified regardless of which delivery location is used.

The future schema must not overload one locator so that a cache silently replaces publisher origin provenance.

## 7. Current-version retrieval

For the current default-channel version, the central cache is the preferred delivery location when present and valid.

The publisher origin remains recorded as canonical provenance and may be used as an exact-content fallback if the future delivery contract permits it.

Any fallback must verify the exact accepted filename, byte size, SHA-256, package/version/target identity, and required publisher evidence.

A cache failure never authorizes substitution with different bytes.

## 8. Historical-version retrieval

For an accepted version that is no longer the current default-channel version:

- Simple-Connection has no obligation to retain a central payload copy;
- retrieval is attempted from the exact publisher origin recorded for that accepted artifact;
- the exact accepted content identity must still be verified;
- no cross-release search, same-name search, arbitrary mirror search, or "nearest version" substitution is allowed.

If the exact publisher-origin artifact no longer exists or cannot be retrieved, the result is `ARTIFACT_UNAVAILABLE`.

The Registry may continue to retain historical metadata showing that the version was previously accepted.

Artifact unavailability does not authorize deletion or rewriting of immutable Registry history.

## 9. Cache promotion

A publisher Release alone does not create or rotate the central cache.

A new central cache becomes eligible only after:

1. the publisher explicitly submits the version for Registry/Marketplace publication;
2. Registry Intake independently validates the exact publisher-origin artifact;
3. package ownership and publisher signature checks pass;
4. immutable identity and digest rules pass;
5. the version is accepted into Registry metadata;
6. the package's current default channel is approved to point to that accepted version.

The future implementation must copy/cache exact bytes only after origin verification and must verify the cached bytes again against the accepted content identity.

## 10. Cache rotation and eviction

When the current default-channel version changes from version A to version B:

1. version B origin is verified;
2. version B central cache is created and independently verified;
3. Registry metadata and signed distribution advance to the accepted version B state;
4. consumers may use the new current cache;
5. version A central payload becomes eviction-eligible;
6. version A metadata and origin locator remain preserved.

The implementation must avoid a state where Registry metadata claims a current central cache that is missing or digest-mismatched.

Eviction of the old cache does not mean deletion of the historical Registry version.

## 11. Historical publisher responsibility

After a version is no longer current, long-term payload availability depends on the publisher retaining its origin Release asset.

If the publisher retains it, clients may retrieve and verify it.

If the publisher deletes it, removes the repository, makes it inaccessible under the applicable access policy, or otherwise stops serving the exact accepted asset, Simple-Connection is not required to recreate the historical payload.

This is an intentional availability trade-off accepted to prevent unbounded central artifact custody.

## 12. No silent replacement

The following are forbidden for both current and historical versions:

- replacing an unavailable historical artifact with the current version;
- accepting different bytes for the same `(packageId, version, target)`;
- searching unrelated Releases for a same-named asset;
- accepting a different digest because the original disappeared;
- rewriting historical metadata to point at different content;
- treating a mutable URL as stronger authority than accepted content identity.

An unavailable exact artifact remains unavailable until the exact accepted bytes are again available through an allowed delivery location.

## 13. Marketplace responsibility boundary

The Marketplace lists and serves Registry metadata. It does not discover publisher Releases independently.

The Marketplace must not poll publisher repositories for new tools or versions.

Marketplace visibility changes only after an explicit publisher submission has been accepted into Registry state and a new signed Registry publication has been produced.

Registry-to-Marketplace propagation is event-driven according to `REGISTRY_MARKETPLACE_HANDOFF_RECONCILIATION_POLICY_V1`; routine hourly polling is not part of this policy.

## 14. Capacity objective

The central cache exists to improve availability and performance for the package version users are expected to install by default while placing a practical upper bound on Simple-Connection storage responsibility.

The policy intentionally accepts weaker availability for non-current historical versions in exchange for:

- bounded central storage growth;
- bounded long-term custody responsibility;
- reduced operator burden;
- publisher ownership of publisher payload history;
- explicit publisher control over Marketplace publication.

This is a policy choice, not an accidental cache-expiration behavior.

## 15. Migration status

The Registry v2 contract and Registry Client SDK already use the repository coordinate `Simple-Connection/sctool-artifacts`. That coordinate is preserved and will be reused when the central cache repository is provisioned again.

The repository is currently not present, and there are currently no registered packages requiring artifact retrieval. Recreating the repository is therefore infrastructure provisioning, not restoration of a functioning all-version archive.

The migration must change the **semantics**, not unnecessarily rename the backend:

- current default-channel accepted artifacts may be cached in `Simple-Connection/sctool-artifacts`;
- historical artifacts are resolved from publisher origin;
- Registry metadata must model publisher origin independently of the optional central cache;
- existing SDK and policy constants referencing `Simple-Connection/sctool-artifacts` may be retained where they represent the cache coordinate, but they must no longer imply permanent custody of every accepted version.

That behavior remains unimplemented until a separately approved migration changes the contract, schema, policy, Intake, SDK/client, tests, and delivery behavior coherently.

No implementation may partially switch historical versions to publisher origin while leaving metadata unable to express an exact origin locator.

The migration must be fail-closed and preserve existing immutable content identities.

## 16. Required implementation-plan scope

Before implementation begins, a separate implementation plan and explicit approval must cover at minimum:

1. origin locator schema and exact release/asset identity;
2. central-cache locator schema using `Simple-Connection/sctool-artifacts`;
3. package schema version transition;
4. Registry policy transition;
5. Registry Intake explicit-submission flow;
6. publisher-origin verification;
7. current-version cache creation and digest verification;
8. cache rotation and old-cache eviction;
9. Registry Client SDK resolution for current and historical versions;
10. public central-cache access versus publisher-origin access differences;
11. historical `ARTIFACT_UNAVAILABLE` semantics;
12. migration compatibility with existing accepted metadata;
13. tests for origin disappearance, cache failure, digest mismatch, channel advancement, eviction, and retry;
14. event-driven Registry-to-Marketplace publication without scheduled publisher or Marketplace polling;
15. public redistribution consent before promotion into the public central cache;
16. integrity-first verification proving cache compromise cannot create trusted bytes.

Until that implementation is separately approved, this document fixes architecture policy only.
