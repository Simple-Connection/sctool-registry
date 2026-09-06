import {
  RegistryUpdateCandidateError,
  evaluateUpdateCandidateEligibility,
} from "@simple-connection/sctool-registry-client-sdk/update-candidate";

import {
  equal,
  errorCode,
  makeTarget,
  observation,
} from "./update-test-support.mjs";

const target = makeTarget();
let cases = 0;

await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(
    target,
    observation("1.2.2", { authority: "AUTH_REGISTRY_CLIENT_SDK" }),
  )),
  RegistryUpdateCandidateError,
  "installation-authority-mismatch",
  "wrong authority rejected",
);
cases += 1;

await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(
    target,
    observation("1.2.2", { packageId: "other-tool" }),
  )),
  RegistryUpdateCandidateError,
  "installation-binding-mismatch",
  "package binding rejected",
);
cases += 1;

await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(
    target,
    observation("1.2.2", { targetKey: "linux-x64" }),
  )),
  RegistryUpdateCandidateError,
  "installation-binding-mismatch",
  "target binding rejected",
);
cases += 1;

await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(
    target,
    { ...observation("1.2.2"), installPath: "forbidden" },
  )),
  RegistryUpdateCandidateError,
  "invalid-installation-observation",
  "additional installation state rejected",
);
cases += 1;

const missingVersion = {
  authority: "AUTH_SIMPLE_CONNECTION_DESKTOP",
  packageId: "example-tool",
  targetKey: "win-x64",
};
await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(target, missingVersion)),
  RegistryUpdateCandidateError,
  "invalid-installation-observation",
  "missing installedVersion rejected",
);
cases += 1;

await errorCode(
  () => Promise.resolve(evaluateUpdateCandidateEligibility(
    target,
    observation("not-semver"),
  )),
  RegistryUpdateCandidateError,
  "invalid-semver",
  "invalid installed version rejected",
);
cases += 1;

const accepted = evaluateUpdateCandidateEligibility(target, observation("1.2.2"));
equal(accepted.packageId, "example-tool", "accepted package binding");
cases += 1;
equal(accepted.targetKey, "win-x64", "accepted target binding");
cases += 1;

export const evidence = Object.freeze({
  id: "GATE_UPDATE_OBSERVATION_CONTRACT",
  status: "PASS",
  cases,
  details: Object.freeze({
    authority: "AUTH_SIMPLE_CONNECTION_DESKTOP",
    access: "READ_ONLY",
    installed_version_role: "INPUT_ONLY",
    additional_fields: "FORBIDDEN",
  }),
});

console.log(`Registry update observation contract PASS cases=${cases}`);
