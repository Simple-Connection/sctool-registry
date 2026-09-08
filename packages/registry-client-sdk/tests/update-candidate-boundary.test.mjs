import {
  resolveUpdateCandidate,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

import {
  createRetrievalHarness,
  equal,
  makeTarget,
  observation,
  readAll,
  truthy,
  artifactBytes,
} from "./update-test-support.mjs";

const target = makeTarget();
const harness = createRetrievalHarness(target);
const resolution = await resolveUpdateCandidate(target, observation("1.2.2"), {
  runner: harness.runner,
  streamRunner: harness.streamRunner,
  environment: { PATH: "x", GH_TOKEN: "forbidden" },
});
const candidate = resolution.candidate;
truthy(candidate, "candidate exists");

const requiredFields = [
  "packageId",
  "channel",
  "version",
  "targetKey",
  "target",
  "content",
  "delivery",
  "publishedAt",
  "contract",
  "artifact",
];
const forbiddenFields = [
  "githubIdentity",
  "githubToken",
  "credentialPath",
  "installedVersion",
  "isUpdateAvailable",
  "shouldInstall",
  "shouldActivate",
  "installPath",
  "rollbackTarget",
  "runtimeState",
  "rendererState",
  "persistentInstallState",
];

let cases = 0;
for (const field of requiredFields) {
  truthy(field in candidate, `required candidate field missing: ${field}`);
  cases += 1;
}
for (const field of forbiddenFields) {
  equal(field in candidate, false, `forbidden candidate field present: ${field}`);
  cases += 1;
}
truthy(Object.isFrozen(candidate), "candidate frozen");
cases += 1;
truthy(Object.isFrozen(candidate.content), "candidate content frozen");
cases += 1;
equal("path" in candidate.artifact, false, "raw path excluded");
cases += 1;
equal("writeStream" in candidate.artifact, false, "write access excluded");
cases += 1;
const output = await readAll(candidate.artifact.openReadStream());
equal(output.toString(), artifactBytes.toString(), "verified artifact bytes");
cases += 1;
await candidate.artifact.dispose();

export const evidence = Object.freeze({
  id: "GATE_UPDATE_CANDIDATE_BOUNDARY",
  status: "PASS",
  cases,
  details: Object.freeze({
    required_fields_checked: Object.freeze(requiredFields),
    forbidden_fields_checked: Object.freeze(forbiddenFields),
    raw_path_exposed: false,
    write_access_exposed: false,
    verified_artifact_lease: true,
  }),
});

console.log(`Registry update candidate boundary PASS cases=${cases}`);
