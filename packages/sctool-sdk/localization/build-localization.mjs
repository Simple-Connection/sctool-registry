import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALIZATION_MODULE = join(ROOT, "dist", "localization.js");
const ARGOS_ADAPTER = join(ROOT, "localization", "argos-adapter.py");

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`JSON file not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runGit(start, ...args) {
  const result = spawnSync("git", ["-C", start, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    fail(`Unable to resolve Git repository from ${start}`);
  }
  return result.stdout.trim();
}

function expand(value, tokens) {
  let output = String(value);
  for (const [key, tokenValue] of Object.entries(tokens)) {
    output = output.split(`\${${key}}`).join(String(tokenValue));
  }
  return output;
}

function pythonCandidates() {
  const configured = process.env.SCTOOL_ARGOS_PYTHON?.trim();
  if (configured) return [{ file: configured, prefix: ["-X", "utf8"] }];
  return process.platform === "win32"
    ? [
        { file: "python", prefix: ["-X", "utf8"] },
        { file: "py", prefix: ["-3", "-X", "utf8"] },
      ]
    : [
        { file: "python3", prefix: ["-X", "utf8"] },
        { file: "python", prefix: ["-X", "utf8"] },
      ];
}

function parseAdapterOutput(result, sourceLocale, targetLocale) {
  const stdout = String(result.stdout ?? "").trim();
  let payload = null;
  if (stdout) {
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    try {
      payload = JSON.parse(lines.at(-1));
    } catch {
      payload = null;
    }
  }
  if (payload?.ok === true && payload.translations && typeof payload.translations === "object") {
    return payload.translations;
  }
  const code = payload?.code || "ARGOS_EXECUTION_FAILED";
  const detail = payload?.detail || String(result.stderr ?? "").trim() || `exit=${result.status}`;
  fail(`[${code}] Argos localization ${sourceLocale}->${targetLocale}: ${detail}`);
}

function runArgos(sourceLocale, targetLocale, items) {
  if (!existsSync(ARGOS_ADAPTER)) fail(`Argos adapter missing: ${ARGOS_ADAPTER}`);
  let lastMissing = null;
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(
      candidate.file,
      [...candidate.prefix, ARGOS_ADAPTER, "--source", sourceLocale, "--target", targetLocale],
      {
        encoding: "utf8",
        input: JSON.stringify({ items }),
        windowsHide: true,
      },
    );
    if (result.error?.code === "ENOENT") {
      lastMissing = candidate.file;
      continue;
    }
    if (result.error) {
      fail(`[ARGOS_PYTHON_EXECUTION_FAILED] ${candidate.file}: ${result.error.message}`);
    }
    return parseAdapterOutput(result, sourceLocale, targetLocale);
  }
  fail(`[ARGOS_PYTHON_MISSING] Python executable not found${lastMissing ? `: ${lastMissing}` : ""}. Set SCTOOL_ARGOS_PYTHON if needed.`);
}

function normalizeLocale(value) {
  return String(value).trim().replaceAll("_", "-").toLowerCase();
}

export async function prepareLocalizationBuildProject(projectPathValue, version) {
  const projectPath = resolve(projectPathValue);
  const config = readJson(projectPath);
  const localizationBuild = config.localization;
  if (!localizationBuild) {
    return { projectPath, generated: false, cleanup() {} };
  }

  if (localizationBuild.generator !== "argos") {
    fail(`Unsupported localization generator: ${localizationBuild.generator}`);
  }
  if (!Array.isArray(localizationBuild.targetLocales) || localizationBuild.targetLocales.length === 0) {
    fail("localization.targetLocales must be a non-empty array");
  }
  if (!existsSync(LOCALIZATION_MODULE)) {
    fail(`SCTool localization build output missing: ${LOCALIZATION_MODULE}\nRun: npm --prefix program-sdk/sctool-sdk run build`);
  }

  const sdkLocalization = await import("../dist/localization.js");
  const repoRoot = resolve(runGit(dirname(projectPath), "rev-parse", "--show-toplevel"));
  const projectRoot = isAbsolute(config.projectRoot)
    ? resolve(config.projectRoot)
    : resolve(repoRoot, config.projectRoot);
  const tokens = {
    repoRoot,
    projectRoot,
    version,
    gitCommit: runGit(repoRoot, "rev-parse", "HEAD"),
    buildDate: new Date().toISOString(),
  };
  const manifestTemplate = isAbsolute(expand(config.package.manifestTemplate, tokens))
    ? resolve(expand(config.package.manifestTemplate, tokens))
    : resolve(repoRoot, expand(config.package.manifestTemplate, tokens));
  const manifest = JSON.parse(expand(readFileSync(manifestTemplate, "utf8").replace(/^\uFEFF/, ""), tokens));
  if (!manifest.package || typeof manifest.package !== "object" || Array.isArray(manifest.package)) {
    fail("[LOCALIZATION_CANONICAL_PACKAGE_REQUIRED] localized SCTool manifest must declare a canonical package object");
  }
  manifest.package.version = version;

  const localizationIssues = sdkLocalization.validateLocalizationV1(manifest.localization);
  if (localizationIssues.length > 0) {
    fail(`Invalid manifest localization contract:\n${localizationIssues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
  }
  const localization = manifest.localization;
  const sourceLocale = localization.sourceLocale;
  const bundleEntries = new Map(
    Object.entries(localization.bundles).map(([locale, path]) => [normalizeLocale(locale), { locale, path }]),
  );
  const requested = localizationBuild.targetLocales.map((locale) => String(locale));
  const seen = new Set();
  for (const locale of requested) {
    const normalized = normalizeLocale(locale);
    if (seen.has(normalized)) fail(`Duplicate localization target: ${locale}`);
    seen.add(normalized);
    if (normalized === normalizeLocale(sourceLocale)) {
      fail(`sourceLocale must not be generated as a bundle: ${locale}`);
    }
    if (!bundleEntries.has(normalized)) {
      fail(`localization target is not declared in manifest.localization.bundles: ${locale}`);
    }
  }

  const items = sdkLocalization.extractTranslatableMetadataV1(manifest);
  const temporaryRoot = mkdtempSync(join(dirname(projectPath), `.sctool-localization-${randomUUID().slice(0, 8)}-`));
  const generatedAssets = [];
  try {
    for (const locale of requested) {
      const declared = bundleEntries.get(normalizeLocale(locale));
      const translations = runArgos(sourceLocale, declared.locale, items);
      const bundleIssues = sdkLocalization.validateLocalizationBundleV1(manifest, translations);
      if (bundleIssues.length > 0) {
        fail(`Generated localization bundle is invalid (${declared.locale}):\n${bundleIssues.map((item) => `${item.path}: ${item.message}`).join("\n")}`);
      }
      const sourcePath = join(temporaryRoot, `${normalizeLocale(declared.locale)}.json`);
      writeJson(sourcePath, translations);
      generatedAssets.push({ source: sourcePath, destination: declared.path });
    }

    const destinations = new Set((config.bundle?.assets ?? []).map((asset) => String(asset.destination).replaceAll("\\", "/").toLowerCase()));
    for (const asset of generatedAssets) {
      const destination = String(asset.destination).replaceAll("\\", "/").toLowerCase();
      if (destinations.has(destination)) {
        fail(`Generated localization bundle destination collides with bundle.assets: ${asset.destination}`);
      }
      destinations.add(destination);
    }

    const prepared = {
      ...config,
      bundle: {
        ...config.bundle,
        assets: [...config.bundle.assets, ...generatedAssets],
      },
    };
    delete prepared.localization;
    const temporaryProjectPath = join(temporaryRoot, "sctool.localized.build.json");
    writeJson(temporaryProjectPath, prepared);
    return {
      projectPath: temporaryProjectPath,
      generated: true,
      generatedLocales: requested,
      cleanup() {
        rmSync(temporaryRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
