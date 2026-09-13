import {
  checkRegistryAccess,
  checkRegistryAccessWithGitHubCli,
  sanitizeRegistryGitHubEnvironment,
} from "../src/registry-access.mjs";

let passed = 0;

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

function truthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy value`);
}

function jsonEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected=${e} actual=${a}`);
}

function completed(exitCode = 0, stdout = "", stderr = "") {
  return { kind: "completed", exitCode, stdout, stderr };
}

function sequenceRunner(outcomes, requests = []) {
  return async (request) => {
    requests.push(request);
    const next = outcomes.shift();
    if (!next) throw new Error(`unexpected command: ${request.args.join(" ")}`);
    return next;
  };
}

async function caseRun(label, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${label}`);
}

await caseRun("authenticated identity does not probe artifact repository", async () => {
  const requests = [];
  const result = await checkRegistryAccess({
    runner: sequenceRunner([
      completed(0, "gh version 2.97.0"),
      completed(0),
      completed(0, "Kinirin\n"),
    ], requests),
    environment: { PATH: "safe" },
  });
  jsonEqual(result, {
    state: "authorized",
    identity: { provider: "github.com", login: "Kinirin" },
    authorized: true,
  }, "identity result");
  jsonEqual(requests.map((request) => request.args), [
    ["--version"],
    ["auth", "status", "--hostname", "github.com"],
    ["api", "user", "--jq", ".login"],
  ], "identity command sequence");
  equal(
    requests.some(({ args }) => args.join(" ").includes("repos/Simple-Connection/sctool-artifacts")),
    false,
    "public artifact repository is never permission-probed",
  );
});

await caseRun("missing gh normalizes to gh-unavailable", async () => {
  const result = await checkRegistryAccess({ runner: sequenceRunner([{ kind: "not-found" }]) });
  equal(result.state, "gh-unavailable", "state");
});

await caseRun("failed auth normalizes to unauthenticated", async () => {
  const result = await checkRegistryAccess({ runner: sequenceRunner([completed(), completed(1)]) });
  equal(result.state, "unauthenticated", "state");
});

await caseRun("failed identity lookup normalizes to identity-unresolved", async () => {
  const result = await checkRegistryAccess({
    runner: sequenceRunner([completed(), completed(), completed(1)]),
  });
  equal(result.state, "identity-unresolved", "state");
});

await caseRun("empty identity normalizes to identity-unresolved", async () => {
  const result = await checkRegistryAccess({
    runner: sequenceRunner([completed(), completed(), completed(0, " \n")]),
  });
  equal(result.state, "identity-unresolved", "state");
});

await caseRun("transport and timeout normalize to network-unavailable", async () => {
  for (const failure of [{ kind: "transport-error" }, { kind: "timeout" }]) {
    const result = await checkRegistryAccess({
      runner: sequenceRunner([completed(), completed(), failure]),
    });
    equal(result.state, "network-unavailable", "state");
  }
});

await caseRun("token override names are removed case-insensitively", async () => {
  const sanitized = sanitizeRegistryGitHubEnvironment({
    PATH: "safe",
    GH_TOKEN: "sentinel-one",
    github_token: "sentinel-two",
    Gh_ToKeN: "sentinel-three",
    GH_HOST: "github.com",
  });
  jsonEqual(sanitized, { PATH: "safe", GH_HOST: "github.com" }, "sanitized environment");
});

await caseRun("GitHub identity adapter never probes cache permission or exposes credential material", async () => {
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const signature = args.join(" ");
    if (signature === "--version") callback(null, "gh version 2.97.0\n", "");
    else if (signature === "auth status --hostname github.com") callback(null, "", "");
    else if (signature === "api user --jq .login") callback(null, "Kinirin\n", "");
    else callback({ code: 2 }, "", "unexpected");
  };

  const result = await checkRegistryAccessWithGitHubCli({
    execFileImpl,
    environment: { PATH: "safe", GH_TOKEN: "sentinel-one", GITHUB_TOKEN: "sentinel-two" },
  });
  equal(result.state, "authorized", "state");
  truthy(calls.every(({ options }) => !("GH_TOKEN" in options.env)), "GH_TOKEN stripped");
  truthy(calls.every(({ options }) => !("GITHUB_TOKEN" in options.env)), "GITHUB_TOKEN stripped");
  equal(calls.some(({ args }) => args.join(" ") === "auth token"), false, "auth token not invoked");
  equal(
    calls.some(({ args }) => args.join(" ").includes("repos/Simple-Connection/sctool-artifacts")),
    false,
    "cache permission probe not invoked",
  );
  equal(/sentinel-one|sentinel-two/.test(JSON.stringify(result)), false, "credential material absent");
});

await caseRun("invalid configuration and missing host executor fail closed", async () => {
  let called = false;
  const invalidTimeout = await checkRegistryAccess({
    timeoutMs: 0,
    runner: async () => {
      called = true;
      return completed();
    },
  });
  equal(invalidTimeout.state, "configuration-error", "invalid timeout");
  equal(called, false, "runner not called");
  const noExecutor = await checkRegistryAccessWithGitHubCli();
  equal(noExecutor.state, "configuration-error", "missing executor");
});

console.log(`Registry identity regression PASS cases=${passed}`);
