import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SCTOOL_MARKETPLACE_PROFILE_BINDING,
  SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA,
  SCTOOL_MARKETPLACE_PROFILE_SCHEMA_VERSION,
  SCTOOL_SDK_VERSION,
  defineMarketplaceProfile,
  validateMarketplaceProfile,
} from "../dist/marketplace-profile.js";
import { validateScToolManifestV1 } from "../dist/index.js";

const marketContext = {
  usage: "marketplace_submission",
  packageId: "example.tool",
  packageVersion: "1.2.3",
};

function validProfile() {
  return {
    schemaVersion: 1,
    details: "Detailed Marketplace description",
    features: "Feature overview",
  };
}

function codes(profile, context = marketContext) {
  return validateMarketplaceProfile(profile, context).map((entry) => entry.code);
}

test("Marketplace profile JSON schema preserves required and optional section contract", async () => {
  const schema = JSON.parse(
    await readFile(new URL("../schemas/marketplace-profile.schema.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(schema.required, ["schemaVersion", "details", "features"]);
  assert.equal(schema.properties.details.pattern, "\\S");
  assert.equal(schema.properties.features.pattern, "\\S");
  assert.equal(Object.hasOwn(schema.properties, "changelog"), true);
  assert.equal(Object.hasOwn(schema.properties, "dependencies"), true);
  assert.equal(Object.hasOwn(schema.properties, "extension_pack"), true);
  assert.equal(Object.hasOwn(schema.properties, "extensionPack"), false);
});

test("valid required sections pass", () => {
  assert.deepEqual(validateMarketplaceProfile(validProfile(), marketContext), []);
  const profile = validProfile();
  assert.equal(defineMarketplaceProfile(profile), profile);
});

test("missing details fail", () => {
  const profile = validProfile();
  delete profile.details;
  assert.deepEqual(codes(profile), ["MARKETPLACE_PROFILE_DETAILS_REQUIRED"]);
});

test("blank details fail", () => {
  const profile = validProfile();
  profile.details = "   ";
  assert.deepEqual(codes(profile), ["MARKETPLACE_PROFILE_DETAILS_REQUIRED"]);
});

test("missing features fail", () => {
  const profile = validProfile();
  delete profile.features;
  assert.deepEqual(codes(profile), ["MARKETPLACE_PROFILE_FEATURES_REQUIRED"]);
});

test("blank features fail", () => {
  const profile = validProfile();
  profile.features = "\n\t";
  assert.deepEqual(codes(profile), ["MARKETPLACE_PROFILE_FEATURES_REQUIRED"]);
});

test("optional sections absent pass", () => {
  assert.deepEqual(validateMarketplaceProfile(validProfile(), marketContext), []);
});

test("optional sections present pass", () => {
  const profile = {
    ...validProfile(),
    changelog: "1.2.3 changes",
    dependencies: "No external runtime dependencies",
    extension_pack: "No extension pack",
  };
  assert.deepEqual(validateMarketplaceProfile(profile, marketContext), []);
});

test("personal GitHub flows keep Marketplace profile optional", () => {
  for (const usage of ["personal_github_sync", "personal_github_storage"]) {
    assert.deepEqual(validateMarketplaceProfile(undefined, { usage }), []);
  }
});

test("local flows keep Marketplace profile optional", () => {
  for (const usage of ["local_development", "local_storage"]) {
    assert.deepEqual(validateMarketplaceProfile(undefined, { usage }), []);
  }
});

test("Marketplace submission requires a profile", () => {
  const diagnostics = validateMarketplaceProfile(undefined, marketContext);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "MARKETPLACE_PROFILE_REQUIRED");
  assert.equal(diagnostics[0].path, "marketplaceProfile");
});

test("diagnostics have stable code, path, repair hint, schema, and SDK version", () => {
  const diagnostics = validateMarketplaceProfile({ schemaVersion: 1, details: "", features: "" }, marketContext);
  assert.deepEqual(
    diagnostics.map((entry) => ({
      schema: entry.schema,
      code: entry.code,
      path: entry.path,
      repair_hint: entry.repair_hint,
      sdk_version: entry.sdk_version,
      profile_schema_version: entry.profile_schema_version,
    })),
    [
      {
        schema: SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA,
        code: "MARKETPLACE_PROFILE_DETAILS_REQUIRED",
        path: "marketplaceProfile.details",
        repair_hint: "SET_DETAILS_NON_EMPTY",
        sdk_version: SCTOOL_SDK_VERSION,
        profile_schema_version: SCTOOL_MARKETPLACE_PROFILE_SCHEMA_VERSION,
      },
      {
        schema: SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA,
        code: "MARKETPLACE_PROFILE_FEATURES_REQUIRED",
        path: "marketplaceProfile.features",
        repair_hint: "SET_FEATURES_NON_EMPTY",
        sdk_version: SCTOOL_SDK_VERSION,
        profile_schema_version: SCTOOL_MARKETPLACE_PROFILE_SCHEMA_VERSION,
      },
    ],
  );
});

test("diagnostics exclude raw secret-bearing input", () => {
  const sentinel = "SUPER_SECRET_VALUE_42";
  const diagnostics = validateMarketplaceProfile(
    {
      schemaVersion: 1,
      details: { token: sentinel, private_key: sentinel },
      features: null,
      credential: sentinel,
    },
    marketContext,
  );
  const encoded = JSON.stringify(diagnostics);
  assert.equal(encoded.includes(sentinel), false);
  assert.equal(encoded.includes("private_key"), false);
  assert.equal(encoded.includes("credential"), false);
  assert.equal(encoded.includes("token"), false);
});

test("binding contract stays .sctool embedded-or-exact", () => {
  assert.deepEqual(SCTOOL_MARKETPLACE_PROFILE_BINDING, {
    artifact: ".sctool",
    rule: "embedded_or_exactly_bound",
  });
});

test("existing 0.1.0 manifest authoring behavior remains valid", () => {
  const manifest = {
    schemaVersion: 1,
    package: {
      id: "example.tool",
      name: "Example Tool",
      version: "1.0.0",
    },
    entry: {
      type: "mcp-server",
      transport: "stdio",
      command: "bin/server",
      args: [],
      cwd: ".",
    },
  };
  assert.deepEqual(validateScToolManifestV1(manifest), []);
});
