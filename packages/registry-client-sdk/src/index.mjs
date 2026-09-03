export const REGISTRY_CLIENT_SDK_NAME = "@simple-connection/sctool-registry-client-sdk";
export const REGISTRY_CLIENT_SDK_VERSION = "0.1.0";

export const REGISTRY_CLIENT_CONTRACT = Object.freeze({
  registryContractVersion: "2.0.0",
  registryAccessContract: "registry-access-v1",
  artifactDeliveryContractVersion: "1.0.0",
  packageDescriptorSchemaVersion: "2.0.0",
  deliveryType: "github-release-asset",
  artifactRepository: "Simple-Connection/sctool-artifacts",
});

export * from "./registry-access.mjs";
export * from "./package-descriptor.mjs";
export * from "./resolution.mjs";
