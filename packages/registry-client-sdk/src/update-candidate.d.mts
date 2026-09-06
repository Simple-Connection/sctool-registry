import type { GitHubExecFile, RegistryCommandRunner } from "./registry-access.mjs";
import type { RegistryStreamCommandRunner, GitHubSpawn } from "./artifact-delivery.mjs";
import type { ResolvedRegistryPackageTarget } from "./resolution.mjs";
import type { VerifiedArtifactLease } from "./verified-artifact.mjs";

export interface ConsumerInstallationObservation {
  readonly authority: "AUTH_SIMPLE_CONNECTION_DESKTOP";
  readonly packageId: string;
  readonly targetKey: string;
  readonly installedVersion: string;
}

export type UpdateCandidateState =
  | "UPDATE_AVAILABLE"
  | "CURRENT"
  | "DOWNGRADE_NOT_CANDIDATE";

export type UpdateCandidateRelation =
  | "RESOLVED_NEWER"
  | "EQUAL_PRECEDENCE"
  | "RESOLVED_OLDER";

export interface UpdateCandidateEligibility {
  readonly packageId: string;
  readonly targetKey: string;
  readonly resolvedVersion: string;
  readonly state: UpdateCandidateState;
  readonly relation: UpdateCandidateRelation;
}

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

export type UpdateCandidateResolution =
  | (UpdateCandidateEligibility & {
      readonly state: "UPDATE_AVAILABLE";
      readonly relation: "RESOLVED_NEWER";
      readonly candidate: VerifiedUpdateCandidate;
    })
  | (UpdateCandidateEligibility & {
      readonly state: "CURRENT";
      readonly relation: "EQUAL_PRECEDENCE";
      readonly candidate: null;
    })
  | (UpdateCandidateEligibility & {
      readonly state: "DOWNGRADE_NOT_CANDIDATE";
      readonly relation: "RESOLVED_OLDER";
      readonly candidate: null;
    });

export declare class RegistryUpdateCandidateError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ResolveUpdateCandidateOptions {
  readonly runner?: RegistryCommandRunner;
  readonly streamRunner?: RegistryStreamCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface ResolveUpdateCandidateWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile;
  readonly spawnImpl?: GitHubSpawn;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export declare function compareSemanticVersionPrecedence(left: string, right: string): -1 | 0 | 1;

export declare function evaluateUpdateCandidateEligibility(
  resolvedTarget: ResolvedRegistryPackageTarget,
  installationObservation: ConsumerInstallationObservation,
): UpdateCandidateEligibility;

export declare function resolveUpdateCandidate(
  resolvedTarget: ResolvedRegistryPackageTarget,
  installationObservation: ConsumerInstallationObservation,
  options?: ResolveUpdateCandidateOptions,
): Promise<UpdateCandidateResolution>;

export declare function resolveUpdateCandidateWithGitHubCli(
  resolvedTarget: ResolvedRegistryPackageTarget,
  installationObservation: ConsumerInstallationObservation,
  options?: ResolveUpdateCandidateWithGitHubCliOptions,
): Promise<UpdateCandidateResolution>;
