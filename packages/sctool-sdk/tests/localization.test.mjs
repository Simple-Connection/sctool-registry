import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyLocalizationBundleV1,
  extractTranslatableMetadataV1,
  resolveLocalizationLocaleV1,
  validateLocalizationBundleV1,
  validateLocalizationV1,
} from "../dist/localization.js";

const manifest = {
  schemaVersion: 1,
  package: {
    id: "i18n",
    name: "I18n",
    version: "0.1.0",
    description: "Translation MCP server",
  },
  entry: {
    type: "mcp-server",
    transport: "stdio",
    command: "bin/i18n.exe",
    args: [],
    cwd: ".",
  },
  environment: {
    variables: [
      {
        name: "YOUR_API_KEY",
        label: "Google Cloud Translation API Key",
        description: "Optional API key used only when new translations are needed.",
        valueType: "string",
        required: false,
        secret: true,
        default: null,
      },
    ],
  },
  tools: [
    {
      name: "i18n_translate",
      kind: "read",
      description: "Translate display text.",
      inputSchema: "schemas/read/i18n_translate.schema.json",
    },
  ],
  localization: {
    sourceLocale: "en",
    bundles: {
      ko: "locales/ko.json",
      ja: "locales/ja.json",
    },
  },
};

test("extracts only allowlisted user-visible metadata", () => {
  const entries = extractTranslatableMetadataV1(manifest);
  const keys = entries.map((entry) => entry.key);
  assert.deepEqual(keys, [
    "environment.YOUR_API_KEY.description",
    "environment.YOUR_API_KEY.label",
    "package.description",
    "package.name",
    "tool.i18n_translate.description",
  ]);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /bin\/i18n\.exe/);
  assert.doesNotMatch(serialized, /YOUR_API_KEY.*null/);
  assert.doesNotMatch(serialized, /inputSchema/);
});

test("rejects localization config paths and source bundle aliases deterministically", () => {
  const pathIssues = validateLocalizationV1({
    sourceLocale: "en",
    bundles: { ko: "../ko.json" },
  });
  assert.ok(pathIssues.some((issue) => issue.code === "localization_bundle_path"));

  const sourceIssues = validateLocalizationV1({
    sourceLocale: "en",
    bundles: { EN: "locales/en.json" },
  });
  assert.ok(sourceIssues.some((issue) => issue.code === "localization_source_bundle_forbidden"));
});

test("rejects bundle keys outside the translation allowlist", () => {
  const issues = validateLocalizationBundleV1(manifest, {
    "package.name": "국제화",
    "entry.command": "악성 경로",
    "environment.YOUR_API_KEY.default": "secret",
  });
  assert.equal(issues.filter((issue) => issue.code === "localization_bundle_unknown_key").length, 2);
});

test("resolves exact locale, language fallback, and source fallback", () => {
  assert.deepEqual(
    resolveLocalizationLocaleV1(manifest.localization, ["ko-KR"]),
    { locale: "ko", source: false, bundlePath: "locales/ko.json" },
  );
  assert.deepEqual(
    resolveLocalizationLocaleV1(manifest.localization, ["ja-JP"]),
    { locale: "ja", source: false, bundlePath: "locales/ja.json" },
  );
  assert.deepEqual(
    resolveLocalizationLocaleV1(manifest.localization, ["fr-FR"]),
    { locale: "en", source: true, bundlePath: null },
  );
});

test("localizes display metadata while preserving identities and secret/default values", () => {
  const localized = applyLocalizationBundleV1(manifest, {
    "package.name": "국제화",
    "package.description": "번역 MCP 서버",
    "environment.YOUR_API_KEY.label": "Google Cloud Translation API 키",
    "environment.YOUR_API_KEY.description": "새 번역이 필요할 때만 사용하는 선택적 API 키",
    "tool.i18n_translate.description": "표시 텍스트를 번역합니다.",
  });

  assert.equal(localized.package.name, "국제화");
  assert.equal(localized.package.id, "i18n");
  assert.equal(localized.entry.command, "bin/i18n.exe");
  assert.equal(localized.environment.variables[0].name, "YOUR_API_KEY");
  assert.equal(localized.environment.variables[0].label, "Google Cloud Translation API 키");
  assert.equal(localized.environment.variables[0].default, null);
  assert.equal(localized.environment.variables[0].secret, true);
  assert.equal(localized.tools[0].name, "i18n_translate");
  assert.equal(localized.tools[0].description, "표시 텍스트를 번역합니다.");
});

test("missing bundle keys fall back to canonical source strings", () => {
  const localized = applyLocalizationBundleV1(manifest, {
    "environment.YOUR_API_KEY.label": "API 키",
  });
  assert.equal(localized.package.name, "I18n");
  assert.equal(localized.package.description, "Translation MCP server");
  assert.equal(localized.environment.variables[0].label, "API 키");
  assert.equal(
    localized.environment.variables[0].description,
    "Optional API key used only when new translations are needed.",
  );
});

test("Argos adapter exposes deterministic offline diagnostics and a locale-independent UTF-8 pipe boundary", () => {
  const adapterPath = fileURLToPath(new URL("../localization/argos-adapter.py", import.meta.url));
  const builderPath = fileURLToPath(new URL("../localization/build-localization.mjs", import.meta.url));
  const adapter = readFileSync(adapterPath, "utf8");
  const builder = readFileSync(builderPath, "utf8");

  assert.match(adapter, /ARGOS_NOT_INSTALLED/);
  assert.match(adapter, /ARGOS_MODEL_MISSING/);
  assert.match(adapter, /ARGOS_TRANSLATION_FAILED/);
  assert.match(adapter, /ensure_ascii=True/);
  assert.match(builder, /ARGOS_PYTHON_MISSING/);
  assert.match(builder, /"-X",\s*"utf8"/);
  assert.doesNotMatch(adapter, /update_package_index|download\(|install_from_path|package\.install/);
  assert.doesNotMatch(builder, /update_package_index|install_from_path|\.argosmodel/);
});
