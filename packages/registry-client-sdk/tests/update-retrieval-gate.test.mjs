import {
  RegistryUpdateCandidateError,
  resolveUpdateCandidate,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

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
  runner: currentHarness.runner,
  streamRunner: currentHarness.streamRunner,
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
  runner: downgradeHarness.runner,
  streamRunner: downgradeHarness.streamRunner,
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
      runner: invalidHarness.runner,
      streamRunner: invalidHarness.streamRunner,
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
  runner: eligibleHarness.runner,
  streamRunner: eligibleHarness.streamRunner,
  environment: { PATH: "x", GH_TOKEN: "forbidden" },
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
