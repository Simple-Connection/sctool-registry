import type {
  GitHubExecFile,
  RegistryCommandRunner,
  RegistryGitHubIdentity,
} from "./registry-access.mjs";

export interface ResolvedRegistryTargetDelivery {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey?: string | null;
  readonly delivery: {
    readonly type: string;
    readonly access?: { readonly contract?: string };
    readonly locator?: {
      readonly repository?: string;
      readonly assetId?: number;
    };
  };
}

export interface ResolvedGitHubReleaseAsset {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly repository: string;
  readonly expectedTag: string;
  readonly releaseId: number | null;
  readonly assetId: number;
  readonly backendAssetName: string | null;
  readonly backendAssetSize: number | null;
  readonly assetApiPath: string;
  readonly identity: RegistryGitHubIdentity;
}

export interface RegistryArtifactReadableStream extends AsyncIterable<Uint8Array> {
  pipe(destination: unknown): unknown;
  destroy(error?: Error): void;
}

export type RegistryStreamCompletionOutcome =
  | { readonly kind: "completed"; readonly exitCode: number; readonly stderr: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "timeout" }
  | { readonly kind: "transport-error" };

export type RegistryStreamCommandOutcome =
  | {
      readonly kind: "started";
      readonly stdout: RegistryArtifactReadableStream;
      readonly completion: Promise<RegistryStreamCompletionOutcome>;
      readonly abort: () => boolean;
    }
  | { readonly kind: "transport-error" };

export interface RegistryStreamCommandRequest {
  readonly command: "gh";
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}

export type RegistryStreamCommandRunner = (
  request: RegistryStreamCommandRequest,
) => Promise<RegistryStreamCommandOutcome>;

export interface GitHubSpawnChild {
  readonly stdout: RegistryArtifactReadableStream;
  readonly stderr?: {
    on(event: "data", listener: (chunk: unknown) => void): unknown;
  };
  once(event: "error", listener: (error: { readonly code?: string }) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

export type GitHubSpawn = (
  command: string,
  args: string[],
  options: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly windowsHide: true;
    readonly stdio: readonly ["ignore", "pipe", "pipe"];
  },
) => GitHubSpawnChild;

export interface ResolveGitHubReleaseAssetOptions {
  readonly runner?: RegistryCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface OpenGitHubReleaseAssetStreamOptions extends ResolveGitHubReleaseAssetOptions {
  readonly streamRunner?: RegistryStreamCommandRunner;
}

export interface OpenGitHubReleaseAssetStreamWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile;
  readonly spawnImpl?: GitHubSpawn;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface OpenedGitHubReleaseAssetStream {
  readonly packageId: string;
  readonly version: string;
  readonly targetKey: string | null;
  readonly repository: string;
  readonly expectedTag: string;
  readonly releaseId: number | null;
  readonly assetId: number;
  readonly backendAssetName: string | null;
  readonly backendAssetSize: number | null;
  readonly identity: RegistryGitHubIdentity;
  readonly stream: RegistryArtifactReadableStream;
  readonly completed: Promise<Readonly<{ exitCode: 0 }>>;
  readonly abort: () => boolean;
}

export declare class RegistryArtifactDeliveryError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export declare function deriveExpectedReleaseTag(packageId: string, version: string): string;

export declare function resolveGitHubReleaseAsset(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: ResolveGitHubReleaseAssetOptions,
): Promise<ResolvedGitHubReleaseAsset>;

export declare function createGitHubCliStreamCommandRunner(options?: {
  readonly spawnImpl?: GitHubSpawn;
  readonly maxDiagnosticBytes?: number;
}): RegistryStreamCommandRunner | null;

export declare function openGitHubReleaseAssetStream(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: OpenGitHubReleaseAssetStreamOptions,
): Promise<OpenedGitHubReleaseAssetStream>;

export declare function resolveGitHubReleaseAssetWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: {
    readonly execFileImpl?: GitHubExecFile;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly artifactRepository?: string;
    readonly timeoutMs?: number;
  },
): Promise<ResolvedGitHubReleaseAsset>;

export declare function openGitHubReleaseAssetStreamWithGitHubCli(
  resolvedTarget: ResolvedRegistryTargetDelivery,
  options?: OpenGitHubReleaseAssetStreamWithGitHubCliOptions,
): Promise<OpenedGitHubReleaseAssetStream>;
