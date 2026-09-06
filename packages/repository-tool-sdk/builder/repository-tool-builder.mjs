import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeRepositoryToolDescriptorV1 } from "../dist/index.js";

export const REPOSITORY_TOOL_MANIFEST_FILE = "workspace.json";

export function createRepositoryToolPackage(targetDirectory, descriptorValue) {
  const target = resolve(String(targetDirectory));
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`Repository Tool target directory must be empty: ${target}`);
  }
  const descriptor = normalizeRepositoryToolDescriptorV1(descriptorValue);
  mkdirSync(resolve(target, descriptor.contentRoot), { recursive: true });
  writeFileSync(
    resolve(target, REPOSITORY_TOOL_MANIFEST_FILE),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    "utf8",
  );
  return { targetDirectory: target, descriptor };
}
