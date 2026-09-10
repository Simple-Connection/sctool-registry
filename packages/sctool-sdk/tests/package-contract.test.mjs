import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageRoot = new URL("../", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, packageRoot), "utf8"));
}

test("package metadata exposes Marketplace profile authoring surface", async () => {
  const packageJson = await readJson("package.json");
  const lockJson = await readJson("package-lock.json");

  assert.equal(packageJson.version, "0.2.0");
  assert.equal(lockJson.version, "0.2.0");
  assert.equal(lockJson.packages[""].version, "0.2.0");

  assert.deepEqual(packageJson.exports["./marketplace-profile"], {
    types: "./dist/marketplace-profile.d.ts",
    import: "./dist/marketplace-profile.js",
  });
  assert.equal(
    packageJson.exports["./marketplace-profile-schema"],
    "./schemas/marketplace-profile.schema.json",
  );
  assert.equal(
    packageJson.exports["./marketplace-profile-template"],
    "./templates/marketplace-profile.json",
  );

  assert.match(
    require.resolve("@simple-connection/sctool-sdk/marketplace-profile"),
    /dist[\\/]marketplace-profile\.js$/,
  );
  assert.match(
    require.resolve("@simple-connection/sctool-sdk/marketplace-profile-schema"),
    /schemas[\\/]marketplace-profile\.schema\.json$/,
  );
  assert.match(
    require.resolve("@simple-connection/sctool-sdk/marketplace-profile-template"),
    /templates[\\/]marketplace-profile\.json$/,
  );
});

test("npm pack dry-run contains Marketplace profile public artifacts", () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["pack", "--dry-run", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  const files = new Set(payload[0].files.map((entry) => entry.path));
  for (const expected of [
    "dist/marketplace-profile.js",
    "dist/marketplace-profile.d.ts",
    "schemas/marketplace-profile.schema.json",
    "templates/marketplace-profile.json",
  ]) {
    assert.equal(files.has(expected), true, `missing packed file: ${expected}`);
  }
});
