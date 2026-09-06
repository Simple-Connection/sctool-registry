export const SCTOOL_SCHEMA_VERSION = 1 as const;

export const SCTOOL_ENV_VALUE_TYPES = [
  "string",
  "url",
  "number",
  "boolean",
] as const;

export type ScToolEnvironmentValueType =
  (typeof SCTOOL_ENV_VALUE_TYPES)[number];

export type ScToolEnvironmentDefault = string | number | boolean | null;

export interface ScToolEnvironmentVariableV1 {
  name: string;
  label: string;
  description: string;
  valueType: ScToolEnvironmentValueType;
  required: boolean;
  secret: boolean;
  default: ScToolEnvironmentDefault;
}

export interface ScToolEnvironmentV1 {
  variables: ScToolEnvironmentVariableV1[];
}

export interface ScToolPackageV1 {
  id: string;
  name: string;
  version: string;
  publisher?: string;
  description?: string;
  homepage?: string;
}

export interface ScToolPlatformV1 {
  os: string;
  arch: string;
}

export interface ScToolEntryV1 {
  type: "mcp-server";
  transport: "stdio";
  command: string;
  args: string[];
  cwd: string;
}

/**
 * The SDK owns the stable package/entry/environment contract.
 * Tool, policy, and integrity payloads remain extensible for builder-specific data.
 */
export interface ScToolManifestV1 {
  schemaVersion: 1;
  package: ScToolPackageV1;
  platform?: ScToolPlatformV1;
  entry: ScToolEntryV1;
  environment?: ScToolEnvironmentV1;
  tools?: readonly unknown[];
  policy?: Record<string, unknown>;
  integrity?: Record<string, unknown>;
  readme?: string;
  docs?: string[];
  [key: string]: unknown;
}

export type NormalizedScToolManifestV1<T extends ScToolManifestV1 = ScToolManifestV1> =
  Omit<T, "environment"> & {
    environment: ScToolEnvironmentV1;
  };

export type ScToolEnvironmentInput = string | number | boolean | null | undefined;

export interface ScToolValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class ScToolValidationError extends Error {
  readonly issues: ScToolValidationIssue[];

  constructor(issues: ScToolValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "ScToolValidationError";
    this.issues = issues;
  }
}

export const SCTOOL_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export const SCTOOL_RESERVED_ENV_PREFIXES = [
  "SC_TOOL_",
  "SIMPLE_CONNECTION_",
] as const;

export const SCTOOL_RESERVED_ENV_NAMES = new Set([
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
]);

const ENV_VARIABLE_KEYS = [
  "name",
  "label",
  "description",
  "valueType",
  "required",
  "secret",
  "default",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function issue(
  issues: ScToolValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateDefaultValue(
  variable: Record<string, unknown>,
  path: string,
  issues: ScToolValidationIssue[],
): void {
  const valueType = variable.valueType;
  const defaultValue = variable.default;

  if (defaultValue === null) return;

  if (variable.secret === true) {
    issue(
      issues,
      "secret_default_forbidden",
      `${path}.default`,
      "secret=true인 환경변수의 default는 null이어야 합니다.",
    );
    return;
  }

  if (valueType === "string") {
    if (typeof defaultValue !== "string") {
      issue(issues, "default_type", `${path}.default`, "string 또는 null이어야 합니다.");
    }
    return;
  }

  if (valueType === "url") {
    if (typeof defaultValue !== "string") {
      issue(issues, "default_type", `${path}.default`, "URL 문자열 또는 null이어야 합니다.");
      return;
    }
    try {
      new URL(defaultValue);
    } catch {
      issue(issues, "default_url", `${path}.default`, "유효한 절대 URL이어야 합니다.");
    }
    return;
  }

  if (valueType === "number") {
    if (typeof defaultValue !== "number" || !Number.isFinite(defaultValue)) {
      issue(issues, "default_type", `${path}.default`, "유한한 number 또는 null이어야 합니다.");
    }
    return;
  }

  if (valueType === "boolean" && typeof defaultValue !== "boolean") {
    issue(issues, "default_type", `${path}.default`, "boolean 또는 null이어야 합니다.");
  }
}

export function validateEnvironmentVariableV1(
  value: unknown,
  path = "environment.variables[0]",
): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];

  if (!isRecord(value)) {
    issue(issues, "variable_type", path, "환경변수 선언은 객체여야 합니다.");
    return issues;
  }

  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...ENV_VARIABLE_KEYS].sort();
  const missingKeys = expectedKeys.filter((key) => !hasOwn(value, key));
  const extraKeys = actualKeys.filter(
    (key) => !(ENV_VARIABLE_KEYS as readonly string[]).includes(key),
  );

  for (const key of missingKeys) {
    issue(issues, "missing_field", `${path}.${key}`, "필수 필드입니다.");
  }
  for (const key of extraKeys) {
    issue(issues, "unknown_field", `${path}.${key}`, "SCTool Manifest v1에서 허용되지 않는 필드입니다.");
  }

  if (typeof value.name !== "string" || !SCTOOL_ENV_NAME_PATTERN.test(value.name)) {
    issue(
      issues,
      "invalid_name",
      `${path}.name`,
      "^[A-Z_][A-Z0-9_]*$ 형식이어야 합니다.",
    );
  } else {
    const envName = value.name;
    if (SCTOOL_RESERVED_ENV_NAMES.has(envName)) {
      issue(issues, "reserved_name", `${path}.name`, "운영체제 예약 환경변수명입니다.");
    }
    if (SCTOOL_RESERVED_ENV_PREFIXES.some((prefix) => envName.startsWith(prefix))) {
      issue(issues, "reserved_prefix", `${path}.name`, "Simple Connection 예약 prefix입니다.");
    }
  }

  if (typeof value.label !== "string" || value.label.trim().length === 0) {
    issue(issues, "invalid_label", `${path}.label`, "비어 있지 않은 문자열이어야 합니다.");
  }

  if (typeof value.description !== "string") {
    issue(issues, "invalid_description", `${path}.description`, "문자열이어야 합니다.");
  }

  if (
    typeof value.valueType !== "string" ||
    !(SCTOOL_ENV_VALUE_TYPES as readonly string[]).includes(value.valueType)
  ) {
    issue(
      issues,
      "invalid_value_type",
      `${path}.valueType`,
      `허용값: ${SCTOOL_ENV_VALUE_TYPES.join(", ")}`,
    );
  }

  if (typeof value.required !== "boolean") {
    issue(issues, "invalid_required", `${path}.required`, "boolean이어야 합니다.");
  }

  if (typeof value.secret !== "boolean") {
    issue(issues, "invalid_secret", `${path}.secret`, "boolean이어야 합니다.");
  }

  if (hasOwn(value, "default")) {
    validateDefaultValue(value, path, issues);
  }

  return issues;
}

export function validateEnvironmentV1(value: unknown): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];

  if (!isRecord(value)) {
    issue(issues, "environment_type", "environment", "객체여야 합니다.");
    return issues;
  }

  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== "variables") {
      issue(
        issues,
        "unknown_environment_field",
        `environment.${key}`,
        "SCTool Manifest v1 environment에는 variables만 허용됩니다.",
      );
    }
  }

  if (!Array.isArray(value.variables)) {
    issue(issues, "variables_type", "environment.variables", "배열이어야 합니다.");
    return issues;
  }

  const names = new Map<string, number>();
  value.variables.forEach((variable, index) => {
    const path = `environment.variables[${index}]`;
    issues.push(...validateEnvironmentVariableV1(variable, path));

    if (isRecord(variable) && typeof variable.name === "string") {
      const normalized = variable.name.toUpperCase();
      const previous = names.get(normalized);
      if (previous !== undefined) {
        issue(
          issues,
          "duplicate_name",
          `${path}.name`,
          `environment.variables[${previous}].name과 중복됩니다.`,
        );
      } else {
        names.set(normalized, index);
      }
    }
  });

  return issues;
}

export function validateScToolManifestV1(value: unknown): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];

  if (!isRecord(value)) {
    issue(issues, "manifest_type", "$", "tool.json 루트는 객체여야 합니다.");
    return issues;
  }

  if (value.schemaVersion !== SCTOOL_SCHEMA_VERSION) {
    issue(issues, "schema_version", "schemaVersion", "1이어야 합니다.");
  }

  if (!isRecord(value.package)) {
    issue(issues, "package_type", "package", "객체여야 합니다.");
  } else {
    for (const field of ["id", "name", "version"] as const) {
      if (typeof value.package[field] !== "string" || value.package[field].trim().length === 0) {
        issue(issues, "package_field", `package.${field}`, "비어 있지 않은 문자열이어야 합니다.");
      }
    }
  }

  if (!isRecord(value.entry)) {
    issue(issues, "entry_type", "entry", "객체여야 합니다.");
  } else {
    if (value.entry.type !== "mcp-server") {
      issue(issues, "entry_type_value", "entry.type", "\"mcp-server\"여야 합니다.");
    }
    if (value.entry.transport !== "stdio") {
      issue(issues, "entry_transport", "entry.transport", "\"stdio\"여야 합니다.");
    }
    if (typeof value.entry.command !== "string" || value.entry.command.trim().length === 0) {
      issue(issues, "entry_command", "entry.command", "비어 있지 않은 상대경로 문자열이어야 합니다.");
    }
    if (!Array.isArray(value.entry.args) || value.entry.args.some((arg) => typeof arg !== "string")) {
      issue(issues, "entry_args", "entry.args", "문자열 배열이어야 합니다.");
    }
    if (typeof value.entry.cwd !== "string" || value.entry.cwd.trim().length === 0) {
      issue(issues, "entry_cwd", "entry.cwd", "비어 있지 않은 상대경로 문자열이어야 합니다.");
    }
  }

  if (value.environment !== undefined) {
    issues.push(...validateEnvironmentV1(value.environment));
  }

  return issues;
}

export function assertValidScToolManifestV1(value: unknown): asserts value is ScToolManifestV1 {
  const issues = validateScToolManifestV1(value);
  if (issues.length > 0) throw new ScToolValidationError(issues);
}

export function defineEnvironmentVariable(
  variable: ScToolEnvironmentVariableV1,
): ScToolEnvironmentVariableV1 {
  const issues = validateEnvironmentVariableV1(variable);
  if (issues.length > 0) throw new ScToolValidationError(issues);
  return variable;
}

export function defineScTool<T extends ScToolManifestV1>(
  manifest: T,
): NormalizedScToolManifestV1<T> {
  assertValidScToolManifestV1(manifest);
  const normalized = {
    ...manifest,
    environment: manifest.environment ?? { variables: [] },
  } as NormalizedScToolManifestV1<T>;

  const environmentIssues = validateEnvironmentV1(normalized.environment);
  if (environmentIssues.length > 0) throw new ScToolValidationError(environmentIssues);
  return normalized;
}

export function serializeEnvironmentValue(value: string | number | boolean): string {
  return String(value);
}

export function resolveEnvironmentDefaults(
  variables: readonly ScToolEnvironmentVariableV1[],
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.default !== null) {
      resolved[variable.name] = serializeEnvironmentValue(variable.default);
    }
  }
  return resolved;
}

export function validateEnvironmentInput(
  variable: ScToolEnvironmentVariableV1,
  value: ScToolEnvironmentInput,
): ScToolValidationIssue[] {
  const issues: ScToolValidationIssue[] = [];
  const path = `environmentValues.${variable.name}`;
  const empty = value === null || value === undefined || value === "";

  if (empty) {
    if (variable.required && variable.default === null) {
      issue(issues, "required_value", path, "필수 환경변수 값이 없습니다.");
    }
    return issues;
  }

  if (variable.valueType === "string" && typeof value !== "string") {
    issue(issues, "input_type", path, "문자열이어야 합니다.");
  } else if (variable.valueType === "url") {
    if (typeof value !== "string") {
      issue(issues, "input_type", path, "URL 문자열이어야 합니다.");
    } else {
      try {
        new URL(value);
      } catch {
        issue(issues, "input_url", path, "유효한 절대 URL이어야 합니다.");
      }
    }
  } else if (
    variable.valueType === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    issue(issues, "input_type", path, "유한한 number여야 합니다.");
  } else if (variable.valueType === "boolean" && typeof value !== "boolean") {
    issue(issues, "input_type", path, "boolean이어야 합니다.");
  }

  return issues;
}

export function resolveEnvironmentValues(
  variables: readonly ScToolEnvironmentVariableV1[],
  values: Readonly<Record<string, ScToolEnvironmentInput>>,
): Record<string, string> {
  const issues: ScToolValidationIssue[] = [];
  const resolved = resolveEnvironmentDefaults(variables);

  for (const variable of variables) {
    const value = values[variable.name];
    issues.push(...validateEnvironmentInput(variable, value));
    if (value !== null && value !== undefined && value !== "") {
      resolved[variable.name] = serializeEnvironmentValue(value);
    }
  }

  if (issues.length > 0) throw new ScToolValidationError(issues);
  return resolved;
}
