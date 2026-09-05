import type { GitHubExecFile, RegistryCommandRunner } from "./registry-access.mjs";
import type { RegistryStreamCommandRunner, GitHubSpawn } from "./artifact-delivery.mjs";
import type { ResolvedRegistryPackageTarget } from "./resolution.mjs";
import type { VerifiedArtifactLease } from "./verified-artifact.mjs";

export interface VerifiedUpdateCandidate {
  readonly packageId: string;
  readonly channel: string | null;
  readonly version: string;
  readonly targetKey: string;
  readonly target: Readonly<{
    platform: string;
    arch: string;
  }>;
  readonly content: Readonly<{
    filename: string;
    sha256: string;
    size: number;
  }>;
  readonly delivery: Readonly<{
    type: "github-release-asset";
    repository: string;
    assetId: number;
    expectedTag: string;
  }>;
  readonly publishedAt: string;
  readonly contract: Readonly<{
    sctoolSpecVersion: string;
  }>;
  readonly artifact: VerifiedArtifactLease;
}

export declare class RegistryUpdateCandidateError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface RetrieveVerifiedUpdateCandidateOptions {
  readonly runner?: RegistryCommandRunner;
  readonly streamRunner?: RegistryStreamCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface RetrieveVerifiedUpdateCandidateWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile;
  readonly spawnImpl?: GitHubSpawn;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export declare function retrieveVerifiedUpdateCandidate(
  resolvedTarget: ResolvedRegistryPackageTarget,
  options?: RetrieveVerifiedUpdateCandidateOptions,
): Promise<VerifiedUpdateCandidate>;

export declare function retrieveVerifiedUpdateCandidateWithGitHubCli(
  resolvedTarget: ResolvedRegistryPackageTarget,
  options?: RetrieveVerifiedUpdateCandidateWithGitHubCliOptions,
): Promise<VerifiedUpdateCandidate>;
