import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REGISTRY_CLIENT_CONTRACT,
  REGISTRY_CLIENT_SDK_VERSION,
  REGISTRY_DISCOVERY_CONTRACT,
  discoverVerifiedRegistry,
} from "../src/index.mjs";

const packageRoot = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, packageRoot), "utf8"));
}

test("package metadata publishes additive discovery surface at 0.2.0", async () => {
  const packageJson = await readJson("package.json");
  assert.equal(packageJson.version, "0.2.0");
  assert.deepEqual(packageJson.exports["./discovery"], {
    types: "./src/discovery.d.mts",
    import: "./src/discovery.mjs",
  });
  assert.equal(REGISTRY_CLIENT_SDK_VERSION, "0.2.0");
  assert.equal(REGISTRY_CLIENT_CONTRACT.discoveryContract, "registry-discovery-v1");
  assert.equal(REGISTRY_DISCOVERY_CONTRACT, "registry-discovery-v1");
  assert.equal(typeof discoverVerifiedRegistry, "function");
  assert.match(
    import.meta.resolve("@simple-connection/sctool-registry-client-sdk/discovery"),
    /src[\\/]discovery\.mjs$/,
  );
});

test("Registry Client SDK has no Authoring SDK runtime dependency", async () => {
  const packageJson = await readJson("package.json");
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
  };
  assert.equal(Object.prototype.hasOwnProperty.call(dependencies, "@simple-connection/sctool-sdk"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dependencies, "@simple-connection/repository-tool-sdk"), false);
});

test("npm pack dry-run contains discovery implementation and type declaration", () => {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = windows
    ? ["/d", "/s", "/c", "npm pack --dry-run --json"]
    : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const files = new Set(payload[0].files.map((entry) => entry.path));
  assert.equal(files.has("src/discovery.mjs"), true);
  assert.equal(files.has("src/discovery.d.mts"), true);
});
