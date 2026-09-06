import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALIZATION_MODULE = join(ROOT, "dist", "localization.js");

function fail(message) {
  throw new Error(message);
}

function run(file, args) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) fail(`Unable to execute ${file}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`Command failed (${result.status}): ${file} ${args.join(" ")}\n${String(result.stderr ?? "").trim()}`);
  }
}

function extractArchive(packagePath, destination) {
  mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    const zipCopy = join(dirname(destination), "package.zip");
    copyFileSync(packagePath, zipCopy);
    try {
      run("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${zipCopy.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`,
      ]);
    } finally {
      rmSync(zipCopy, { force: true });
    }
    return;
  }

  const python = [
    "import sys,zipfile",
    "with zipfile.ZipFile(sys.argv[1],'r') as z: z.extractall(sys.argv[2])",
  ].join("\n");
  run("python3", ["-c", python, packagePath, destination]);
}

function readJson(path, description) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${description} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`${description} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function bundlePath(value) {
  const normalized = String(value).replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    fail(`Localization bundle path must be relative: ${value}`);
  }
  if (normalized.split("/").includes("..")) fail(`Localization bundle path escapes package root: ${value}`);
  return normalized;
}

export async function verifyPackageLocalization(packagePathValue) {
  if (!existsSync(LOCALIZATION_MODULE)) {
    fail(`SCTool localization build output missing: ${LOCALIZATION_MODULE}\nRun: npm --prefix program-sdk/sctool-sdk run build`);
  }
  const sdkLocalization = await import("../dist/localization.js");
  const packagePath = resolve(packagePathValue);
  if (!existsSync(packagePath) || !statSync(packagePath).isFile()) {
    fail(`SCTool package not found: ${packagePath}`);
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "sctool_localization_verify_"));
  const extractPath = join(temporaryRoot, "extract");
  try {
    extractArchive(packagePath, extractPath);
    const manifest = readJson(join(extractPath, "tool.json"), "tool.json");
    if (manifest.localization === undefined) {
      return { localized: false, locales: [] };
    }

    const localizationIssues = sdkLocalization.validateLocalizationV1(manifest.localization);
    if (localizationIssues.length > 0) {
      fail(`Invalid manifest localization contract:\n${localizationIssues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
    }

    const locales = [];
    for (const [locale, relativePath] of Object.entries(manifest.localization.bundles)) {
      const safePath = bundlePath(relativePath);
      const bundle = readJson(join(extractPath, ...safePath.split("/")), `localization bundle ${locale}`);
      const bundleIssues = sdkLocalization.validateLocalizationBundleV1(manifest, bundle, `localization.bundles.${locale}`);
      if (bundleIssues.length > 0) {
        fail(`Invalid localization bundle (${locale}):\n${bundleIssues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
      }
      locales.push(locale);
    }
    return { localized: true, locales };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
