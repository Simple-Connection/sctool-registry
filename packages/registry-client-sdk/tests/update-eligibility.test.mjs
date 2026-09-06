import {
  evaluateUpdateCandidateEligibility,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

import { equal, makeTarget, observation } from "./update-test-support.mjs";

const target = makeTarget();
let cases = 0;

const newer = evaluateUpdateCandidateEligibility(target, observation("1.2.2"));
equal(newer.state, "UPDATE_AVAILABLE", "newer state");
cases += 1;
equal(newer.relation, "RESOLVED_NEWER", "newer relation");
cases += 1;
equal(newer.resolvedVersion, "1.2.3", "newer resolved version");
cases += 1;

const current = evaluateUpdateCandidateEligibility(
  target,
  observation("1.2.3+local"),
);
equal(current.state, "CURRENT", "current state");
cases += 1;
equal(current.relation, "EQUAL_PRECEDENCE", "current relation");
cases += 1;
equal(current.resolvedVersion, "1.2.3", "current resolved version");
cases += 1;

const downgrade = evaluateUpdateCandidateEligibility(target, observation("2.0.0"));
equal(downgrade.state, "DOWNGRADE_NOT_CANDIDATE", "downgrade state");
cases += 1;
equal(downgrade.relation, "RESOLVED_OLDER", "downgrade relation");
cases += 1;
equal(downgrade.resolvedVersion, "1.2.3", "downgrade resolved version");
cases += 1;

export const evidence = Object.freeze({
  id: "GATE_UPDATE_ELIGIBILITY_RESOLUTION",
  status: "PASS",
  cases,
  details: Object.freeze({
    states: Object.freeze({
      UPDATE_AVAILABLE: "PASS",
      CURRENT: "PASS",
      DOWNGRADE_NOT_CANDIDATE: "PASS",
    }),
    relations: Object.freeze({
      RESOLVED_NEWER: "PASS",
      EQUAL_PRECEDENCE: "PASS",
      RESOLVED_OLDER: "PASS",
    }),
  }),
});

console.log(`Registry update eligibility resolution PASS cases=${cases}`);
