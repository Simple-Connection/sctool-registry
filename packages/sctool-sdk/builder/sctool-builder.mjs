#!/usr/bin/env node

import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  spawn,
  spawnSync,
} from "node:child_process";
import { fileURLToPath } from "node:url";

const BUILDER_VERSION = "1.0.1";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK_MODULE = join(PACKAGE_ROOT, "dist", "index.js");
const SDK_PACKAGE_JSON = join(PACKAGE_ROOT, "package.json");
const TEXT_EXTENSIONS = new Set([
  ".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".ps1", ".psm1", ".ts", ".js", ".mjs", ".go", ".py",
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-(?:proj-)?[0-9A-Za-z_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
];

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || !["build", "test"].includes(command)) {
    fail(
      "Usage:\n" +
      "  node sctool-builder.mjs build --project <sctool.build.json> --version <semver>\n" +
      "  node sctool-builder.mjs test --package <file.sctool> [--project <sctool.build.json>] [--expected-version <semver>]",
    );
  }

  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${name}`);
    options[name] = value;
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(file, args = [], cwd = process.cwd(), environment = {}, options = {}) {
  const result = spawnSync(file, args, {
    cwd,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe",
    windowsHide: true,
  });
  if (result.error) fail(`Unable to execute ${file}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`Command failed (${result.status}): ${file} ${args.join(" ")}${output ? `\n${output}` : ""}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitValue(root, ...args) {
  return run("git", ["-C", root, ...args], root).stdout.trim();
}

function optionalGitValue(root, ...args) {
  const result = run("git", ["-C", root, ...args], root, {}, { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function repositoryRoot(startPath) {
  return resolve(gitValue(startPath, "rev-parse", "--show-toplevel"));
}

function expandTokens(value, tokens) {
  if (value === null || value === undefined) return value;
  let expanded = String(value);
  for (const [key, tokenValue] of Object.entries(tokens)) {
    expanded = expanded.split(`\${${key}}`).join(String(tokenValue));
  }
  return expanded;
}

function isInside(root, path) {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  const comparisonRoot = process.platform === "win32" ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparisonPath = process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
  return comparisonPath === comparisonRoot || comparisonPath.startsWith(`${comparisonRoot}${sep}`);
}

function repositoryPath(root, value, tokens) {
  const expanded = expandTokens(value, tokens);
  const fullPath = isAbsolute(expanded) ? resolve(expanded) : resolve(root, expanded);
  if (!isInside(root, fullPath)) fail(`Repository path escapes root: ${value}`);
  return fullPath;
}

function bundlePath(value) {
  const normalized = String(value).replaceAll("\\", "/").trim();
  if (!normalized || normalized === ".") return normalized;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    fail(`Bundle path must be relative: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) fail(`Bundle path escapes package root: ${value}`);
  return normalized.replace(/^\.\//, "");
}

function relativeBundlePath(root, path) {
  if (!isInside(root, path)) fail(`Path is outside root: ${path}`);
  return relative(root, path).split(sep).join("/");
}

function listFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  if (existsSync(root)) visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function copyAsset(root, stage, asset, tokens) {
  const source = repositoryPath(root, asset.source, tokens);
  const destination = bundlePath(asset.destination);
  const target = join(stage, ...destination.split("/"));
  if (!existsSync(source)) fail(`Bundle asset not found: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  if (statSync(source).isDirectory()) cpSync(source, target, { recursive: true, force: true });
  else copyFileSync(source, target);
}

function requireFile(stage, relativePath, description) {
  const safe = bundlePath(relativePath);
  const fullPath = join(stage, ...safe.split("/"));
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    fail(`${description} not found: ${relativePath}`);
  }
  return fullPath;
}

function requireDirectory(stage, relativePath, description) {
  const safe = bundlePath(relativePath);
  const fullPath = !safe || safe === "." ? stage : join(stage, ...safe.split("/"));
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    fail(`${description} not found: ${relativePath}`);
  }
  return fullPath;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeChecksums(stage, relativePath) {
  const safe = bundlePath(relativePath);
  const target = join(stage, ...safe.split("/"));
  const lines = listFiles(stage)
    .map((path) => ({ path, relative: relativeBundlePath(stage, path) }))
    .filter((entry) => entry.relative !== safe)
    .map((entry) => `${sha256(entry.path)}  ${entry.relative}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join("\n")}\n`, "utf8");
}

function verifyChecksums(stage, relativePath) {
  const safe = bundlePath(relativePath);
  const checksumPath = requireFile(stage, safe, "checksums file");
  const listed = new Set();
  for (const rawLine of readFileSync(checksumPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) fail(`Invalid checksum line: ${rawLine}`);
    const expected = match[1].toLowerCase();
    const relativePathValue = bundlePath(match[2]);
    if (listed.has(relativePathValue)) fail(`Duplicate checksum path: ${relativePathValue}`);
    const actual = sha256(requireFile(stage, relativePathValue, "checksum target"));
    if (actual !== expected) fail(`Checksum mismatch: ${relativePathValue}`);
    listed.add(relativePathValue);
  }

  for (const path of listFiles(stage)) {
    const relativePathValue = relativeBundlePath(stage, path);
    if (relativePathValue !== safe && !listed.has(relativePathValue)) {
      fail(`File missing from checksums: ${relativePathValue}`);
    }
  }
}

function scanSecrets(stage) {
  for (const path of listFiles(stage)) {
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const content = readFileSync(path, "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
      fail(`Potential secret detected: ${relativeBundlePath(stage, path)}`);
    }
  }
}

function validateBuildConfig(config) {
  if (config.schemaVersion !== 1) fail(`Unsupported build schemaVersion: ${config.schemaVersion}`);
  for (const name of ["projectRoot", "package", "build", "bundle"]) {
    if (config[name] === undefined || config[name] === null) fail(`Build config missing: ${name}`);
  }
  for (const name of ["id", "target", "outputDirectory", "manifestTemplate"]) {
    if (!config.package[name]) fail(`Build package missing: ${name}`);
  }
  for (const name of ["adapter", "workingDirectory", "outputPath"]) {
    if (!config.build[name]) fail(`Build section missing: ${name}`);
  }
  if (!["go", "command"].includes(config.build.adapter)) {
    fail(`Unsupported build adapter: ${config.build.adapter}`);
  }
  if (config.build.adapter === "go" && !config.build.entryPackage) {
    fail("Go adapter requires build.entryPackage");
  }
  if (config.build.adapter === "command" && !Array.isArray(config.build.commands)) {
    fail("Command adapter requires build.commands");
  }
  if (!config.bundle.entryCommand || !Array.isArray(config.bundle.assets)) {
    fail("bundle.entryCommand and bundle.assets are required");
  }
}

function readBuildContext(projectPath) {
  const fullProjectPath = resolve(projectPath);
  const root = repositoryRoot(dirname(fullProjectPath));
  const config = readJson(fullProjectPath);
  validateBuildConfig(config);
  return { root, config, projectPath: fullProjectPath };
}

function buildTokens(root, config, version) {
  const sdkPackage = readJson(SDK_PACKAGE_JSON);
  return {
    repoRoot: root,
    projectRoot: repositoryPath(root, config.projectRoot, { repoRoot: root }),
    version,
    gitCommit: gitValue(root, "rev-parse", "HEAD"),
    buildDate: new Date().toISOString(),
    sdkVersion: sdkPackage.version,
    sdkCommit: optionalGitValue(PACKAGE_ROOT, "rev-parse", "HEAD"),
    builderVersion: BUILDER_VERSION,
  };
}

function ensureSdkModule() {
  if (!existsSync(SDK_MODULE)) {
    fail(
      `SCTool SDK build output missing: ${SDK_MODULE}\n` +
      "Run: npm --prefix packages/sctool-sdk run build",
    );
  }
}

function collectGoFiles(path) {
  if (!existsSync(path)) fail(`Go format path not found: ${path}`);
  if (statSync(path).isFile()) return path.endsWith(".go") ? [path] : [];
  return listFiles(path).filter((item) => item.endsWith(".go"));
}

function goBuild(root, build, tokens) {
  const cwd = repositoryPath(root, build.workingDirectory, tokens);
  const unformatted = [];
  for (const value of build.formatPaths ?? []) {
    const expanded = expandTokens(value, tokens);
    const path = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
    for (const goFile of collectGoFiles(path)) {
      const output = run("gofmt", ["-l", goFile], cwd).stdout.trim();
      if (output) unformatted.push(...output.split(/\r?\n/));
    }
  }
  if (unformatted.length > 0) fail(`Go source is not gofmt-clean:\n${unformatted.join("\n")}`);

  const tests = build.testPackages ?? ["./..."];
  if (tests.length > 0) run("go", ["test", ...tests], cwd, {}, { capture: false });

  const outputPath = repositoryPath(root, build.outputPath, tokens);
  mkdirSync(dirname(outputPath), { recursive: true });
  const ldflags = (build.ldflags ?? []).map((value) => expandTokens(value, tokens));
  for (const [name, value] of Object.entries(build.versionVariables ?? {})) {
    ldflags.push(`-X ${name}=${expandTokens(value, tokens)}`);
  }
  const args = ["build"];
  if (build.trimpath === true) args.push("-trimpath");
  if (ldflags.length > 0) args.push("-ldflags", ldflags.join(" "));
  args.push("-o", outputPath, expandTokens(build.entryPackage, tokens));
  run("go", args, cwd, {}, { capture: false });
  if (!existsSync(outputPath)) fail(`Go build output missing: ${outputPath}`);
}

function commandBuild(root, build, tokens) {
  for (const command of build.commands) {
    const cwd = repositoryPath(root, command.workingDirectory ?? build.workingDirectory, tokens);
    const expandedFile = expandTokens(command.file, tokens);
    const file = /[\\/]/.test(expandedFile)
      ? repositoryPath(root, expandedFile, tokens)
      : expandedFile;
    const args = (command.args ?? []).map((value) => expandTokens(value, tokens));
    run(file, args, cwd, {}, { capture: false });
  }
  const outputPath = repositoryPath(root, build.outputPath, tokens);
  if (!existsSync(outputPath) || !statSync(outputPath).isFile()) {
    fail(`Command build output missing: ${outputPath}`);
  }
}

function normalizeManifestSdk(sdk, input) {
  return sdk.defineScTool(input);
}

function createArchive(stage, destination) {
  const zipPath = destination.endsWith(".zip") ? destination : `${destination}.zip`;
  rmSync(zipPath, { force: true });
  mkdirSync(dirname(zipPath), { recursive: true });

  if (process.platform === "win32") {
    const scriptPath = join(mkdtempSync(join(tmpdir(), "sctool_zip_")), "create-archive.ps1");
    const script = `\uFEFFparam([string]$Stage,[string]$Destination)\r\n` +
      `$ErrorActionPreference = 'Stop'\r\n` +
      `Add-Type -AssemblyName System.IO.Compression\r\n` +
      `Add-Type -AssemblyName System.IO.Compression.FileSystem\r\n` +
      `$archive = [System.IO.Compression.ZipFile]::Open($Destination, [System.IO.Compression.ZipArchiveMode]::Create)\r\n` +
      `try {\r\n` +
      `  Get-ChildItem -LiteralPath $Stage -File -Recurse | ForEach-Object {\r\n` +
      `    $relative = $_.FullName.Substring($Stage.Length).TrimStart([char[]]@('\\','/')).Replace('\\','/')\r\n` +
      `    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null\r\n` +
      `  }\r\n` +
      `} finally { $archive.Dispose() }\r\n`;
    writeFileSync(scriptPath, script, "utf8");
    try {
      run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, stage, zipPath], dirname(scriptPath));
    } finally {
      rmSync(dirname(scriptPath), { recursive: true, force: true });
    }
  } else {
    const python = [
      "import os,sys,zipfile",
      "stage,dest=sys.argv[1:3]",
      "with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:",
      "  for root,dirs,files in os.walk(stage):",
      "    dirs.sort(); files.sort()",
      "    for name in files:",
      "      path=os.path.join(root,name)",
      "      arc=os.path.relpath(path,stage).replace(os.sep,'/')",
      "      z.write(path,arc)",
    ].join("\n");
    run("python3", ["-c", python, stage, zipPath]);
  }
  return zipPath;
}

function archiveEntries(packagePath) {
  const python = [
    "import sys,zipfile",
    "with zipfile.ZipFile(sys.argv[1],'r') as z:",
    "  print('\\n'.join(i.filename for i in z.infolist()))",
  ].join("\n");
  if (process.platform !== "win32") {
    return run("python3", ["-c", python, packagePath]).stdout.split(/\r?\n/).filter(Boolean);
  }

  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
    `$a=[System.IO.Compression.ZipFile]::OpenRead('${packagePath.replaceAll("'", "''")}');`,
    "try { $a.Entries | ForEach-Object { $_.FullName } } finally { $a.Dispose() }",
  ].join(" ");
  return run("powershell.exe", ["-NoProfile", "-Command", command]).stdout.split(/\r?\n/).filter(Boolean);
}

function extractArchive(packagePath, destination) {
  mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    const zipCopy = join(dirname(destination), "package.zip");
    copyFileSync(packagePath, zipCopy);
    try {
      run("powershell.exe", [
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
        `Expand-Archive -LiteralPath '${zipCopy.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
      ]);
    } finally {
      rmSync(zipCopy, { force: true });
    }
  } else {
    const python = [
      "import sys,zipfile",
      "with zipfile.ZipFile(sys.argv[1],'r') as z: z.extractall(sys.argv[2])",
    ].join("\n");
    run("python3", ["-c", python, packagePath, destination]);
  }
}

function validateArchiveEntries(packagePath) {
  const entries = archiveEntries(packagePath);
  if (entries.length === 0) fail("SCTool archive is empty");
  for (const entry of entries) {
    if (entry.includes("\\")) fail(`Archive entry uses Windows separator: ${entry}`);
    bundlePath(entry.replace(/\/$/, ""));
  }
}

function readLineWithTimeout(stream, timeoutMs, description) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`${description} timed out`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        cleanup();
        resolvePromise(line);
      }
    };
    const onEnd = () => {
      cleanup();
      rejectPromise(new Error(`${description} ended before a response was received`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off("data", onData);
      stream.off("end", onEnd);
    };
    stream.on("data", onData);
    stream.on("end", onEnd);
  });
}

async function probeMcp(executable, args, cwd, environment, expectedNames, timeoutSeconds) {
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  try {
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "sctool-builder", version: BUILDER_VERSION },
      },
    })}\n`);
    const initializeLine = await readLineWithTimeout(
      child.stdout,
      timeoutSeconds * 1000,
      "MCP initialize",
    );
    const initializeResponse = JSON.parse(initializeLine);
    if (!initializeResponse.result || initializeResponse.error) {
      fail(`MCP initialize failed: ${initializeLine}`);
    }

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    const toolsLine = await readLineWithTimeout(
      child.stdout,
      timeoutSeconds * 1000,
      "MCP tools/list",
    );
    const toolsResponse = JSON.parse(toolsLine);
    if (!Array.isArray(toolsResponse?.result?.tools) || toolsResponse.error) {
      fail(`MCP tools/list failed: ${toolsLine}`);
    }
    const actualNames = new Set(toolsResponse.result.tools.map((tool) => String(tool.name)));
    for (const name of expectedNames) {
      if (!actualNames.has(name)) fail(`MCP tools/list missing manifest tool: ${name}`);
    }
  } finally {
    child.stdin.end();
    const exited = await new Promise((resolvePromise) => {
      const timeout = setTimeout(() => resolvePromise(false), 1000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolvePromise(true);
      });
    });
    if (!exited) child.kill("SIGKILL");
  }
}

async function verifyDirectory({
  sdk,
  root,
  stage,
  config = null,
  tokens = {},
  expectedVersion = "",
}) {
  const manifest = normalizeManifestSdk(sdk, readJson(join(stage, "tool.json")));
  if (expectedVersion && manifest.package.version !== expectedVersion) {
    fail(`Manifest version mismatch: expected ${expectedVersion}, got ${manifest.package.version}`);
  }
  if (!manifest.environment || !Array.isArray(manifest.environment.variables)) {
    fail("SDK-normalized manifest must contain environment.variables");
  }

  const entry = requireFile(stage, manifest.entry.command, "entry.command");
  if (process.platform !== "win32") chmodSync(entry, 0o755);
  const cwd = requireDirectory(stage, manifest.entry.cwd, "entry.cwd");
  const toolNames = new Set();
  for (const tool of manifest.tools ?? []) {
    const name = String(tool?.name ?? "").trim();
    if (!name) fail("tools[].name is required");
    if (toolNames.has(name)) fail(`Duplicate tool name: ${name}`);
    toolNames.add(name);
    if (tool.kind !== undefined && !["read", "write"].includes(tool.kind)) {
      fail(`Invalid tool kind: ${name}`);
    }
    if (tool.inputSchema) {
      const schema = readJson(requireFile(stage, tool.inputSchema, `input schema for ${name}`));
      if (schema.type !== "object") fail(`Tool schema type must be object: ${tool.inputSchema}`);
    }
  }

  if (manifest.policy && typeof manifest.policy === "object") {
    for (const [name, value] of Object.entries(manifest.policy)) {
      if (typeof value === "string") requireFile(stage, value, `policy.${name}`);
    }
  }
  if (manifest.readme) requireFile(stage, manifest.readme, "readme");
  for (const documentPath of manifest.docs ?? []) requireFile(stage, documentPath, "docs entry");
  if (manifest.platform && (!manifest.platform.os || !manifest.platform.arch)) {
    fail("platform.os and platform.arch are required when platform is present");
  }
  if (!manifest.integrity || !manifest.integrity.checksums) {
    fail("integrity.checksums is required by common builder");
  }
  for (const [name, value] of Object.entries(manifest.integrity)) {
    if (typeof value === "string") requireFile(stage, value, `integrity.${name}`);
  }
  verifyChecksums(stage, manifest.integrity.checksums);

  const verification = config?.verification ?? null;
  if (verification?.secretScan !== false) scanSecrets(stage);
  const environment = Object.fromEntries(
    Object.entries(verification?.environment ?? {}).map(([name, value]) => [
      name,
      expandTokens(value, tokens),
    ]),
  );
  const timeoutSeconds = Number(verification?.timeoutSeconds ?? 20);

  if (Array.isArray(verification?.versionArgs)) {
    const versionArgs = verification.versionArgs.map((value) => expandTokens(value, tokens));
    const result = run(entry, versionArgs, cwd, environment);
    if (expectedVersion && !`${result.stdout}\n${result.stderr}`.includes(expectedVersion)) {
      fail(`Version output does not contain ${expectedVersion}`);
    }
  }
  if (verification?.mcpStdio === true) {
    await probeMcp(
      entry,
      manifest.entry.args,
      cwd,
      environment,
      [...toolNames],
      timeoutSeconds,
    );
  }
  return manifest;
}

async function buildPackage(projectPath, version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`Invalid semantic version: ${version}`);
  }
  ensureSdkModule();
  const sdk = await import("../dist/index.js");
  const context = readBuildContext(projectPath);
  const { root, config } = context;
  const tokens = buildTokens(root, config, version);

  console.log(`[1/6] build (${config.build.adapter})`);
  if (config.build.adapter === "go") goBuild(root, config.build, tokens);
  else commandBuild(root, config.build, tokens);

  const outputDirectory = repositoryPath(root, config.package.outputDirectory, tokens);
  const workDirectory = repositoryPath(
    root,
    config.package.workDirectory ?? config.package.outputDirectory,
    tokens,
  );
  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(workDirectory, { recursive: true });
  const stage = join(workDirectory, "_sctool_stage");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  console.log("[2/6] stage assets");
  for (const asset of config.bundle.assets) copyAsset(root, stage, asset, tokens);

  console.log("[3/6] normalize manifest with local SDK");
  const templatePath = repositoryPath(root, config.package.manifestTemplate, tokens);
  const rawManifest = JSON.parse(expandTokens(readFileSync(templatePath, "utf8").replace(/^\uFEFF/, ""), tokens));
  if (rawManifest.package?.id !== config.package.id) {
    fail("Manifest package.id must match build package.id");
  }
  rawManifest.package.version = version;
  const manifest = normalizeManifestSdk(sdk, rawManifest);
  if (bundlePath(manifest.entry.command) !== bundlePath(config.bundle.entryCommand)) {
    fail("Manifest entry.command must match bundle.entryCommand");
  }
  writeJson(join(stage, "tool.json"), manifest);

  writeJson(join(stage, "build-info.json"), {
    schemaVersion: 1,
    packageId: config.package.id,
    packageVersion: version,
    target: config.package.target,
    sourceCommit: tokens.gitCommit,
    buildDate: tokens.buildDate,
    builderVersion: BUILDER_VERSION,
    sdkPackage: "@simple-connection/sctool-sdk",
    sdkVersion: tokens.sdkVersion,
    sdkCommit: tokens.sdkCommit,
  });

  console.log("[4/6] generate checksums");
  if (!manifest.integrity?.checksums) fail("Manifest must define integrity.checksums");
  writeChecksums(stage, manifest.integrity.checksums);

  console.log("[5/6] verify stage");
  await verifyDirectory({ sdk, root, stage, config, tokens, expectedVersion: version });

  console.log("[6/6] compress and re-verify");
  const baseName = `${config.package.id}-${version}-${config.package.target}`;
  const zipPath = join(outputDirectory, `${baseName}.zip`);
  const packagePath = join(outputDirectory, `${baseName}.sctool`);
  rmSync(packagePath, { force: true });
  createArchive(stage, zipPath);
  rmSync(packagePath, { force: true });
  copyFileSync(zipPath, packagePath);
  rmSync(zipPath, { force: true });
  await testPackage(packagePath, projectPath, version, sdk);
  console.log(`Created: ${packagePath}`);
  return packagePath;
}

async function testPackage(packagePathValue, projectPath = "", expectedVersion = "", providedSdk = null) {
  ensureSdkModule();
  const sdk = providedSdk ?? await import("../dist/index.js");
  const packagePath = resolve(packagePathValue);
  if (!existsSync(packagePath) || !statSync(packagePath).isFile()) {
    fail(`SCTool package not found: ${packagePath}`);
  }
  validateArchiveEntries(packagePath);

  let root = process.cwd();
  let config = null;
  let tokens = { repoRoot: root };
  if (projectPath) {
    const context = readBuildContext(projectPath);
    root = context.root;
    config = context.config;
    tokens = buildTokens(root, config, expectedVersion || "0.0.0");
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), `sctool_verify_${randomUUID().replaceAll("-", "")}_`));
  const extractPath = join(temporaryRoot, "extract");
  try {
    extractArchive(packagePath, extractPath);
    await verifyDirectory({
      sdk,
      root,
      stage: extractPath,
      config,
      tokens,
      expectedVersion,
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  console.log(`Verified: ${packagePath}`);
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "build") {
    if (!options.project || !options.version) fail("build requires --project and --version");
    await buildPackage(options.project, options.version);
    return;
  }
  if (!options.package) fail("test requires --package");
  await testPackage(
    options.package,
    options.project ?? "",
    options["expected-version"] ?? "",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
