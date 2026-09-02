import assert from "node:assert/strict";
import test from "node:test";

import {
  REGISTRY_CLIENT_CONTRACT,
  REGISTRY_CLIENT_SDK_NAME,
  REGISTRY_CLIENT_SDK_VERSION,
} from "../src/index.mjs";

test("Registry Client SDK identity is explicit and distinct from the Authoring SDK", () => {
  assert.equal(REGISTRY_CLIENT_SDK_NAME, "@simple-connection/sctool-registry-client-sdk");
  assert.equal(REGISTRY_CLIENT_SDK_VERSION, "0.1.0");
});

test("Registry Client SDK pins only canonical Registry contract identities", () => {
  assert.deepEqual(REGISTRY_CLIENT_CONTRACT, {
    registryContractVersion: "2.0.0",
    registryAccessContract: "registry-access-v1",
    artifactDeliveryContractVersion: "1.0.0",
    packageDescriptorSchemaVersion: "2.0.0",
    deliveryType: "github-release-asset",
    artifactRepository: "Simple-Connection/sctool-artifacts",
  });
});
