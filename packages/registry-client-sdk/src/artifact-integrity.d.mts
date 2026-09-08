import type { ResolvedRegistryPackageTarget } from "./resolution.mjs";
import type { OpenedGitHubReleaseAssetStream } from "./artifact-delivery.mjs";
import type { InternalArtifactStagingResource } from "./artifact-staging.mjs";

export declare class RegistryArtifactIntegrityError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface VerifiedArtifactRecord {
  readonly resource: InternalArtifactStagingResource;
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly repository: string;
  readonly expectedTag: string;
  readonly releaseId: number | null;
  readonly assetId: number;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
}

export declare function stageAndVerifyRetrievedArtifact(
  resolvedTarget: ResolvedRegistryPackageTarget,
  retrieval: OpenedGitHubReleaseAssetStream,
  options?: { readonly temporaryRoot?: string },
): Promise<VerifiedArtifactRecord>;
