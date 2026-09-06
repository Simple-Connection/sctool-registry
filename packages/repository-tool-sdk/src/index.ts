export const REPOSITORY_TOOL_SCHEMA_VERSION = 1 as const;
export const REPOSITORY_TOOL_KIND = "tool" as const;
export const REPOSITORY_TOOL_CONTENT_ROOT = "content" as const;
export const REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER = "{{package_root}}" as const;

const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const ANY_PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;
const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:[\\/]/;
const SECRET_ENV_KEY_RE = /(^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)(_|$)/i;

export interface RepositoryToolMcpEntrypointV1 {
  command: string;
  path: string;
  args: string[];
  cwd: string;
}

export interface RepositoryToolMcpDefinitionV1 {
  profileId: string;
  title: string;
  entrypoint: RepositoryToolMcpEntrypointV1;
  env: Record<string, string>;
  toolGroups: Record<string, string[]>;
  tools: string[];
  docs: string[];
}

export interface RepositoryToolPackageDescriptorV1 {
  schemaVersion: typeof REPOSITORY_TOOL_SCHEMA_VERSION;
  kind: typeof REPOSITORY_TOOL_KIND;
  id: string;
  name: string;
  version: string;
  contentRoot: typeof REPOSITORY_TOOL_CONTENT_ROOT;
  mcp?: RepositoryToolMcpDefinitionV1;
}

export interface RepositoryToolValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface RepositoryToolValidationResult {
  valid: boolean;
  issues: RepositoryToolValidationIssue[];
  descriptor?: RepositoryToolPackageDescriptorV1;
}

export interface RepositoryToolIdentityV1 {
  kind: typeof REPOSITORY_TOOL_KIND;
  id: string;
  version: string;
}

export class RepositoryToolValidationError extends Error {
  readonly issues: RepositoryToolValidationIssue[];

  constructor(issues: RepositoryToolValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join(" | "));
    this.name = "RepositoryToolValidationError";
    this.issues = issues.map((issue) => ({ ...issue }));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: RepositoryToolValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function normalizedString(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
  path: string,
  code: string,
): string | null {
  if (typeof value !== "string" || !value.trim()) {
    addIssue(issues, code, path, "must be a non-empty string");
    return null;
  }
  return value.trim();
}

function normalizedSafeSegment(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
  path: string,
  code: string,
): string | null {
  const normalized = normalizedString(value, issues, path, code);
  if (normalized === null) return null;
  if (normalized === "." || normalized === ".." || !SAFE_SEGMENT_RE.test(normalized)) {
    addIssue(issues, code, path, "must match ^[A-Za-z0-9._-]+$ and cannot be '.' or '..'");
    return null;
  }
  return normalized;
}

function normalizedStringArray(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
  path: string,
  code: string,
): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    addIssue(issues, code, path, "must be an array of strings");
    return null;
  }
  return [...value];
}

function validatePlaceholderAllowlist(
  value: string,
  issues: RepositoryToolValidationIssue[],
  path: string,
): void {
  const placeholders = value.match(ANY_PLACEHOLDER_RE) ?? [];
  const unsupported = placeholders.filter(
    (placeholder) => placeholder !== REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER,
  );
  if (unsupported.length > 0) {
    addIssue(
      issues,
      "RTD_PLACEHOLDER_UNSUPPORTED",
      path,
      `contains unsupported placeholder(s): ${[...new Set(unsupported)].join(", ")}`,
    );
  }
}

function validatePathLike(
  value: string,
  issues: RepositoryToolValidationIssue[],
  path: string,
): void {
  validatePlaceholderAllowlist(value, issues, path);
  const trimmed = value.trim();
  let normalized = trimmed.replace(/\\/g, "/");
  if (normalized === REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER) return;
  if (normalized.startsWith(`${REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER}/`)) {
    normalized = normalized.slice(REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER.length + 1);
  } else if (normalized.includes(REPOSITORY_TOOL_PACKAGE_ROOT_PLACEHOLDER)) {
    addIssue(
      issues,
      "RTD_PATH_INVALID",
      path,
      "{{package_root}} must be the complete path anchor when used in a path-like field",
    );
    return;
  }
  if (
    !normalized ||
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE_RE.test(trimmed) ||
    normalized.split("/").includes("..")
  ) {
    addIssue(
      issues,
      "RTD_PATH_INVALID",
      path,
      "must be package-relative or {{package_root}}-anchored and cannot traverse with '..'",
    );
  }
}

function normalizedStringRecord(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
  path: string,
  code: string,
): Record<string, string> | null {
  if (!isRecord(value) || !Object.values(value).every((entry) => typeof entry === "string")) {
    addIssue(issues, code, path, "must be an object whose values are strings");
    return null;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
}

function normalizedToolGroups(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
): Record<string, string[]> | null {
  if (
    !isRecord(value) ||
    !Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
    )
  ) {
    addIssue(
      issues,
      "RTD_MCP_TOOL_GROUPS_INVALID",
      "mcp.toolGroups",
      "must be an object whose values are string arrays",
    );
    return null;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, [...(entry as string[])]]),
  );
}

function normalizeMcp(
  value: unknown,
  issues: RepositoryToolValidationIssue[],
): RepositoryToolMcpDefinitionV1 | null {
  if (!isRecord(value)) {
    addIssue(issues, "RTD_MCP_INVALID", "mcp", "must be an object when present");
    return null;
  }

  const profileId = normalizedString(
    value.profileId,
    issues,
    "mcp.profileId",
    "RTD_MCP_PROFILE_ID_INVALID",
  );
  const title = normalizedString(
    value.title,
    issues,
    "mcp.title",
    "RTD_MCP_TITLE_INVALID",
  );

  let entrypoint: RepositoryToolMcpEntrypointV1 | null = null;
  if (!isRecord(value.entrypoint)) {
    addIssue(issues, "RTD_MCP_ENTRYPOINT_INVALID", "mcp.entrypoint", "must be an object");
  } else {
    const command = normalizedString(
      value.entrypoint.command,
      issues,
      "mcp.entrypoint.command",
      "RTD_MCP_ENTRYPOINT_COMMAND_INVALID",
    );
    const entryPath = normalizedString(
      value.entrypoint.path,
      issues,
      "mcp.entrypoint.path",
      "RTD_MCP_ENTRYPOINT_PATH_INVALID",
    );
    const args = normalizedStringArray(
      value.entrypoint.args,
      issues,
      "mcp.entrypoint.args",
      "RTD_MCP_ENTRYPOINT_ARGS_INVALID",
    );
    const cwd = normalizedString(
      value.entrypoint.cwd,
      issues,
      "mcp.entrypoint.cwd",
      "RTD_MCP_ENTRYPOINT_CWD_INVALID",
    );

    if (command !== null) validatePlaceholderAllowlist(command, issues, "mcp.entrypoint.command");
    if (entryPath !== null) validatePathLike(entryPath, issues, "mcp.entrypoint.path");
    if (args !== null) {
      args.forEach((arg, index) =>
        validatePlaceholderAllowlist(arg, issues, `mcp.entrypoint.args[${index}]`),
      );
    }
    if (cwd !== null) validatePathLike(cwd, issues, "mcp.entrypoint.cwd");

    if (command !== null && entryPath !== null && args !== null && cwd !== null) {
      entrypoint = { command, path: entryPath, args, cwd };
    }
  }

  const env = normalizedStringRecord(
    value.env,
    issues,
    "mcp.env",
    "RTD_MCP_ENV_INVALID",
  );
  if (env !== null) {
    for (const [key, envValue] of Object.entries(env)) {
      if (SECRET_ENV_KEY_RE.test(key.trim())) {
        addIssue(
          issues,
          "RTD_MCP_ENV_SECRET_KEY",
          `mcp.env.${key}`,
          "secret-sensitive environment keys are not allowed in the package descriptor",
        );
      }
      validatePlaceholderAllowlist(envValue, issues, `mcp.env.${key}`);
    }
  }

  const toolGroups = normalizedToolGroups(value.toolGroups, issues);
  const tools = normalizedStringArray(
    value.tools,
    issues,
    "mcp.tools",
    "RTD_MCP_TOOLS_INVALID",
  );
  const docs = normalizedStringArray(
    value.docs,
    issues,
    "mcp.docs",
    "RTD_MCP_DOCS_INVALID",
  );
  if (docs !== null) {
    docs.forEach((docPath, index) => validatePathLike(docPath, issues, `mcp.docs[${index}]`));
  }

  if (
    profileId === null ||
    title === null ||
    entrypoint === null ||
    env === null ||
    toolGroups === null ||
    tools === null ||
    docs === null
  ) {
    return null;
  }

  return { profileId, title, entrypoint, env, toolGroups, tools, docs };
}

export function validateRepositoryToolDescriptorV1(value: unknown): RepositoryToolValidationResult {
  const issues: RepositoryToolValidationIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, "RTD_DESCRIPTOR_INVALID", "$", "must be an object");
    return { valid: false, issues };
  }

  if (value.schemaVersion !== REPOSITORY_TOOL_SCHEMA_VERSION) {
    addIssue(issues, "RTD_SCHEMA_VERSION_INVALID", "schemaVersion", "must equal 1");
  }
  if (value.kind !== REPOSITORY_TOOL_KIND) {
    addIssue(issues, "RTD_KIND_INVALID", "kind", "must equal 'tool'");
  }
  const id = normalizedSafeSegment(value.id, issues, "id", "RTD_ID_INVALID");
  const name = normalizedString(value.name, issues, "name", "RTD_NAME_INVALID");
  const version = normalizedSafeSegment(value.version, issues, "version", "RTD_VERSION_INVALID");
  if (value.contentRoot !== REPOSITORY_TOOL_CONTENT_ROOT) {
    addIssue(issues, "RTD_CONTENT_ROOT_INVALID", "contentRoot", "must equal 'content'");
  }

  let mcp: RepositoryToolMcpDefinitionV1 | undefined;
  if (value.mcp !== undefined) {
    const normalized = normalizeMcp(value.mcp, issues);
    if (normalized !== null) mcp = normalized;
  }

  if (issues.length > 0 || id === null || name === null || version === null) {
    return { valid: false, issues };
  }

  const descriptor: RepositoryToolPackageDescriptorV1 = {
    schemaVersion: REPOSITORY_TOOL_SCHEMA_VERSION,
    kind: REPOSITORY_TOOL_KIND,
    id,
    name,
    version,
    contentRoot: REPOSITORY_TOOL_CONTENT_ROOT,
    ...(mcp ? { mcp } : {}),
  };
  return { valid: true, issues: [], descriptor };
}

export function assertValidRepositoryToolDescriptorV1(
  value: unknown,
): RepositoryToolPackageDescriptorV1 {
  const result = validateRepositoryToolDescriptorV1(value);
  if (!result.valid || !result.descriptor) {
    throw new RepositoryToolValidationError(result.issues);
  }
  return result.descriptor;
}

export function normalizeRepositoryToolDescriptorV1(
  value: unknown,
): RepositoryToolPackageDescriptorV1 {
  return assertValidRepositoryToolDescriptorV1(value);
}

export function defineRepositoryTool(
  descriptor: RepositoryToolPackageDescriptorV1,
): RepositoryToolPackageDescriptorV1 {
  return normalizeRepositoryToolDescriptorV1(descriptor);
}

export function repositoryToolIdentity(
  descriptor: Pick<RepositoryToolPackageDescriptorV1, "id" | "version">,
): string {
  return `tool:${descriptor.id}@${descriptor.version}`;
}

export function isRepositoryToolRuntimeCapable(
  descriptor: RepositoryToolPackageDescriptorV1,
): boolean {
  return Boolean(descriptor.mcp);
}

export function assertRepositoryToolIdentityMatch(
  indexIdentity: RepositoryToolIdentityV1,
  descriptorValue: unknown,
): RepositoryToolPackageDescriptorV1 {
  const descriptor = assertValidRepositoryToolDescriptorV1(descriptorValue);
  const issues: RepositoryToolValidationIssue[] = [];
  if (indexIdentity.kind !== REPOSITORY_TOOL_KIND) {
    addIssue(issues, "RTD_IDENTITY_KIND_MISMATCH", "identity.kind", "must equal 'tool'");
  }
  if (indexIdentity.id !== descriptor.id) {
    addIssue(
      issues,
      "RTD_IDENTITY_ID_MISMATCH",
      "identity.id",
      `expected '${descriptor.id}', received '${indexIdentity.id}'`,
    );
  }
  if (indexIdentity.version !== descriptor.version) {
    addIssue(
      issues,
      "RTD_IDENTITY_VERSION_MISMATCH",
      "identity.version",
      `expected '${descriptor.version}', received '${indexIdentity.version}'`,
    );
  }
  if (issues.length > 0) throw new RepositoryToolValidationError(issues);
  return descriptor;
}
