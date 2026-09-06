import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  RepositoryToolValidationError,
  assertRepositoryToolIdentityMatch,
  defineRepositoryTool,
  isRepositoryToolRuntimeCapable,
  repositoryToolIdentity,
  validateRepositoryToolDescriptorV1,
} from "../dist/index.js";
import { createRepositoryToolPackage } from "../builder/repository-tool-builder.mjs";

function validDescriptor() {
  return {
    schemaVersion: 1,
    kind: "tool",
    id: "demo-tool",
    name: "Demo Tool",
    version: "1.0.0",
    contentRoot: "content",
    mcp: {
      profileId: "workspace/demo-tool",
      title: "Demo Tool",
      entrypoint: {
        command: "node",
        path: "{{package_root}}/content/server.mjs",
        args: ["{{package_root}}/content/server.mjs"],
        cwd: "{{package_root}}",
      },
      env: { MODE: "demo" },
      toolGroups: { default: ["demo.echo"] },
      tools: ["demo.echo"],
      docs: ["content/README.md"],
    },
  };
}

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
}

function issueCodes(result) {
  return new Set(result.issues.map((issue) => issue.code));
}

test("valid descriptor normalizes deterministically and exposes canonical identity", () => {
  const descriptor = defineRepositoryTool({ ...validDescriptor(), ignoredFutureField: true });
  assert.equal(descriptor.id, "demo-tool");
  assert.equal(Object.hasOwn(descriptor, "ignoredFutureField"), false);
  assert.equal(repositoryToolIdentity(descriptor), "tool:demo-tool@1.0.0");
  assert.equal(isRepositoryToolRuntimeCapable(descriptor), true);
});

test("descriptor without mcp remains structurally valid but is not runtime-capable", () => {
  const result = validateRepositoryToolDescriptorV1({
    schemaVersion: 1,
    kind: "tool",
    id: "metadata-only",
    name: "Metadata Only",
    version: "rev_1",
    contentRoot: "content",
  });
  assert.equal(result.valid, true);
  assert.equal(isRepositoryToolRuntimeCapable(result.descriptor), false);
});

test("metadata-only fixture remains valid and non-runtime-capable", () => {
  const result = validateRepositoryToolDescriptorV1(fixture("metadata-only.workspace.json"));
  assert.equal(result.valid, true);
  assert.equal(repositoryToolIdentity(result.descriptor), "tool:fixture-metadata@rev_1");
  assert.equal(isRepositoryToolRuntimeCapable(result.descriptor), false);
});

test("runtime fixture remains valid and runtime-capable", () => {
  const result = validateRepositoryToolDescriptorV1(fixture("runtime.workspace.json"));
  assert.equal(result.valid, true);
  assert.equal(repositoryToolIdentity(result.descriptor), "tool:fixture-runtime@1.0.0");
  assert.equal(isRepositoryToolRuntimeCapable(result.descriptor), true);
});

test("invalid secret environment fixture remains rejected", () => {
  const result = validateRepositoryToolDescriptorV1(fixture("invalid-secret-env.workspace.json"));
  assert.equal(result.valid, false);
  assert.equal(issueCodes(result).has("RTD_MCP_ENV_SECRET_KEY"), true);
});

test("invalid id and version return structured diagnostics", () => {
  const result = validateRepositoryToolDescriptorV1({
    ...validDescriptor(),
    id: "../bad",
    version: "../1",
  });
  assert.equal(result.valid, false);
  const codes = issueCodes(result);
  assert.equal(codes.has("RTD_ID_INVALID"), true);
  assert.equal(codes.has("RTD_VERSION_INVALID"), true);
});

test("invalid entry paths and placeholders return structured diagnostics", () => {
  const descriptor = validDescriptor();
  descriptor.mcp.entrypoint.path = "C:\\outside\\server.mjs";
  descriptor.mcp.entrypoint.cwd = "{{repo_root}}";
  descriptor.mcp.docs = ["../README.md"];
  const result = validateRepositoryToolDescriptorV1(descriptor);
  assert.equal(result.valid, false);
  const codes = issueCodes(result);
  assert.equal(codes.has("RTD_PATH_INVALID"), true);
  assert.equal(codes.has("RTD_PLACEHOLDER_UNSUPPORTED"), true);
});

test("secret-sensitive environment keys are rejected", () => {
  const descriptor = validDescriptor();
  descriptor.mcp.env = { API_TOKEN: "must-not-live-here" };
  const result = validateRepositoryToolDescriptorV1(descriptor);
  assert.equal(result.valid, false);
  assert.equal(issueCodes(result).has("RTD_MCP_ENV_SECRET_KEY"), true);
});

test("discovery identity must match validated descriptor identity", () => {
  const descriptor = validDescriptor();
  assert.doesNotThrow(() =>
    assertRepositoryToolIdentityMatch({ kind: "tool", id: "demo-tool", version: "1.0.0" }, descriptor),
  );
  assert.throws(
    () => assertRepositoryToolIdentityMatch({ kind: "tool", id: "other", version: "1.0.0" }, descriptor),
    (error) => error instanceof RepositoryToolValidationError &&
      error.issues.some((issue) => issue.code === "RTD_IDENTITY_ID_MISMATCH"),
  );
});

test("builder creates canonical workspace.json plus content root", () => {
  const root = mkdtempSync(join(tmpdir(), "repository-tool-sdk-"));
  const target = join(root, "demo-tool");
  try {
    const created = createRepositoryToolPackage(target, {
      schemaVersion: 1,
      kind: "tool",
      id: "demo-tool",
      name: "Demo Tool",
      version: "1.0.0",
      contentRoot: "content",
    });
    assert.equal(repositoryToolIdentity(created.descriptor), "tool:demo-tool@1.0.0");
    const stored = JSON.parse(readFileSync(join(target, "workspace.json"), "utf8"));
    assert.equal(stored.kind, "tool");
    assert.equal(stored.id, "demo-tool");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
