import {
  RegistryUpdateCandidateError,
  resolveUpdateCandidate,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";
import {
  RegistryArtifactDeliveryError,
} from "@simple-connection/sctool-registry-client-sdk/artifact-delivery";

import {
  createRetrievalHarness,
  equal,
  errorCode,
  makeTarget,
  observation,
  truthy,
} from "./update-test-support.mjs";

const target = makeTarget();
let cases = 0;

const currentHarness = createRetrievalHarness(target);
const current = await resolveUpdateCandidate(target, observation("1.2.3"), {
  fetchImpl: currentHarness.fetchImpl,
});
equal(current.state, "CURRENT", "current state");
cases += 1;
equal(current.candidate, null, "current candidate null");
cases += 1;
equal(currentHarness.counters.textRequests, 0, "current text requests");
cases += 1;
equal(currentHarness.counters.assetStreams, 0, "current artifact streams");
cases += 1;

const downgradeHarness = createRetrievalHarness(target);
const downgrade = await resolveUpdateCandidate(target, observation("2.0.0"), {
  fetchImpl: downgradeHarness.fetchImpl,
});
equal(downgrade.state, "DOWNGRADE_NOT_CANDIDATE", "downgrade state");
cases += 1;
equal(downgrade.candidate, null, "downgrade candidate null");
cases += 1;
equal(downgradeHarness.counters.textRequests, 0, "downgrade text requests");
cases += 1;
equal(downgradeHarness.counters.assetStreams, 0, "downgrade artifact streams");
cases += 1;

const invalidHarness = createRetrievalHarness(target);
await errorCode(
  () => resolveUpdateCandidate(
    target,
    observation("1.2.2", { authority: "AUTH_REGISTRY_CLIENT_SDK" }),
    {
      fetchImpl: invalidHarness.fetchImpl,
    },
  ),
  RegistryUpdateCandidateError,
  "installation-authority-mismatch",
  "invalid observation rejected before retrieval",
);
cases += 1;
equal(invalidHarness.counters.textRequests, 0, "invalid text requests");
cases += 1;
equal(invalidHarness.counters.assetStreams, 0, "invalid artifact streams");
cases += 1;

const eligibleHarness = createRetrievalHarness(target);
const eligible = await resolveUpdateCandidate(target, observation("1.2.2"), {
  fetchImpl: eligibleHarness.fetchImpl,
});
equal(eligible.state, "UPDATE_AVAILABLE", "eligible state");
cases += 1;
truthy(eligible.candidate, "eligible candidate exists");
cases += 1;
equal(eligibleHarness.counters.releaseQueries, 1, "eligible exact release query");
cases += 1;
equal(eligibleHarness.counters.assetStreams, 1, "eligible artifact stream");
cases += 1;
await eligible.candidate.artifact.dispose();

const cacheUnavailableHarness = createRetrievalHarness(target, { cacheReleaseStatus: 404 });
const cacheUnavailable = await resolveUpdateCandidate(target, observation("1.2.2"), {
  fetchImpl: cacheUnavailableHarness.fetchImpl,
});
equal(cacheUnavailable.candidate.delivery.source, "origin", "cache 404 falls back to origin");
cases += 1;
equal(cacheUnavailable.candidate.delivery.cacheFallbackUsed, true, "cache fallback marker");
cases += 1;
equal(cacheUnavailableHarness.counters.cacheReleaseQueries, 1, "cache queried once before fallback");
cases += 1;
equal(cacheUnavailableHarness.counters.originReleaseQueries, 1, "origin queried once after cache failure");
cases += 1;
await cacheUnavailable.candidate.artifact.dispose();

const corruptCacheHarness = createRetrievalHarness(target, { corruptCache: true });
const corruptCache = await resolveUpdateCandidate(target, observation("1.2.2"), {
  fetchImpl: corruptCacheHarness.fetchImpl,
});
equal(corruptCache.candidate.delivery.source, "origin", "cache integrity failure falls back to origin");
cases += 1;
equal(corruptCache.candidate.delivery.cacheFallbackUsed, true, "integrity fallback marker");
cases += 1;
equal(corruptCacheHarness.counters.cacheAssetStreams, 1, "corrupt cache bytes retrieved once");
cases += 1;
equal(corruptCacheHarness.counters.originAssetStreams, 1, "origin bytes retrieved after cache integrity failure");
cases += 1;
await corruptCache.candidate.artifact.dispose();

const unavailableHarness = createRetrievalHarness(target, {
  cacheReleaseStatus: 404,
  originReleaseStatus: 404,
});
await errorCode(
  () => resolveUpdateCandidate(target, observation("1.2.2"), {
    fetchImpl: unavailableHarness.fetchImpl,
  }),
  RegistryArtifactDeliveryError,
  "ARTIFACT_UNAVAILABLE",
  "all allowed locations unavailable",
);
cases += 1;
equal(unavailableHarness.counters.cacheReleaseQueries, 1, "unavailable path cache query");
cases += 1;
equal(unavailableHarness.counters.originReleaseQueries, 1, "unavailable path origin query");
cases += 1;

const historicalTarget = makeTarget({
  version: "1.1.0",
  delivery: { cache: undefined },
  deliveryPlan: {
    currentDefaultVersion: "1.2.3",
    isCurrentDefaultVersion: false,
    preferredSource: "origin",
    fallbackSource: null,
  },
});
const historicalHarness = createRetrievalHarness(historicalTarget);
const historical = await resolveUpdateCandidate(historicalTarget, observation("1.0.0"), {
  fetchImpl: historicalHarness.fetchImpl,
});
equal(historical.candidate.delivery.source, "origin", "historical retrieval uses origin");
cases += 1;
equal(historicalHarness.counters.cacheReleaseQueries, 0, "historical retrieval never queries cache");
cases += 1;
equal(historicalHarness.counters.originReleaseQueries, 1, "historical retrieval exact origin query");
cases += 1;
await historical.candidate.artifact.dispose();

export const noRetrievalEvidence = Object.freeze({
  id: "GATE_UPDATE_NO_RETRIEVAL_WHEN_INELIGIBLE",
  status: "PASS",
  cases: 11,
  details: Object.freeze({
    CURRENT: Object.freeze({ text_requests: 0, asset_streams: 0 }),
    DOWNGRADE_NOT_CANDIDATE: Object.freeze({ text_requests: 0, asset_streams: 0 }),
    INVALID_OBSERVATION: Object.freeze({ text_requests: 0, asset_streams: 0 }),
  }),
});

export const eligibleRetrievalEvidence = Object.freeze({
  id: "GATE_UPDATE_RETRIEVAL_WHEN_ELIGIBLE",
  status: "PASS",
  cases: 4,
  details: Object.freeze({
    UPDATE_AVAILABLE: Object.freeze({
      release_queries: eligibleHarness.counters.releaseQueries,
      asset_streams: eligibleHarness.counters.assetStreams,
      verified_candidate: true,
    }),
  }),
});

console.log("Registry update no-retrieval invariant PASS cases=11");
console.log("Registry update eligible-retrieval invariant PASS cases=4");
console.log("Registry update cache fallback and historical-origin invariant PASS cases=14");
