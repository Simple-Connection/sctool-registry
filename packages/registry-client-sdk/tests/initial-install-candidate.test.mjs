import {
  RegistryInitialInstallCandidateError,
  resolveInitialInstallCandidate,
} from "@simple-connection/sctool-registry-client-sdk/initial-install-candidate";

import {
  artifactBytes,
  createRetrievalHarness,
  equal,
  errorCode,
  makeTarget,
  readAll,
  truthy,
} from "./update-test-support.mjs";

const target = makeTarget();
const harness = createRetrievalHarness(target);
const result = await resolveInitialInstallCandidate(target, {
  runner: harness.runner,
  streamRunner: harness.streamRunner,
  environment: { PATH: "x", GH_TOKEN: "forbidden" },
});

equal(result.state, "INITIAL_INSTALL_READY", "initial install state");
equal(result.packageId, target.packageId, "package binding");
equal(result.targetKey, target.targetKey, "target binding");
equal(result.resolvedVersion, target.version, "version binding");
equal(harness.counters.releaseQueries, 1, "release query");
equal(harness.counters.assetStreams, 1, "artifact stream");

const candidate = result.candidate;
truthy(candidate, "candidate exists");
equal("installedVersion" in candidate, false, "installed version is not required or projected");
equal("shouldInstall" in candidate, false, "install policy excluded");
equal("installPath" in candidate, false, "install path excluded");
equal("persistentInstallState" in candidate, false, "persistent state excluded");
equal("activation" in candidate, false, "activation excluded");
equal("rollback" in candidate, false, "rollback excluded");
equal("path" in candidate.artifact, false, "raw path excluded");
equal("writeStream" in candidate.artifact, false, "write access excluded");
truthy(Object.isFrozen(candidate), "candidate frozen");

const output = await readAll(candidate.artifact.openReadStream());
equal(output.toString(), artifactBytes.toString(), "verified artifact bytes");
await candidate.artifact.dispose();

await errorCode(
  () => resolveInitialInstallCandidate(target),
  RegistryInitialInstallCandidateError,
  "configuration-error",
  "retrieval configuration required",
);

console.log("Registry initial-install candidate PASS cases=17");
