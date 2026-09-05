import {
  REGISTRY_CLIENT_CONTRACT,
  REGISTRY_CLIENT_SDK_NAME,
  REGISTRY_CLIENT_SDK_VERSION,
} from "../src/index.mjs";

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected=${expected} actual=${actual}`);
  }
}

requireEqual(
  REGISTRY_CLIENT_SDK_NAME,
  "@simple-connection/sctool-registry-client-sdk",
  "sdk name",
);
requireEqual(REGISTRY_CLIENT_SDK_VERSION, "0.1.0", "sdk version");
requireEqual(REGISTRY_CLIENT_CONTRACT.registryContractVersion, "2.0.0", "registry contract");
requireEqual(REGISTRY_CLIENT_CONTRACT.registryAccessContract, "registry-access-v1", "access contract");
requireEqual(REGISTRY_CLIENT_CONTRACT.artifactDeliveryContractVersion, "1.0.0", "delivery contract");
requireEqual(REGISTRY_CLIENT_CONTRACT.stagedArtifactLifecycleContract, "staged-artifact-lifecycle-v1", "staging lifecycle contract");
requireEqual(REGISTRY_CLIENT_CONTRACT.updateCandidateContract, "update-candidate-v1", "update candidate contract");
requireEqual(REGISTRY_CLIENT_CONTRACT.packageDescriptorSchemaVersion, "2.0.0", "package schema");
requireEqual(REGISTRY_CLIENT_CONTRACT.deliveryType, "github-release-asset", "delivery type");
requireEqual(
  REGISTRY_CLIENT_CONTRACT.artifactRepository,
  "Simple-Connection/sctool-artifacts",
  "artifact repository",
);

console.log("Registry Client SDK boundary PASS cases=10");
