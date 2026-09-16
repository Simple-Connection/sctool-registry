# SCTool Public Artifact Integrity Policy v1

Status: **POLICY DECIDED — IMPLEMENTATION NOT YET AUTHORIZED**

This document fixes the approved security model for the Simple-Connection central SCTool artifact cache.

Canonical cache repository:

`Simple-Connection/sctool-artifacts`

Approved visibility:

`PUBLIC`

The cache is a delivery surface, not a trust authority.

## 1. Decision

The Marketplace serves an open-ended public user population. Per-user collaborator grants or private-repository read grants are not part of artifact delivery.

The central cache must not require repository read authorization for end-user artifact retrieval.

Public cache bytes are untrusted until verified against accepted Registry state and publisher evidence.

Security is based on tamper detection and fail-closed verification, not on keeping distributable artifact bytes confidential.

## 2. Public visibility

Public visibility means repository metadata, Release metadata, and Release assets may be publicly visible and directly downloadable.

Direct download does not establish Registry acceptance or artifact trust.

The system does not claim confidentiality, DRM, per-device entitlement, or application-only retrieval for public central-cache artifacts.

## 3. GitHub login boundary

GitHub authentication may still be used by Simple Connection or Marketplace for user identity and user-facing service flows.

GitHub login is not the authorization boundary for reading public central-cache Release assets.

A Registry Client implementation must not require collaborator membership or private-repository read permission solely to retrieve a public central-cache artifact.

Identity and artifact integrity are separate concerns.

## 4. Trust authority

Artifact trust is established by the accepted Registry package/version/target identity, canonical filename, exact byte size, exact SHA-256, publisher identity and signature evidence, signed Registry state, and immutable identity rules.

Repository visibility, Release existence, asset name alone, mutable download URLs, timestamps, uploader display identity, and successful HTTP download alone are not trust authorities.

## 5. Integrity gate

Before downloaded cache bytes become a verified installation candidate, the client must:

1. resolve the exact accepted package/version/target;
2. resolve the exact allowed cache locator;
3. require the expected asset identity;
4. require the backend asset name to equal the canonical filename;
5. require backend size to equal the accepted size when available;
6. retrieve the exact bytes;
7. require downloaded byte length to equal the accepted size;
8. require SHA-256 of downloaded bytes to equal the accepted SHA-256;
9. preserve required publisher-signature verification;
10. preserve required signed-Registry verification;
11. fail closed on every mismatch.

A successful download without these checks is not an accepted artifact.

## 6. Cache compromise boundary

Compromise of cache write access must not grant Registry trust authority.

Replacing, adding, deleting, or renaming cache assets must either still produce the exact accepted bytes and pass verification or fail closed.

Cache compromise must not allow creation of a new accepted package identity, alteration of an accepted digest, alteration of signed Registry metadata, creation of a valid publisher signature, silent substitution of another version, or weakening of verification.

## 7. Secret boundary

The public cache repository must not contain Registry signing private material, publisher signing private material, Marketplace deployment credentials, or long-lived authentication material.

Public keys, digests, signatures, and non-secret verification metadata may be public.

## 8. Write authority

Public read access does not imply public write access.

Cache write authority must be minimized and separated from Registry signing authority and Marketplace source-mutation authority.

Future automation must use only the permissions needed to create, verify, rotate, and evict cache Release assets.

## 9. Public redistribution consent

A publisher Release existing does not authorize Simple-Connection to republish it publicly.

Eligibility for the public central cache requires explicit publisher intent to publish through the public SCTool Marketplace and explicit authorization for public redistribution of the accepted bytes.

A future Intake/submission contract must machine-represent this consent or an equivalent unambiguous publication authorization.

If public redistribution authorization is absent or cannot be proven, the artifact must not be promoted into the public central cache.

Source-repository visibility is separate. A publisher may keep source private while explicitly authorizing public distribution of the built SCTool artifact.

## 10. Bounded custody

This policy operates with `REGISTRY_ARTIFACT_CUSTODY_CACHE_POLICY_V1`.

Only the current default-channel accepted version is eligible for central caching in steady state.

Historical versions are resolved from the exact publisher origin when available. Making the cache public does not restore all-version central custody.

## 11. Fallback

If a current-version cache asset is unavailable or fails integrity verification, an allowed publisher-origin fallback may be used only when the future delivery contract permits it.

Fallback must resolve the exact accepted artifact and pass the same integrity checks.

No different digest, different version, same-name search, arbitrary mirror, or mutable-latest fallback is allowed.

## 12. Marketplace boundary

Marketplace publication remains publisher-initiated.

Registry and Marketplace must not crawl publisher repositories or infer publication intent from Release existence.

Public cache visibility does not list or admit a package into Marketplace.

## 13. Migration

The currently implemented private-access model assumes GitHub authentication plus private repository read authorization.

The approved target is public transport plus fail-closed signature and content-integrity verification.

A future implementation must update the Registry contract, access contract, artifact delivery contract, machine policy/schema, Registry Client SDK, tests, and documentation coherently.

The private-access prerequisite must not simply be removed while leaving an unverified public download path.

## 14. Required implementation gates

A separately approved implementation must prove at minimum:

- public cache download does not require collaborator/private-repository permission;
- exact SHA-256 mismatch fails closed;
- byte-size mismatch fails closed;
- asset-name mismatch fails closed;
- wrong asset identity fails closed;
- publisher-signature failure fails closed;
- signed-Registry verification failure fails closed;
- cache deletion produces availability failure or exact-origin fallback, never substitution;
- cache compromise cannot change Registry trust authority;
- restricted credential material is absent from public cache content;
- public redistribution consent is required before cache promotion.

Until separately approved implementation, this document fixes policy and security architecture only.
