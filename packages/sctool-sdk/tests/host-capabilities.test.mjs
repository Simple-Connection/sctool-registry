import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defineScToolHostCapabilities,
  validateScToolHostCapabilitiesV1,
} from "../dist/host-capabilities.js";

const canonicalPath = new URL(
  "../capabilities/simple-connection.host-capabilities.json",
  import.meta.url,
);

async function canonicalCapabilities() {
  return JSON.parse(await readFile(canonicalPath, "utf8"));
}

function issueCodes(value) {
  return validateScToolHostCapabilitiesV1(value).map((entry) => entry.code);
}

test("canonical Simple Connection host capabilities are valid", async () => {
  const capabilities = await canonicalCapabilities();
  assert.deepEqual(validateScToolHostCapabilitiesV1(capabilities), []);
  assert.equal(defineScToolHostCapabilities(capabilities), capabilities);
});

test("package entry remains stdio even when the host exposes Streamable HTTP", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.packageEntry.transport = "streamable-http";
  assert.ok(issueCodes(capabilities).includes("package_entry_transport"));
});

test("client-facing transport is distinct from package entry transport", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.clientExposure.transport = "stdio";
  assert.ok(issueCodes(capabilities).includes("client_exposure_transport"));
});

test("bridge must preserve streamable-http client to stdio package semantics", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.bridge.packageTransport = "streamable-http";
  assert.ok(issueCodes(capabilities).includes("bridge_package_transport"));
});

test("Streamable HTTP methods are a set rather than an ordering contract", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.clientExposure.methods = ["DELETE", "POST", "GET"];
  assert.deepEqual(validateScToolHostCapabilitiesV1(capabilities), []);
});

test("duplicate or unsupported Streamable HTTP methods are rejected", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.clientExposure.methods = ["POST", "GET", "GET"];
  assert.ok(issueCodes(capabilities).includes("methods_value"));
});

test("unknown capability fields are rejected", async () => {
  const capabilities = await canonicalCapabilities();
  capabilities.clientExposure.websocket = true;
  assert.ok(issueCodes(capabilities).includes("unknown_client_exposure_field"));
});
