export const SCTOOL_SDK_VERSION = "0.2.0" as const;
export const SCTOOL_MARKETPLACE_PROFILE_SCHEMA_VERSION = 1 as const;
export const SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA =
  "sctool-marketplace-profile-validation/v1" as const;

export const SCTOOL_MARKETPLACE_PROFILE_BINDING = {
  artifact: ".sctool",
  rule: "embedded_or_exactly_bound",
} as const;

export type ScToolMarketplaceProfileUsage =
  | "marketplace_submission"
  | "personal_github_sync"
  | "personal_github_storage"
  | "local_development"
  | "local_storage";

export interface ScToolMarketplaceProfileV1 {
  schemaVersion: 1;
  details: string;
  features: string;
  changelog?: string;
  dependencies?: string;
  extension_pack?: string;
}

export interface ScToolMarketplaceProfileValidationContext {
  usage: ScToolMarketplaceProfileUsage;
  packageId?: string;
  packageVersion?: string;
}

export type ScToolMarketplaceProfileDiagnosticCode =
  | "MARKETPLACE_PROFILE_REQUIRED"
  | "MARKETPLACE_PROFILE_DETAILS_REQUIRED"
  | "MARKETPLACE_PROFILE_FEATURES_REQUIRED";

export type ScToolMarketplaceProfileDiagnosticSeverity = "error";

export interface ScToolMarketplaceProfileDiagnosticV1 {
  schema: typeof SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA;
  code: ScToolMarketplaceProfileDiagnosticCode;
  severity: ScToolMarketplaceProfileDiagnosticSeverity;
  package_id: string | null;
  package_version: string | null;
  profile_schema_version: 1;
  path: string;
  observed: "MISSING" | "BLANK" | "INVALID_TYPE";
  expected: "PROFILE_OBJECT" | "NON_EMPTY_STRING";
  repair_hint:
    | "ADD_MARKETPLACE_PROFILE"
    | "SET_DETAILS_NON_EMPTY"
    | "SET_FEATURES_NON_EMPTY";
  sdk_version: typeof SCTOOL_SDK_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePackageField(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function diagnostic(
  context: ScToolMarketplaceProfileValidationContext,
  code: ScToolMarketplaceProfileDiagnosticCode,
  path: string,
  observed: ScToolMarketplaceProfileDiagnosticV1["observed"],
  expected: ScToolMarketplaceProfileDiagnosticV1["expected"],
  repairHint: ScToolMarketplaceProfileDiagnosticV1["repair_hint"],
): ScToolMarketplaceProfileDiagnosticV1 {
  return {
    schema: SCTOOL_MARKETPLACE_PROFILE_DIAGNOSTIC_SCHEMA,
    code,
    severity: "error",
    package_id: safePackageField(context.packageId),
    package_version: safePackageField(context.packageVersion),
    profile_schema_version: SCTOOL_MARKETPLACE_PROFILE_SCHEMA_VERSION,
    path,
    observed,
    expected,
    repair_hint: repairHint,
    sdk_version: SCTOOL_SDK_VERSION,
  };
}

function requiredStringState(value: unknown): "VALID" | "MISSING" | "BLANK" | "INVALID_TYPE" {
  if (value === undefined || value === null) return "MISSING";
  if (typeof value !== "string") return "INVALID_TYPE";
  return value.trim().length > 0 ? "VALID" : "BLANK";
}

/**
 * Local authoring prevalidation only. Registry admission remains authoritative.
 * Missing Marketplace profiles are allowed for personal GitHub and local flows.
 */
export function validateMarketplaceProfile(
  value: unknown,
  context: ScToolMarketplaceProfileValidationContext,
): ScToolMarketplaceProfileDiagnosticV1[] {
  if (value === undefined || value === null) {
    if (context.usage !== "marketplace_submission") return [];
    return [
      diagnostic(
        context,
        "MARKETPLACE_PROFILE_REQUIRED",
        "marketplaceProfile",
        "MISSING",
        "PROFILE_OBJECT",
        "ADD_MARKETPLACE_PROFILE",
      ),
    ];
  }

  const record = isRecord(value) ? value : {};
  const diagnostics: ScToolMarketplaceProfileDiagnosticV1[] = [];

  const detailsState = isRecord(value)
    ? requiredStringState(record.details)
    : "INVALID_TYPE";
  if (detailsState !== "VALID") {
    diagnostics.push(
      diagnostic(
        context,
        "MARKETPLACE_PROFILE_DETAILS_REQUIRED",
        "marketplaceProfile.details",
        detailsState,
        "NON_EMPTY_STRING",
        "SET_DETAILS_NON_EMPTY",
      ),
    );
  }

  const featuresState = isRecord(value)
    ? requiredStringState(record.features)
    : "INVALID_TYPE";
  if (featuresState !== "VALID") {
    diagnostics.push(
      diagnostic(
        context,
        "MARKETPLACE_PROFILE_FEATURES_REQUIRED",
        "marketplaceProfile.features",
        featuresState,
        "NON_EMPTY_STRING",
        "SET_FEATURES_NON_EMPTY",
      ),
    );
  }

  return diagnostics;
}

export function defineMarketplaceProfile<T extends ScToolMarketplaceProfileV1>(
  profile: T,
): T {
  const diagnostics = validateMarketplaceProfile(profile, {
    usage: "marketplace_submission",
  });
  if (diagnostics.length > 0) {
    throw new ScToolMarketplaceProfileValidationError(diagnostics);
  }
  return profile;
}

export class ScToolMarketplaceProfileValidationError extends Error {
  readonly diagnostics: ScToolMarketplaceProfileDiagnosticV1[];

  constructor(diagnostics: ScToolMarketplaceProfileDiagnosticV1[]) {
    super(diagnostics.map((entry) => `${entry.code}:${entry.path}`).join("\n"));
    this.name = "ScToolMarketplaceProfileValidationError";
    this.diagnostics = diagnostics;
  }
}
