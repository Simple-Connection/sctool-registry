export const SCTOOL_HOST_CAPABILITIES_SCHEMA_VERSION = 1 as const;

export const SCTOOL_PACKAGE_ENTRY_TRANSPORTS = ["stdio"] as const;
export const SCTOOL_CLIENT_EXPOSURE_TRANSPORTS = ["streamable-http"] as const;
export const SCTOOL_STREAMABLE_HTTP_METHODS = ["POST", "GET", "DELETE"] as const;

export type ScToolPackageEntryTransport =
  (typeof SCTOOL_PACKAGE_ENTRY_TRANSPORTS)[number];
export type ScToolClientExposureTransport =
  (typeof SCTOOL_CLIENT_EXPOSURE_TRANSPORTS)[number];
export type ScToolStreamableHttpMethod =
  (typeof SCTOOL_STREAMABLE_HTTP_METHODS)[number];

export interface ScToolHostIdentityV1 {
  id: string;
  name: string;
}

export interface ScToolPackageEntryCapabilityV1 {
  transport: "stdio";
}

export interface ScToolStreamableHttpAuthenticationV1 {
  type: "bearer";
  required: true;
}

export interface ScToolStreamableHttpSessionV1 {
  header: "Mcp-Session-Id";
  lifecycle: "host-managed";
}

export interface ScToolStreamableHttpDiscoverProbeV1 {
  method: "server/discover";
  behavior: "method-not-found";
}

export interface ScToolStreamableHttpProtocolV1 {
  baseline: "2025-11-25";
  discoverProbe: ScToolStreamableHttpDiscoverProbeV1;
}

export interface ScToolClientExposureCapabilityV1 {
  transport: "streamable-http";
  bind: "127.0.0.1";
  pathPattern: string;
  methods: ScToolStreamableHttpMethod[];
  authentication: ScToolStreamableHttpAuthenticationV1;
  session: ScToolStreamableHttpSessionV1;
  protocol: ScToolStreamableHttpProtocolV1;
}

export interface ScToolHostBridgeCapabilityV1 {
  mode: "host-managed";
  clientTransport: "streamable-http";
  packageTransport: "stdio";
}

export interface ScToolHostCapabilitiesV1 {
  schemaVersion: 1;
  host: ScToolHostIdentityV1;
  packageEntry: ScToolPackageEntryCapabilityV1;
  clientExposure: ScToolClientExposureCapabilityV1;
  bridge: ScToolHostBridgeCapabilityV1;
}

export interface ScToolHostCapabilityValidationIssue {
  code: string;
  path: string;
  message: string;
}

export class ScToolHostCapabilityValidationError extends Error {
  readonly issues: ScToolHostCapabilityValidationIssue[];

  constructor(issues: ScToolHostCapabilityValidationIssue[]) {
    super(issues.map((entry) => `${entry.path}: ${entry.message}`).join("\n"));
    this.name = "ScToolHostCapabilityValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function issue(
  issues: ScToolHostCapabilityValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function validateMethods(
  value: unknown,
  issues: ScToolHostCapabilityValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issue(issues, "methods_type", "clientExposure.methods", "문자열 배열이어야 합니다.");
    return;
  }

  const expected = new Set<string>(SCTOOL_STREAMABLE_HTTP_METHODS);
  const actual = new Set<string>();
  let invalid = false;

  for (const method of value) {
    if (typeof method !== "string" || !expected.has(method)) {
      invalid = true;
      continue;
    }
    if (actual.has(method)) invalid = true;
    actual.add(method);
  }

  if (value.length !== expected.size || actual.size !== expected.size || invalid) {
    issue(
      issues,
      "methods_value",
      "clientExposure.methods",
      `허용 method ${SCTOOL_STREAMABLE_HTTP_METHODS.join(", ")}를 각각 한 번씩 선언해야 합니다.`,
    );
  }
}

export function validateScToolHostCapabilitiesV1(
  value: unknown,
): ScToolHostCapabilityValidationIssue[] {
  const issues: ScToolHostCapabilityValidationIssue[] = [];

  if (!isRecord(value)) {
    issue(issues, "capabilities_type", "$", "host capability 문서는 객체여야 합니다.");
    return issues;
  }

  if (!hasOnlyKeys(value, ["schemaVersion", "host", "packageEntry", "clientExposure", "bridge"])) {
    issue(issues, "unknown_root_field", "$", "정의되지 않은 최상위 필드가 있습니다.");
  }

  if (value.schemaVersion !== SCTOOL_HOST_CAPABILITIES_SCHEMA_VERSION) {
    issue(issues, "schema_version", "schemaVersion", "1이어야 합니다.");
  }

  if (!isRecord(value.host)) {
    issue(issues, "host_type", "host", "객체여야 합니다.");
  } else {
    if (!hasOnlyKeys(value.host, ["id", "name"])) {
      issue(issues, "unknown_host_field", "host", "id와 name만 허용됩니다.");
    }
    if (typeof value.host.id !== "string" || value.host.id.trim().length === 0) {
      issue(issues, "host_id", "host.id", "비어 있지 않은 문자열이어야 합니다.");
    }
    if (typeof value.host.name !== "string" || value.host.name.trim().length === 0) {
      issue(issues, "host_name", "host.name", "비어 있지 않은 문자열이어야 합니다.");
    }
  }

  if (!isRecord(value.packageEntry)) {
    issue(issues, "package_entry_type", "packageEntry", "객체여야 합니다.");
  } else {
    if (!hasOnlyKeys(value.packageEntry, ["transport"])) {
      issue(issues, "unknown_package_entry_field", "packageEntry", "transport만 허용됩니다.");
    }
    if (value.packageEntry.transport !== "stdio") {
      issue(
        issues,
        "package_entry_transport",
        "packageEntry.transport",
        'SCTool package 실행 경계는 "stdio"여야 합니다.',
      );
    }
  }

  if (!isRecord(value.clientExposure)) {
    issue(issues, "client_exposure_type", "clientExposure", "객체여야 합니다.");
  } else {
    const exposure = value.clientExposure;
    if (!hasOnlyKeys(exposure, [
      "transport",
      "bind",
      "pathPattern",
      "methods",
      "authentication",
      "session",
      "protocol",
    ])) {
      issue(issues, "unknown_client_exposure_field", "clientExposure", "정의되지 않은 필드가 있습니다.");
    }
    if (exposure.transport !== "streamable-http") {
      issue(
        issues,
        "client_exposure_transport",
        "clientExposure.transport",
        'Simple Connection client 노출 transport는 "streamable-http"여야 합니다.',
      );
    }
    if (exposure.bind !== "127.0.0.1") {
      issue(issues, "client_exposure_bind", "clientExposure.bind", '"127.0.0.1"이어야 합니다.');
    }
    if (
      typeof exposure.pathPattern !== "string" ||
      exposure.pathPattern.trim().length === 0 ||
      !exposure.pathPattern.startsWith("/")
    ) {
      issue(
        issues,
        "path_pattern",
        "clientExposure.pathPattern",
        '"/"로 시작하는 비어 있지 않은 path pattern이어야 합니다.',
      );
    }
    validateMethods(exposure.methods, issues);

    if (!isRecord(exposure.authentication)) {
      issue(issues, "authentication_type", "clientExposure.authentication", "객체여야 합니다.");
    } else {
      if (!hasOnlyKeys(exposure.authentication, ["type", "required"])) {
        issue(issues, "unknown_authentication_field", "clientExposure.authentication", "type과 required만 허용됩니다.");
      }
      if (exposure.authentication.type !== "bearer") {
        issue(issues, "authentication_type_value", "clientExposure.authentication.type", '"bearer"여야 합니다.');
      }
      if (exposure.authentication.required !== true) {
        issue(issues, "authentication_required", "clientExposure.authentication.required", "true여야 합니다.");
      }
    }

    if (!isRecord(exposure.session)) {
      issue(issues, "session_type", "clientExposure.session", "객체여야 합니다.");
    } else {
      if (!hasOnlyKeys(exposure.session, ["header", "lifecycle"])) {
        issue(issues, "unknown_session_field", "clientExposure.session", "header와 lifecycle만 허용됩니다.");
      }
      if (exposure.session.header !== "Mcp-Session-Id") {
        issue(issues, "session_header", "clientExposure.session.header", '"Mcp-Session-Id"여야 합니다.');
      }
      if (exposure.session.lifecycle !== "host-managed") {
        issue(issues, "session_lifecycle", "clientExposure.session.lifecycle", '"host-managed"여야 합니다.');
      }
    }

    if (!isRecord(exposure.protocol)) {
      issue(issues, "protocol_type", "clientExposure.protocol", "객체여야 합니다.");
    } else {
      if (!hasOnlyKeys(exposure.protocol, ["baseline", "discoverProbe"])) {
        issue(issues, "unknown_protocol_field", "clientExposure.protocol", "baseline과 discoverProbe만 허용됩니다.");
      }
      if (exposure.protocol.baseline !== "2025-11-25") {
        issue(issues, "protocol_baseline", "clientExposure.protocol.baseline", '"2025-11-25"여야 합니다.');
      }
      if (!isRecord(exposure.protocol.discoverProbe)) {
        issue(issues, "discover_probe_type", "clientExposure.protocol.discoverProbe", "객체여야 합니다.");
      } else {
        if (!hasOnlyKeys(exposure.protocol.discoverProbe, ["method", "behavior"])) {
          issue(issues, "unknown_discover_probe_field", "clientExposure.protocol.discoverProbe", "method와 behavior만 허용됩니다.");
        }
        if (exposure.protocol.discoverProbe.method !== "server/discover") {
          issue(issues, "discover_probe_method", "clientExposure.protocol.discoverProbe.method", '"server/discover"여야 합니다.');
        }
        if (exposure.protocol.discoverProbe.behavior !== "method-not-found") {
          issue(issues, "discover_probe_behavior", "clientExposure.protocol.discoverProbe.behavior", '"method-not-found"여야 합니다.');
        }
      }
    }
  }

  if (!isRecord(value.bridge)) {
    issue(issues, "bridge_type", "bridge", "객체여야 합니다.");
  } else {
    if (!hasOnlyKeys(value.bridge, ["mode", "clientTransport", "packageTransport"])) {
      issue(issues, "unknown_bridge_field", "bridge", "mode, clientTransport, packageTransport만 허용됩니다.");
    }
    if (value.bridge.mode !== "host-managed") {
      issue(issues, "bridge_mode", "bridge.mode", '"host-managed"여야 합니다.');
    }
    if (value.bridge.clientTransport !== "streamable-http") {
      issue(issues, "bridge_client_transport", "bridge.clientTransport", '"streamable-http"여야 합니다.');
    }
    if (value.bridge.packageTransport !== "stdio") {
      issue(issues, "bridge_package_transport", "bridge.packageTransport", '"stdio"여야 합니다.');
    }
  }

  return issues;
}

export function assertValidScToolHostCapabilitiesV1(
  value: unknown,
): asserts value is ScToolHostCapabilitiesV1 {
  const issues = validateScToolHostCapabilitiesV1(value);
  if (issues.length > 0) throw new ScToolHostCapabilityValidationError(issues);
}

export function defineScToolHostCapabilities(
  capabilities: ScToolHostCapabilitiesV1,
): ScToolHostCapabilitiesV1 {
  assertValidScToolHostCapabilitiesV1(capabilities);
  return capabilities;
}
