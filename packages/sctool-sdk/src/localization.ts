import type {
  ScToolEnvironmentVariableV1,
  ScToolManifestV1,
  ScToolValidationIssue,
} from "./index.js";

export interface ScToolLocalizationV1 {
  sourceLocale: string;
  bundles: Record<string, string>;
}

export interface ScToolTranslatableMetadataEntry {
  key: string;
  text: string;
}

export interface ScToolLocaleResolution {
  locale: string;
  source: boolean;
  bundlePath: string | null;
}

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  issues: ScToolValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function normalizeScToolLocale(value: string): string {
  return value.trim().replaceAll("_", "-").toLowerCase();
}

export function validateScToolBundlePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  return normalized.toLowerCase().endsWith(".json");
}

export function validateLocalizationV1(
  value: unknown,
  path = "localization",
): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "localization_type", path, "localization은 객체여야 합니다.");
    return issues;
  }

  const allowed = new Set(["sourceLocale", "bundles"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issue(issues, "localization_unknown_field", `${path}.${key}`, "허용되지 않는 localization 필드입니다.");
    }
  }

  if (typeof value.sourceLocale !== "string" || !LOCALE_PATTERN.test(value.sourceLocale)) {
    issue(issues, "localization_source_locale", `${path}.sourceLocale`, "유효한 locale tag여야 합니다.");
  }

  if (!isRecord(value.bundles)) {
    issue(issues, "localization_bundles_type", `${path}.bundles`, "locale-to-path 객체여야 합니다.");
    return issues;
  }

  const normalizedLocales = new Set<string>();
  for (const [locale, bundlePath] of Object.entries(value.bundles)) {
    if (!LOCALE_PATTERN.test(locale)) {
      issue(issues, "localization_bundle_locale", `${path}.bundles.${locale}`, "유효한 locale tag여야 합니다.");
      continue;
    }
    const normalized = normalizeScToolLocale(locale);
    if (normalizedLocales.has(normalized)) {
      issue(issues, "localization_duplicate_locale", `${path}.bundles.${locale}`, "대소문자/구분자 정규화 후 중복 locale입니다.");
    }
    normalizedLocales.add(normalized);
    if (typeof bundlePath !== "string" || !validateScToolBundlePath(bundlePath)) {
      issue(issues, "localization_bundle_path", `${path}.bundles.${locale}`, "번들 내부 상대 JSON 경로여야 합니다.");
    }
  }

  if (
    typeof value.sourceLocale === "string" &&
    isRecord(value.bundles) &&
    normalizedLocales.has(normalizeScToolLocale(value.sourceLocale))
  ) {
    issue(
      issues,
      "localization_source_bundle_forbidden",
      `${path}.bundles`,
      "sourceLocale은 source manifest를 사용하므로 별도 bundle을 선언하지 않습니다.",
    );
  }

  return issues;
}

export function localizationFromManifest(
  manifest: ScToolManifestV1 | Record<string, unknown>,
): ScToolLocalizationV1 | null {
  const value = (manifest as Record<string, unknown>).localization;
  if (value === undefined) return null;
  const issues = validateLocalizationV1(value);
  if (issues.length > 0) return null;
  return value as ScToolLocalizationV1;
}

function toolRecords(manifest: ScToolManifestV1): Record<string, unknown>[] {
  if (!Array.isArray(manifest.tools)) return [];
  return manifest.tools.filter(isRecord);
}

export function extractTranslatableMetadataV1(
  manifest: ScToolManifestV1,
): ScToolTranslatableMetadataEntry[] {
  const entries: ScToolTranslatableMetadataEntry[] = [];
  const add = (key: string, text: unknown): void => {
    if (typeof text !== "string" || text.trim().length === 0) return;
    entries.push({ key, text });
  };

  add("package.name", manifest.package.name);
  add("package.description", manifest.package.description);

  for (const variable of manifest.environment?.variables ?? []) {
    add(`environment.${variable.name}.label`, variable.label);
    add(`environment.${variable.name}.description`, variable.description);
  }

  for (const tool of toolRecords(manifest)) {
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name) continue;
    add(`tool.${name}.description`, tool.description);
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  return entries;
}

export function validateLocalizationBundleV1(
  manifest: ScToolManifestV1,
  value: unknown,
  path = "localizationBundle",
): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, "localization_bundle_type", path, "locale bundle은 문자열 값 객체여야 합니다.");
    return issues;
  }

  const allowedKeys = new Set(extractTranslatableMetadataV1(manifest).map((entry) => entry.key));
  for (const [key, translated] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      issue(issues, "localization_bundle_unknown_key", `${path}.${key}`, "번역 allowlist에 없는 semantic key입니다.");
    }
    if (typeof translated !== "string") {
      issue(issues, "localization_bundle_value", `${path}.${key}`, "번역 값은 문자열이어야 합니다.");
    }
  }
  return issues;
}

function localeCandidates(locale: string): string[] {
  const parts = normalizeScToolLocale(locale).split("-").filter(Boolean);
  const candidates: string[] = [];
  while (parts.length > 0) {
    candidates.push(parts.join("-"));
    parts.pop();
  }
  return candidates;
}

export function resolveLocalizationLocaleV1(
  localization: ScToolLocalizationV1,
  preferredLocales: readonly string[],
): ScToolLocaleResolution {
  const source = normalizeScToolLocale(localization.sourceLocale);
  const bundles = new Map(
    Object.entries(localization.bundles).map(([locale, path]) => [
      normalizeScToolLocale(locale),
      { locale, path },
    ]),
  );

  for (const preferred of preferredLocales) {
    for (const candidate of localeCandidates(preferred)) {
      if (candidate === source) {
        return { locale: localization.sourceLocale, source: true, bundlePath: null };
      }
      const bundle = bundles.get(candidate);
      if (bundle) return { locale: bundle.locale, source: false, bundlePath: bundle.path };
    }
  }

  return { locale: localization.sourceLocale, source: true, bundlePath: null };
}

function localizedValue(bundle: Readonly<Record<string, string>>, key: string, source: string): string {
  const value = bundle[key];
  return typeof value === "string" ? value : source;
}

export function applyLocalizationBundleV1<T extends ScToolManifestV1>(
  manifest: T,
  bundle: Readonly<Record<string, string>>,
): T {
  const packageValue = {
    ...manifest.package,
    name: localizedValue(bundle, "package.name", manifest.package.name),
    ...(manifest.package.description !== undefined
      ? {
          description: localizedValue(
            bundle,
            "package.description",
            manifest.package.description,
          ),
        }
      : {}),
  };

  const environment = manifest.environment
    ? {
        ...manifest.environment,
        variables: manifest.environment.variables.map((variable: ScToolEnvironmentVariableV1) => ({
          ...variable,
          label: localizedValue(
            bundle,
            `environment.${variable.name}.label`,
            variable.label,
          ),
          description: localizedValue(
            bundle,
            `environment.${variable.name}.description`,
            variable.description,
          ),
        })),
      }
    : undefined;

  const tools = Array.isArray(manifest.tools)
    ? manifest.tools.map((tool) => {
        if (!isRecord(tool) || typeof tool.name !== "string") return tool;
        if (typeof tool.description !== "string") return tool;
        return {
          ...tool,
          description: localizedValue(
            bundle,
            `tool.${tool.name}.description`,
            tool.description,
          ),
        };
      })
    : manifest.tools;

  return {
    ...manifest,
    package: packageValue,
    ...(environment ? { environment } : {}),
    ...(tools ? { tools } : {}),
  } as T;
}
