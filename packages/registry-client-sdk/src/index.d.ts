export declare const REGISTRY_CLIENT_SDK_NAME: "@simple-connection/sctool-registry-client-sdk";
export declare const REGISTRY_CLIENT_SDK_VERSION: "0.1.0";

export interface RegistryClientContractIdentity {
  readonly registryContractVersion: "2.0.0";
  readonly registryAccessContract: "registry-access-v1";
  readonly artifactDeliveryContractVersion: "1.0.0";
  readonly packageDescriptorSchemaVersion: "2.0.0";
  readonly deliveryType: "github-release-asset";
  readonly artifactRepository: "Simple-Connection/sctool-artifacts";
}

export declare const REGISTRY_CLIENT_CONTRACT: Readonly<RegistryClientContractIdentity>;
