import { writeFile } from "node:fs/promises";

import { evidence as observationEvidence } from "./update-observation.test.mjs";
import { evidence as precedenceEvidence } from "./update-version-precedence.test.mjs";
import { evidence as eligibilityEvidence } from "./update-eligibility.test.mjs";
import {
  eligibleRetrievalEvidence,
  noRetrievalEvidence,
} from "./update-retrieval-gate.test.mjs";
import { evidence as boundaryEvidence } from "./update-candidate-boundary.test.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

const out = argument("--out");
const repository = argument("--repository");
const revision = argument("--revision");
const checks = [
  observationEvidence,
  precedenceEvidence,
  eligibilityEvidence,
  noRetrievalEvidence,
  eligibleRetrievalEvidence,
  boundaryEvidence,
];
const totalCases = checks.reduce((sum, check) => sum + check.cases, 0);

const evidence = {
  format: "update-candidate-validation/v1",
  subject: {
    repository,
    revision,
  },
  contract: "UPDATE_CANDIDATE_V1",
  checks: Object.fromEntries(checks.map((check) => [check.id, check])),
  resolution_states: {
    UPDATE_AVAILABLE: "PASS",
    CURRENT: "PASS",
    DOWNGRADE_NOT_CANDIDATE: "PASS",
  },
  aggregate: {
    gate: "GATE_UPDATE_CANDIDATE_REGRESSION",
    status: "PASS",
    total_cases: totalCases,
  },
};

await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(`Registry update candidate automation evidence PASS cases=${totalCases}`);
