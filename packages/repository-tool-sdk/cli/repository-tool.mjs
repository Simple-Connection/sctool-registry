#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isRepositoryToolRuntimeCapable,
  repositoryToolIdentity,
  validateRepositoryToolDescriptorV1,
} from "../dist/index.js";
import { createRepositoryToolPackage } from "../builder/repository-tool-builder.mjs";

function usage() {
  console.error("Usage:");
  console.error("  repository-tool validate <workspace.json>");
  console.error("  repository-tool create <directory> --id <id> --name <name> --version <version>");
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1) return null;
  return args[index + 1];
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function validateCommand(path) {
  const result = validateRepositoryToolDescriptorV1(readJson(path));
  const payload = result.valid && result.descriptor
    ? {
        valid: true,
        identity: repositoryToolIdentity(result.descriptor),
        runtimeCapable: isRepositoryToolRuntimeCapable(result.descriptor),
        issues: [],
      }
    : { valid: false, issues: result.issues };
  console.log(JSON.stringify(payload, null, 2));
  return result.valid ? 0 : 1;
}

function createCommand(args) {
  const target = args[0];
  const id = option(args, "--id");
  const name = option(args, "--name");
  const version = option(args, "--version");
  if (!target || !id || !name || !version) {
    usage();
    return 2;
  }
  const created = createRepositoryToolPackage(target, {
    schemaVersion: 1,
    kind: "tool",
    id,
    name,
    version,
    contentRoot: "content",
  });
  console.log(JSON.stringify({
    created: true,
    targetDirectory: created.targetDirectory,
    identity: repositoryToolIdentity(created.descriptor),
    runtimeCapable: false,
  }, null, 2));
  return 0;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "validate" && args.length === 1) return validateCommand(args[0]);
  if (command === "create") return createCommand(args);
  usage();
  return 2;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
