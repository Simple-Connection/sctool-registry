export const REGISTRY_ACCESS_STATES = Object.freeze([
  "authorized",
  "gh-unavailable",
  "unauthenticated",
  "identity-unresolved",
  "network-unavailable",
  "configuration-error",
]);

export const DEFAULT_REGISTRY_ARTIFACT_REPOSITORY = "Simple-Connection/sctool-artifacts";
export const DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS = 10_000;

const TOKEN_OVERRIDE_NAMES = new Set(["gh_token", "github_token"]);
const NETWORK_ERROR_MARKERS = Object.freeze([
  "could not resolve host",
  "connection refused",
  "connection reset",
  "failed to connect",
  "network is unreachable",
  "no such host",
  "temporary failure in name resolution",
  "timed out",
  "timeout",
  "tls handshake timeout",
]);

export function sanitizeRegistryGitHubEnvironment(environment = {}) {
  const sanitized = {};
  for (const [name, value] of Object.entries(environment)) {
    if (TOKEN_OVERRIDE_NAMES.has(name.toLowerCase())) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

function accessResult(state, identity = null) {
  return Object.freeze({
    state,
    identity,
    authorized: state === "authorized",
  });
}

function isNetworkFailure(outcome) {
  if (outcome?.kind === "timeout" || outcome?.kind === "transport-error") return true;
  if (outcome?.kind !== "completed" || outcome.exitCode === 0) return false;
  const diagnostic = `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`.toLowerCase();
  if (/http\s+5\d\d\b/.test(diagnostic)) return true;
  return NETWORK_ERROR_MARKERS.some((marker) => diagnostic.includes(marker));
}

async function runGh(runner, args, env, timeoutMs) {
  return runner({ command: "gh", args: [...args], env, timeoutMs });
}

/**
 * Resolve the optional GitHub identity used by Simple Connection user flows.
 *
 * Public SCTool cache retrieval does not depend on this function and does not
 * require repository collaborator/read permission.
 */
export async function checkRegistryAccess({
  runner,
  environment = {},
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  if (typeof runner !== "function") return accessResult("configuration-error");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return accessResult("configuration-error");
  }

  const env = sanitizeRegistryGitHubEnvironment(environment);

  const version = await runGh(runner, ["--version"], env, timeoutMs);
  if (version?.kind === "not-found") return accessResult("gh-unavailable");
  if (isNetworkFailure(version)) return accessResult("network-unavailable");
  if (version?.kind !== "completed" || version.exitCode !== 0) {
    return accessResult("gh-unavailable");
  }

  const auth = await runGh(runner, ["auth", "status", "--hostname", "github.com"], env, timeoutMs);
  if (auth?.kind === "not-found") return accessResult("gh-unavailable");
  if (isNetworkFailure(auth)) return accessResult("network-unavailable");
  if (auth?.kind !== "completed" || auth.exitCode !== 0) {
    return accessResult("unauthenticated");
  }

  const user = await runGh(runner, ["api", "user", "--jq", ".login"], env, timeoutMs);
  if (isNetworkFailure(user)) return accessResult("network-unavailable");
  if (user?.kind !== "completed" || user.exitCode !== 0) {
    return accessResult("identity-unresolved");
  }

  const login = String(user.stdout ?? "").trim();
  if (!login) return accessResult("identity-unresolved");

  return accessResult("authorized", Object.freeze({
    provider: "github.com",
    login,
  }));
}

export function createGitHubCliCommandRunner({ execFileImpl } = {}) {
  if (typeof execFileImpl !== "function") return null;
  return ({ command, args, env, timeoutMs }) =>
    new Promise((resolve) => {
      execFileImpl(
        command,
        [...args],
        {
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024,
        },
        (error, stdout = "", stderr = "") => {
          if (!error) {
            resolve({ kind: "completed", exitCode: 0, stdout, stderr });
            return;
          }
          if (error.code === "ENOENT") {
            resolve({ kind: "not-found" });
            return;
          }
          if (error.killed || error.code === "ETIMEDOUT") {
            resolve({ kind: "timeout" });
            return;
          }
          if (typeof error.code === "number") {
            resolve({ kind: "completed", exitCode: error.code, stdout, stderr });
            return;
          }
          resolve({ kind: "transport-error" });
        },
      );
    });
}

export async function checkRegistryAccessWithGitHubCli({
  execFileImpl,
  environment = globalThis.process?.env ?? {},
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  if (!runner) return accessResult("configuration-error");
  return checkRegistryAccess({ runner, environment, timeoutMs });
}
