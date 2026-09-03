import {
  PACKAGE_DESCRIPTOR_ACCESS_CONTRACT,
  PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY,
  PACKAGE_DESCRIPTOR_DELIVERY_TYPE,
  PACKAGE_DESCRIPTOR_SCHEMA_VERSION,
  RegistryPackageDescriptorError,
  parsePackageDescriptor,
  validatePackageDescriptor,
} from "@simple-connection/sctool-registry-client-sdk/package-descriptor";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

function assertCondition(condition, label) {
  if (!condition) throw new Error(label);
}

function requireIssue(result, code, label) {
  assertCondition(!result.ok, `${label}: expected validation failure`);
  assertCondition(result.issues.some((entry) => entry.code === code), `${label}: missing issue ${code}`);
}

const validDescriptor = {
  $schema: "../schemas/package.schema.json",
  schemaVersion: "2.0.0",
  id: "example-tool",
  publisher: "Example.Publisher",
  source: {
    visibility: "private",
    repository: "https://github.com/example/example-tool",
  },
  defaultChannel: "stable",
  channels: {
    stable: "1.2.3",
  },
  versions: {
    "1.2.3": {
      artifacts: {
        "win-x64": {
          target: { platform: "win", arch: "x64" },
          content: {
            filename: "example-tool-1.2.3-win-x64.sctool",
            sha256: "a".repeat(64),
            size: 12345,
          },
          delivery: {
            type: "github-release-asset",
            access: { contract: "registry-access-v1" },
            locator: {
              repository: "Simple-Connection/sctool-artifacts",
              assetId: 123456789,
            },
          },
          publishedAt: "2026-09-03T00:00:00Z",
          contract: { sctoolSpecVersion: "1.0.0" },
          signature: {
            algorithm: "ed25519",
            keyId: "example-key-1",
            scope: "sctool-submission-v1",
            submissionId: "submission-000001",
            submittedAt: "2026-09-03T00:00:00Z",
            sdkVersion: "0.1.0",
            value: "QUJDRA==",
          },
        },
      },
    },
  },
};

requireEqual(PACKAGE_DESCRIPTOR_SCHEMA_VERSION, "2.0.0", "schema version constant");
requireEqual(PACKAGE_DESCRIPTOR_DELIVERY_TYPE, "github-release-asset", "delivery type constant");
requireEqual(PACKAGE_DESCRIPTOR_ACCESS_CONTRACT, "registry-access-v1", "access contract constant");
requireEqual(PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY, "Simple-Connection/sctool-artifacts", "artifact repository constant");

const valid = validatePackageDescriptor(validDescriptor, { expectedPackageId: "example-tool" });
assertCondition(valid.ok, "valid descriptor must pass");
assertCondition(Object.isFrozen(valid.descriptor), "validated descriptor must be frozen");
assertCondition(Object.isFrozen(valid.descriptor.versions["1.2.3"].artifacts["win-x64"].content), "nested descriptor content must be frozen");
requireEqual(valid.descriptor.defaultChannel, "stable", "default channel preserved");

const parsed = parsePackageDescriptor(validDescriptor);
requireEqual(parsed.id, "example-tool", "parse descriptor id");

let threw = false;
try {
  parsePackageDescriptor({});
} catch (error) {
  threw = error instanceof RegistryPackageDescriptorError;
}
assertCondition(threw, "parsePackageDescriptor must throw RegistryPackageDescriptorError");

const unsupported = clone(validDescriptor);
unsupported.schemaVersion = "3.0.0";
requireIssue(validatePackageDescriptor(unsupported), "unsupported-schema-version", "unsupported schema");

const unknownRoot = clone(validDescriptor);
unknownRoot.unexpected = true;
requireIssue(validatePackageDescriptor(unknownRoot), "unknown-field", "unknown root field");

const missingPublisher = clone(validDescriptor);
delete missingPublisher.publisher;
requireIssue(validatePackageDescriptor(missingPublisher), "missing-field", "missing publisher");

const missingDefault = clone(validDescriptor);
missingDefault.defaultChannel = "beta";
requireIssue(validatePackageDescriptor(missingDefault), "default-channel-missing", "missing default channel");

const missingVersion = clone(validDescriptor);
missingVersion.channels.stable = "9.9.9";
requireIssue(validatePackageDescriptor(missingVersion), "channel-version-missing", "missing channel version");

const mismatchedTarget = clone(validDescriptor);
mismatchedTarget.versions["1.2.3"].artifacts["win-x64"].target.arch = "arm64";
requireIssue(validatePackageDescriptor(mismatchedTarget), "target-key-mismatch", "target key mismatch");

const wrongRepository = clone(validDescriptor);
wrongRepository.versions["1.2.3"].artifacts["win-x64"].delivery.locator.repository = "example/artifacts";
requireIssue(validatePackageDescriptor(wrongRepository), "artifact-repository-mismatch", "artifact repository mismatch");

const wrongDelivery = clone(validDescriptor);
wrongDelivery.versions["1.2.3"].artifacts["win-x64"].delivery.type = "https";
requireIssue(validatePackageDescriptor(wrongDelivery), "unsupported-delivery-type", "unsupported delivery type");

const wrongAccess = clone(validDescriptor);
wrongAccess.versions["1.2.3"].artifacts["win-x64"].delivery.access.contract = "anonymous-v1";
requireIssue(validatePackageDescriptor(wrongAccess), "invalid-access-contract", "access contract mismatch");

const legacyArtifact = clone(validDescriptor);
const legacy = legacyArtifact.versions["1.2.3"].artifacts["win-x64"];
legacy.assetName = legacy.content.filename;
requireIssue(validatePackageDescriptor(legacyArtifact), "unknown-field", "legacy flat field");

const packageIdMismatch = validatePackageDescriptor(validDescriptor, { expectedPackageId: "other-tool" });
requireIssue(packageIdMismatch, "package-id-mismatch", "package id mismatch");

const invalidDate = clone(validDescriptor);
invalidDate.versions["1.2.3"].artifacts["win-x64"].publishedAt = "2026-02-30T00:00:00Z";
requireIssue(validatePackageDescriptor(invalidDate), "invalid-value", "invalid date-time");

const lowercaseDateTime = clone(validDescriptor);
lowercaseDateTime.versions["1.2.3"].artifacts["win-x64"].publishedAt = "2026-09-03t00:00:00z";
assertCondition(validatePackageDescriptor(lowercaseDateTime).ok, "lowercase RFC3339 t/z must be accepted");

const leapSecond = clone(validDescriptor);
leapSecond.versions["1.2.3"].artifacts["win-x64"].publishedAt = "2026-09-03T00:00:60Z";
requireIssue(validatePackageDescriptor(leapSecond), "invalid-value", "leap second rejected by canonical format checker");

const yearZero = clone(validDescriptor);
yearZero.versions["1.2.3"].artifacts["win-x64"].publishedAt = "0000-01-01T00:00:00Z";
requireIssue(validatePackageDescriptor(yearZero), "invalid-value", "year zero rejected by canonical format checker");

console.log("Registry Client SDK package descriptor PASS cases=21");
