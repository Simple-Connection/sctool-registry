#!/usr/bin/env node

import { cpSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prepareLocalizationBuildProject } from "../localization/build-localization.mjs";
import { verifyPackageLocalization } from "../localization/verify-package-localization.mjs";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = join(CLI_ROOT, "builder", "sctool-builder.mjs");
const TEMPLATE_ROOT = join(CLI_ROOT, "templates");
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(message);
}

function usage() {
  return `SCTool CLI\n\n` +
    `Commands:\n` +
    `  sctool list [--registry <projects.json>]\n` +
    `  sctool build (--tool <name> [--registry <projects.json>] | --project <sctool.build.json>) --version <semver>\n` +
    `  sctool test (--tool <name> [--registry <projects.json>] | --package <file.sctool>) [--project <sctool.build.json>] [--expected-version <semver>]\n` +
    `  sctool scaffold --template <name> --destination <path> --package-id <id> --display-name <name> --command-name <name> [--module-path <path>]\n\n` +
    `Localization:\n` +
    `  Build configs may declare localization.generator=argos and targetLocales.\n` +
    `  Argos models must already be installed; build never downloads models.\n` +
    `  Set SCTOOL_ARGOS_PYTHON to override the Python executable.\n`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { command: "help", options: {} };
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function readJson(path) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`JSON file not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`Invalid JSON: ${path}\n${error.message}`);
  }
}

function run(file, args, cwd = process.cwd(), capture = false) {
  const result = spawnSync(file, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    windowsHide: true,
  });
  if (result.error) fail(`Unable to execute ${file}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = capture ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim() : "";
    fail(`Command failed (${result.status}): ${file} ${args.join(" ")}${output ? `\n${output}` : ""}`);
  }
  return capture ? result.stdout.trim() : "";
}

function gitRoot(start = process.cwd()) {
  return resolve(run("git", ["-C", resolve(start), "rev-parse", "--show-toplevel"], process.cwd(), true));
}

function pathInside(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  const left = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const right = process.platform === "win32" ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  return right === left || right.startsWith(`${left}${sep}`);
}

function defaultRegistry() {
  let current = resolve(process.cwd());
  while (true) {
    for (const relativePath of ["sctool.projects.json", "tools/sctool_tool/projects.json", ".sctool/projects.json"]) {
      const candidate = join(current, relativePath);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  fail("SCTool registry not found. Pass --registry <projects.json>.");
}

function validateRegistry(registry) {
  if (registry.schemaVersion !== 1) fail(`Unsupported registry schemaVersion: ${registry.schemaVersion}`);
  if (!Array.isArray(registry.projects)) fail("Registry projects must be an array.");
  const names = new Set();
  const packageIds = new Set();
  for (const project of registry.projects) {
    for (const key of ["name", "packageId", "buildConfig", "enabled"]) {
      if (!(key in project)) fail(`Registry project missing ${key}.`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project.name)) fail(`Invalid project name: ${project.name}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.packageId)) fail(`Invalid packageId: ${project.packageId}`);
    const nameKey = project.name.toLowerCase();
    const packageKey = project.packageId.toLowerCase();
    if (names.has(nameKey)) fail(`Duplicate project name: ${project.name}`);
    if (packageIds.has(packageKey)) fail(`Duplicate packageId: ${project.packageId}`);
    names.add(nameKey);
    packageIds.add(packageKey);
  }
}

function readRegistry(registryOption = "") {
  const path = resolve(registryOption || defaultRegistry());
  const value = readJson(path);
  validateRegistry(value);
  return { path, root: dirname(path), projects: value.projects };
}

function resolveProject(options) {
  if (options.project && options.tool) fail("Use either --project or --tool, not both.");
  if (options.project) return resolve(options.project);
  if (!options.tool) fail("Specify --tool or --project.");
  const registry = readRegistry(options.registry);
  const matches = registry.projects.filter((item) =>
    item.name.toLowerCase() === options.tool.toLowerCase() ||
    item.packageId.toLowerCase() === options.tool.toLowerCase());
  if (matches.length === 0) fail(`Unregistered SCTool: ${options.tool}`);
  if (matches.length > 1) fail(`SCTool selection is ambiguous: ${options.tool}`);
  const selected = matches[0];
  if (!selected.enabled) fail(`SCTool project is disabled: ${selected.name}`);
  const projectPath = resolve(registry.root, selected.buildConfig);
  if (!pathInside(registry.root, projectPath)) fail(`buildConfig escapes registry root: ${selected.buildConfig}`);
  if (!existsSync(projectPath)) fail(`Build config not found: ${projectPath}`);
  return projectPath;
}

function expand(value, tokens) {
  let output = String(value);
  for (const [key, tokenValue] of Object.entries(tokens)) output = output.split(`\${${key}}`).join(String(tokenValue));
  return output;
}

function packagePathFor(projectPath, version) {
  if (!version || !SEMVER.test(version)) fail("--expected-version is required with --tool and must be semantic version.");
  const repository = gitRoot(dirname(projectPath));
  const config = readJson(projectPath);
  const projectRoot = isAbsolute(config.projectRoot) ? resolve(config.projectRoot) : resolve(repository, config.projectRoot);
  const tokens = { repoRoot: repository, projectRoot, version };
  const outputDirectory = resolve(repository, expand(config.package.outputDirectory, tokens));
  return join(outputDirectory, `${config.package.id}-${version}-${config.package.target}.sctool`);
}

function delegate(args, cwd) {
  if (!existsSync(BUILDER)) fail(`SCTool builder missing: ${BUILDER}`);
  run(process.execPath, [BUILDER, ...args], cwd);
}

function listCommand(options) {
  const registry = readRegistry(options.registry);
  for (const project of registry.projects) {
    console.log(`${project.enabled ? "enabled " : "disabled"}\t${project.name}\t${project.packageId}\t${project.buildConfig}${project.description ? `\t${project.description}` : ""}`);
  }
}

async function buildCommand(options) {
  if (!options.version || !SEMVER.test(options.version)) fail("build requires --version <semver>.");
  const projectPath = resolveProject(options);
  const prepared = await prepareLocalizationBuildProject(projectPath, options.version);
  try {
    if (prepared.generated) {
      console.log(`Localization generated with Argos: ${prepared.generatedLocales.join(", ")}`);
    }
    delegate(["build", "--project", prepared.projectPath, "--version", options.version], gitRoot(dirname(projectPath)));
    const packagePath = packagePathFor(projectPath, options.version);
    const localization = await verifyPackageLocalization(packagePath);
    if (localization.localized) {
      console.log(`Localization verified: ${localization.locales.join(", ")}`);
    }
  } finally {
    prepared.cleanup();
  }
}

async function testCommand(options) {
  const projectPath = options.project || options.tool ? resolveProject(options) : "";
  const packagePath = options.package ? resolve(options.package) : packagePathFor(projectPath, options["expected-version"]);
  const args = ["test", "--package", packagePath];
  if (projectPath) args.push("--project", projectPath);
  if (options["expected-version"]) args.push("--expected-version", options["expected-version"]);
  delegate(args, projectPath ? gitRoot(dirname(projectPath)) : process.cwd());
  const localization = await verifyPackageLocalization(packagePath);
  if (localization.localized) {
    console.log(`Localization verified: ${localization.locales.join(", ")}`);
  }
}

function replaceTokens(content, tokens) {
  let output = content;
  for (const [key, value] of Object.entries(tokens)) output = output.split(`__${key}__`).join(String(value));
  return output;
}

function walk(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function scaffoldCommand(options) {
  for (const key of ["template", "destination", "package-id", "display-name", "command-name"]) {
    if (!options[key]) fail(`scaffold requires --${key}.`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options["package-id"])) fail("Invalid --package-id.");
  const source = resolve(TEMPLATE_ROOT, options.template);
  if (!pathInside(TEMPLATE_ROOT, source) || !existsSync(source) || !statSync(source).isDirectory()) {
    fail(`Template not found: ${options.template}`);
  }
  const destination = resolve(options.destination);
  if (existsSync(destination)) fail(`Scaffold destination exists: ${destination}`);
  const repository = gitRoot(process.cwd());
  if (!pathInside(repository, destination)) fail(`Scaffold destination must be inside repository root: ${repository}`);
  const relativeDestination = relative(repository, destination).split(sep).join("/");
  const tokens = {
    PACKAGE_ID: options["package-id"],
    DISPLAY_NAME: options["display-name"],
    COMMAND_NAME: options["command-name"],
    MODULE_PATH: options["module-path"] || `example.com/sctool/${options["package-id"]}`,
    DESTINATION: relativeDestination,
  };
  cpSync(source, destination, { recursive: true });
  for (const file of walk(destination)) {
    const content = readFileSync(file, "utf8");
    writeFileSync(file, replaceTokens(content, tokens), "utf8");
  }
  const entries = [...walk(destination).map(dirname), ...walk(destination)]
    .filter((value, index, array) => array.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
  for (const path of entries) {
    const name = path.slice(path.lastIndexOf(sep) + 1);
    const renamed = replaceTokens(name, tokens);
    if (renamed !== name) renameSync(path, join(dirname(path), renamed));
  }
  console.log(`Created SCTool scaffold: ${destination}`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    console.log(usage());
    return;
  }
  if (command === "list") return listCommand(options);
  if (command === "build") return await buildCommand(options);
  if (command === "test") return await testCommand(options);
  if (command === "scaffold") return scaffoldCommand(options);
  fail(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
