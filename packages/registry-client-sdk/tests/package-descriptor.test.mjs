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

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected=${expected} actual=${actual}`);
}

function truthy(value, label) {
  if (!value) throw new Error(label);
}

function requireIssue(result, code, label) {
  truthy(!result.ok, `${label}: expected validation failure`);
  truthy(result.issues.some((entry) => entry.code === code), `${label}: missing issue ${code}`);
}

function artifact({ cache = true, redistribution = true } = {}) {
  return {
    target: { platform: "win", arch: "x64" },
    content: {
      filename: "example-tool-1.2.3-win-x64.sctool",
      sha256: "a".repeat(64),
      size: 12345,
    },
    delivery: {
      type: "github-release-asset",
      access: { contract: "registry-public-integrity-v1" },
      origin: {
        repository: "ExamplePublisher/example-tool",
        releaseId: 55,
        assetId: 101,
      },
      ...(cache ? {
        cache: {
          repository: "Simple-Connection/sctool-artifacts",
          releaseId: 77,
          assetId: 201,
        },
      } : {}),
    },
    publication: {
      marketplace: true,
      publicRedistribution: redistribution,
    },
    publishedAt: "2026-09-03T00:00:00Z",
    contract: { sctoolSpecVersion: "1.0.0" },
    signature: {
      algorithm: "ed25519",
      keyId: "example-key-1",
      scope: "sctool-submission-v2",
      submissionId: "submission-000001",
      submittedAt: "2026-09-03T00:00:00Z",
      sdkVersion: "0.2.0",
      value: "QUJDRA==",
    },
  };
}

const validDescriptor = {
  $schema: "../schemas/package.schema.json",
  schemaVersion: "3.0.0",
  id: "example-tool",
  publisher: "Example.Publisher",
  source: {
    visibility: "private",
    repository: "https://github.com/example/example-tool",
  },
  defaultChannel: "stable",
  channels: { stable: "1.2.3" },
  versions: {
    "1.2.3": {
      artifacts: {
        "win-x64": artifact(),
      },
    },
  },
};

equal(PACKAGE_DESCRIPTOR_SCHEMA_VERSION, "3.0.0", "schema version constant");
equal(PACKAGE_DESCRIPTOR_DELIVERY_TYPE, "github-release-asset", "delivery type constant");
equal(PACKAGE_DESCRIPTOR_ACCESS_CONTRACT, "registry-public-integrity-v1", "access contract constant");
equal(PACKAGE_DESCRIPTOR_ARTIFACT_REPOSITORY, "Simple-Connection/sctool-artifacts", "cache repository constant");

const valid = validatePackageDescriptor(validDescriptor, { expectedPackageId: "example-tool" });
truthy(valid.ok, "valid v3 descriptor must pass");
truthy(Object.isFrozen(valid.descriptor), "validated descriptor must be frozen");
truthy(Object.isFrozen(valid.descriptor.versions["1.2.3"].artifacts["win-x64"].delivery.origin), "origin locator frozen");
truthy(Object.isFrozen(valid.descriptor.versions["1.2.3"].artifacts["win-x64"].delivery.cache), "cache locator frozen");

const parsed = parsePackageDescriptor(validDescriptor);
equal(parsed.id, "example-tool", "parse descriptor id");

let threw = false;
try { parsePackageDescriptor({}); } catch (error) { threw = error instanceof RegistryPackageDescriptorError; }
truthy(threw, "parsePackageDescriptor throws typed error");

const unsupported = clone(validDescriptor);
unsupported.schemaVersion = "2.0.0";
requireIssue(validatePackageDescriptor(unsupported), "unsupported-schema-version", "legacy schema rejected");

const noOrigin = clone(validDescriptor);
delete noOrigin.versions["1.2.3"].artifacts["win-x64"].delivery.origin;
requireIssue(validatePackageDescriptor(noOrigin), "missing-field", "origin required");

const badOriginRelease = clone(validDescriptor);
delete badOriginRelease.versions["1.2.3"].artifacts["win-x64"].delivery.origin.releaseId;
requireIssue(validatePackageDescriptor(badOriginRelease), "missing-field", "origin releaseId required");

const arbitraryOrigin = clone(validDescriptor);
arbitraryOrigin.versions["1.2.3"].artifacts["win-x64"].delivery.origin.repository = "AnotherPublisher/custom-release-repo";
truthy(validatePackageDescriptor(arbitraryOrigin).ok, "publisher origin repository is not central-cache constrained");

const wrongCacheRepo = clone(validDescriptor);
wrongCacheRepo.versions["1.2.3"].artifacts["win-x64"].delivery.cache.repository = "OtherOrg/other-cache";
requireIssue(validatePackageDescriptor(wrongCacheRepo), "artifact-cache-repository-mismatch", "cache repository fixed");

const noConsent = clone(validDescriptor);
noConsent.versions["1.2.3"].artifacts["win-x64"].publication.publicRedistribution = false;
requireIssue(validatePackageDescriptor(noConsent), "cache-redistribution-consent-required", "cache requires signed redistribution consent");

const originOnlyNoConsent = clone(validDescriptor);
delete originOnlyNoConsent.versions["1.2.3"].artifacts["win-x64"].delivery.cache;
originOnlyNoConsent.versions["1.2.3"].artifacts["win-x64"].publication.publicRedistribution = false;
truthy(validatePackageDescriptor(originOnlyNoConsent).ok, "origin-only publication may decline central redistribution");

const historicalCache = clone(validDescriptor);
historicalCache.versions["1.2.2"] = {
  artifacts: {
    "win-x64": artifact(),
  },
};
requireIssue(validatePackageDescriptor(historicalCache), "historical-cache-forbidden", "historical central cache forbidden");

const legacyScope = clone(validDescriptor);
legacyScope.versions["1.2.3"].artifacts["win-x64"].signature.scope = "sctool-submission-v1";
requireIssue(validatePackageDescriptor(legacyScope), "invalid-value", "legacy signature scope rejected");

const wrongAccess = clone(validDescriptor);
wrongAccess.versions["1.2.3"].artifacts["win-x64"].delivery.access.contract = "registry-access-v1";
requireIssue(validatePackageDescriptor(wrongAccess), "invalid-access-contract", "private access contract rejected");

const wrongDelivery = clone(validDescriptor);
wrongDelivery.versions["1.2.3"].artifacts["win-x64"].delivery.type = "https";
requireIssue(validatePackageDescriptor(wrongDelivery), "unsupported-delivery-type", "unknown delivery rejected");

const wrongMarketplaceIntent = clone(validDescriptor);
wrongMarketplaceIntent.versions["1.2.3"].artifacts["win-x64"].publication.marketplace = false;
requireIssue(validatePackageDescriptor(wrongMarketplaceIntent), "invalid-publication-intent", "marketplace intent must be explicit");

const targetMismatch = clone(validDescriptor);
targetMismatch.versions["1.2.3"].artifacts["win-x64"].target.arch = "arm64";
requireIssue(validatePackageDescriptor(targetMismatch), "target-key-mismatch", "target identity mismatch");

const channelMissing = clone(validDescriptor);
channelMissing.defaultChannel = "beta";
requireIssue(validatePackageDescriptor(channelMissing), "default-channel-missing", "default channel must exist");

const versionMissing = clone(validDescriptor);
versionMissing.channels.stable = "9.9.9";
requireIssue(validatePackageDescriptor(versionMissing), "channel-version-missing", "channel version must exist");

console.log("Registry Client SDK package descriptor v3 PASS cases=21");
