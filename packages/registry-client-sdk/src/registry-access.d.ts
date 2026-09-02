export type RegistryAccessState =
  | "authorized"
  | "gh-unavailable"
  | "unauthenticated"
  | "identity-unresolved"
  | "access-denied"
  | "network-unavailable"
  | "configuration-error";

export interface RegistryGitHubIdentity {
  readonly provider: "github.com";
  readonly login: string;
}

export interface RegistryAccessResult {
  readonly state: RegistryAccessState;
  readonly identity: RegistryGitHubIdentity | null;
  readonly authorized: boolean;
}

export interface RegistryCommandRequest {
  readonly command: "gh";
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
}

export type RegistryCommandOutcome =
  | { readonly kind: "completed"; readonly exitCode: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "timeout" }
  | { readonly kind: "transport-error" };

export type RegistryCommandRunner = (request: RegistryCommandRequest) => Promise<RegistryCommandOutcome>;

export interface CheckRegistryAccessOptions {
  readonly runner?: RegistryCommandRunner;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export interface GitHubExecError extends Error {
  code?: string | number;
  killed?: boolean;
}

export type GitHubExecFile = (
  command: string,
  args: string[],
  options: {
    env: Readonly<Record<string, string | undefined>>;
    encoding: "utf8";
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
  },
  callback: (error: GitHubExecError | null, stdout?: string, stderr?: string) => void,
) => void;

export interface CheckRegistryAccessWithGitHubCliOptions {
  readonly execFileImpl?: GitHubExecFile;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly artifactRepository?: string;
  readonly timeoutMs?: number;
}

export declare const REGISTRY_ACCESS_STATES: readonly RegistryAccessState[];
export declare const DEFAULT_REGISTRY_ARTIFACT_REPOSITORY: "Simple-Connection/sctool-artifacts";
export declare const DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS: 10000;

export declare function sanitizeRegistryGitHubEnvironment(
  environment?: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined>;

export declare function checkRegistryAccess(
  options?: CheckRegistryAccessOptions,
): Promise<RegistryAccessResult>;

export declare function createGitHubCliCommandRunner(
  options?: { readonly execFileImpl?: GitHubExecFile },
): RegistryCommandRunner | null;

export declare function checkRegistryAccessWithGitHubCli(
  options?: CheckRegistryAccessWithGitHubCliOptions,
): Promise<RegistryAccessResult>;
