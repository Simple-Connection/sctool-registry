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

await caseRun("authorized identity and exact repository read", async () => {
  const requests = [];
  const result = await checkRegistryAccess({
    runner: sequenceRunner([
      completed(0, "gh version 2.97.0"),
      completed(0),
      completed(0, "Kinirin\n"),
      completed(0),
    ], requests),
    environment: { PATH: "safe" },
  });
  jsonEqual(result, {
    state: "authorized",
    identity: { provider: "github.com", login: "Kinirin" },
    authorized: true,
  }, "authorized result");
  jsonEqual(requests.map((request) => request.args), [
    ["--version"],
    ["auth", "status", "--hostname", "github.com"],
    ["api", "user", "--jq", ".login"],
    ["api", "repos/Simple-Connection/sctool-artifacts", "--silent"],
  ], "command sequence");
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

await caseRun("repository 403 normalizes to access-denied", async () => {
  const result = await checkRegistryAccess({
    runner: sequenceRunner([
      completed(), completed(), completed(0, "Kinirin\n"),
      completed(1, "", "gh: Forbidden (HTTP 403)"),
    ]),
  });
  equal(result.state, "access-denied", "state");
  equal(result.identity?.login, "Kinirin", "identity");
});

await caseRun("repository 404 normalizes to access-denied", async () => {
  const result = await checkRegistryAccess({
    runner: sequenceRunner([
      completed(), completed(), completed(0, "Kinirin\n"),
      completed(1, "", "gh: Not Found (HTTP 404)"),
    ]),
  });
  equal(result.state, "access-denied", "state");
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
    GH_TOKEN: "secret-one",
    github_token: "secret-two",
    Gh_ToKeN: "secret-three",
    GH_HOST: "github.com",
  });
  jsonEqual(sanitized, { PATH: "safe", GH_HOST: "github.com" }, "sanitized environment");
});

await caseRun("injected GitHub CLI adapter never invokes auth token or leaks credentials", async () => {
  const calls = [];
  const secretOne = "sentinel-gh-token";
  const secretTwo = "sentinel-github-token";
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const signature = args.join(" ");
    if (signature === "--version") callback(null, "gh version 2.97.0\n", "");
    else if (signature === "auth status --hostname github.com") callback(null, "", "");
    else if (signature === "api user --jq .login") callback(null, "Kinirin\n", "");
    else if (signature === "api repos/Simple-Connection/sctool-artifacts --silent") callback(null, "", "");
    else callback({ code: 2 }, "", "unexpected");
  };

  const result = await checkRegistryAccessWithGitHubCli({
    execFileImpl,
    environment: { PATH: "safe", GH_TOKEN: secretOne, GITHUB_TOKEN: secretTwo },
  });
  equal(result.state, "authorized", "state");
  truthy(calls.every(({ options }) => !("GH_TOKEN" in options.env)), "GH_TOKEN stripped");
  truthy(calls.every(({ options }) => !("GITHUB_TOKEN" in options.env)), "GITHUB_TOKEN stripped");
  truthy(calls.every(({ args }) => args.join(" ") !== "auth token"), "auth token not invoked");
  const serialized = JSON.stringify(result);
  equal(serialized.includes(secretOne), false, "GH secret absent");
  equal(serialized.includes(secretTwo), false, "GITHUB secret absent");
  equal(/token|credential|privateKey/i.test(serialized), false, "credential fields absent");
});

await caseRun("invalid configuration and missing host executor fail closed", async () => {
  let called = false;
  const invalidRepo = await checkRegistryAccess({
    artifactRepository: "not-a-repository",
    runner: async () => {
      called = true;
      return completed();
    },
  });
  equal(invalidRepo.state, "configuration-error", "invalid repository");
  equal(called, false, "runner not called");
  const noExecutor = await checkRegistryAccessWithGitHubCli();
  equal(noExecutor.state, "configuration-error", "missing executor");
});

console.log(`Registry access regression PASS cases=${passed}`);
