# SCTool Artifact Content / Delivery Boundary v2

artifact_delivery_contract_version: 2.0.0
package_descriptor_schema_version: 3.0.0
access_contract: registry-public-integrity-v1

This contract is the current artifact delivery authority after the 1.0.3a1 custody migration.
ARTIFACT_DELIVERY_V1 is retained as the historical single-central-locator contract.

## 1. Immutable content identity

Registry artifact identity remains (packageId, version, target).
Canonical exact-byte authority remains content.filename, content.sha256, and content.size.
Delivery locators are not content identity and cannot authorize version, target, filename, size, or digest substitution.

## 2. Package descriptor v3 delivery shape

Every accepted artifact requires delivery.origin with repository, releaseId, and assetId.
delivery.cache is optional and uses the same exact locator fields.
delivery.type remains github-release-asset and delivery.access.contract remains registry-public-integrity-v1.
Each artifact also carries publication.marketplace, publication.publicRedistribution, and publisher signature evidence scoped as sctool-submission-v2.

## 3. Publisher origin

The publisher origin is the long-term delivery origin for the exact accepted artifact.
The Registry Client SDK resolves the numeric releaseId directly, requires the returned release ID to match, and requires the exact assetId to exist in that release.
Publisher GitHub Release tag names are observations only and are not Registry locator authority.
The Registry and Marketplace must not crawl or poll publisher repositories. Origin metadata enters Registry state only through explicit publisher-initiated submission.

## 4. Central cache

The canonical cache repository is Simple-Connection/sctool-artifacts.
The cache is a delivery optimization, not provenance or trust authority.
A cache locator is allowed only when the artifact version equals package.channels[package.defaultChannel], publication.publicRedistribution is true, and the cache repository equals Simple-Connection/sctool-artifacts.
Historical versions must not retain a central-cache locator in steady-state Registry metadata.

## 5. Retrieval plan

For the current default-channel version, a present cache is preferred and publisher origin is the exact fallback.
If cache retrieval or cache integrity verification fails, the consumer retries the exact publisher origin and verifies the same accepted filename, byte size, and SHA-256.
A current version without cache uses origin only.
Historical and alternate-channel versions use origin only.
If all allowed exact locations fail, the result is ARTIFACT_UNAVAILABLE.
No failure authorizes another version, another target, same-name search, cross-release search, mutable-latest lookup, arbitrary URL, or digest substitution.

## 6. Integrity boundary

Successful download is not trust.
Before bytes become a verified artifact lease, source, repository, releaseId, and assetId must match the selected descriptor locator; asset name must match content.filename; backend size when present must match content.size; downloaded byte count must match content.size; and SHA-256 must match content.sha256.
Publisher signature evidence and signed Registry metadata remain separate trust inputs.

## 7. Publication and redistribution consent

Marketplace publication is explicit publisher intent. A GitHub Release existing at the origin is not publication intent.
Central public cache promotion requires signed publisher evidence with publication.publicRedistribution=true.
A publisher may publish to Marketplace while declining central redistribution; that accepted descriptor is origin-only.

## 8. Cache lifecycle

Registry policy allows only the current default-channel version in steady-state central cache.
A short old/new overlap is allowed only for safe verification and cutover. After the new current cache is verified and published, the prior cache is eviction-eligible.
tools/artifact-cache-lifecycle.py emits promote, verifyCache, and evictAfterPublication actions. It does not mutate GitHub Releases.
Actual cache upload/delete automation requires a separately owned operational implementation with GitHub write authority.

## 9. Machine enforcement

Machine enforcement is provided by schemas/package.schema.json, schemas/submission.schema.json, policy/registry-policy.json, schemas/policy.schema.json, the Registry Client SDK delivery/integrity implementation, tools/validate-registry.py, tools/test-delivery-package-schema-v3.py, tools/test-submission-schema-v2.py, and tools/artifact-cache-lifecycle.py.

## 10. Historical contract

docs/ARTIFACT_DELIVERY_V1.md remains the historical package-schema-2 single-central-locator contract and must not be used as current delivery authority.
