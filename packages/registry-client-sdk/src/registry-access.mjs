export const REGISTRY_ACCESS_STATES = Object.freeze([
  "authorized",
  "gh-unavailable",
  "unauthenticated",
  "identity-unresolved",
  "access-denied",
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

function httpStatus(outcome) {
  if (outcome?.kind !== "completed") return null;
  const match = `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`.match(/HTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

async function runGh(runner, args, env, timeoutMs) {
  return runner({ command: "gh", args: [...args], env, timeoutMs });
}

export async function checkRegistryAccess({
  runner,
  environment = {},
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  if (typeof runner !== "function") return accessResult("configuration-error");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(artifactRepository)) {
    return accessResult("configuration-error");
  }
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
  const identity = Object.freeze({ provider: "github.com", login });

  const access = await runGh(runner, ["api", `repos/${artifactRepository}`, "--silent"], env, timeoutMs);
  if (isNetworkFailure(access)) return accessResult("network-unavailable", identity);
  if (access?.kind !== "completed") return accessResult("configuration-error", identity);
  if (access.exitCode === 0) return accessResult("authorized", identity);

  const status = httpStatus(access);
  if (status === 401) return accessResult("unauthenticated", identity);
  if (status === 403 || status === 404) return accessResult("access-denied", identity);
  return accessResult("configuration-error", identity);
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
  artifactRepository = DEFAULT_REGISTRY_ARTIFACT_REPOSITORY,
  timeoutMs = DEFAULT_REGISTRY_GITHUB_TIMEOUT_MS,
} = {}) {
  const runner = createGitHubCliCommandRunner({ execFileImpl });
  if (!runner) return accessResult("configuration-error");
  return checkRegistryAccess({ runner, environment, artifactRepository, timeoutMs });
}
