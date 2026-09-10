import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign as ed25519Sign,
} from "node:crypto";
import test from "node:test";

import {
  REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA,
  REGISTRY_DISCOVERY_ERROR_CODES,
  acceptRegistrySequence,
  createMemoryAntiRollbackStore,
  discoverVerifiedRegistry,
  enumerateVerifiedPackages,
  getVerifiedPackageView,
  projectVerifiedMarketplaceProfile,
  resolveVerifiedDefaultRelease,
  resolveVerifiedStableRelease,
  searchVerifiedPackages,
  verifyRegistryHeadEnvelope,
  verifyRegistrySnapshotBytes,
  verifyRegistryTrustEnvelope,
} from "../src/discovery.mjs";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32).toString("base64");
}

function signEnvelope(privateKey, envelope) {
  const payload = Buffer.from(canonicalJson({ schemaVersion: envelope.schemaVersion, signed: envelope.signed }), "utf8");
  return ed25519Sign(null, payload, privateKey).toString("base64");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture({ sequence = 2, revision = "a".repeat(40), profile = undefined } = {}) {
  const root = generateKeyPairSync("ed25519");
  const distribution = generateKeyPairSync("ed25519");
  const issuedAt = "2026-09-10T00:00:00Z";
  const marketplaceProfile = profile ?? {
    schemaVersion: 1,
    details: "A verified test tool.",
    features: "Search and inspect test data.",
    changelog: "Initial release.",
  };

  const trust = {
    schemaVersion: "1.0.0",
    signed: {
      scope: "sctool-registry-trust-v1",
      sequence: 4,
      issuedAt,
      rootKeyId: "root-1",
      distributionKeys: [{
        keyId: "dist-1",
        algorithm: "ed25519",
        encoding: "base64-raw-32",
        publicKey: rawPublicKey(distribution.publicKey),
        status: "active",
        validFrom: "2026-01-01T00:00:00Z",
      }],
    },
    proof: {
      algorithm: "ed25519",
      scope: "sctool-registry-trust-v1",
      keyId: "root-1",
      signature: "",
    },
  };
  trust.proof.signature = signEnvelope(root.privateKey, trust);

  const snapshot = {
    schemaVersion: "1.0.0",
    sequence,
    revision,
    generatedAt: issuedAt,
    source: { repository: "Simple-Connection/sctool-registry", commit: revision },
    registrySha256: "b".repeat(64),
    packages: {
      "alpha-tool": {
        schemaVersion: "2.0.0",
        id: "alpha-tool",
        publisher: "SimpleConnection",
        defaultChannel: "stable",
        channels: { stable: "1.2.3", beta: "1.3.0-beta.1" },
        versions: {
          "1.2.3": { artifacts: { "win32-x64": {} } },
          "1.3.0-beta.1": { artifacts: { "win32-x64": {} } },
        },
      },
      "hidden-tool": {
        schemaVersion: "2.0.0",
        id: "hidden-tool",
        publisher: "SimpleConnection",
        defaultChannel: "stable",
        channels: { stable: "2.0.0" },
        versions: { "2.0.0": { artifacts: { "win32-x64": {} } } },
      },
    },
    publishers: { SimpleConnection: { id: "SimpleConnection" } },
    marketplaceProfiles: { "alpha-tool": marketplaceProfile },
  };
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const head = {
    schemaVersion: "1.0.0",
    signed: {
      scope: "sctool-registry-head-v1",
      sequence,
      revision,
      issuedAt,
      trustSequence: trust.signed.sequence,
      signingKeyId: "dist-1",
      snapshot: {
        path: `snapshots/${revision}.json`,
        sha256: sha256(snapshotBytes),
        size: snapshotBytes.length,
      },
    },
    proof: {
      algorithm: "ed25519",
      scope: "sctool-registry-head-v1",
      keyId: "dist-1",
      signature: "",
    },
  };
  head.proof.signature = signEnvelope(distribution.privateKey, head);

  const resources = new Map([
    ["/trust.json", new Response(JSON.stringify(trust), { status: 200, headers: { "content-type": "application/json" } })],
    ["/registry-head.json", new Response(JSON.stringify(head), { status: 200, headers: { "content-type": "application/json" } })],
    [`/${head.signed.snapshot.path}`, new Response(snapshotBytes, { status: 200 })],
  ]);
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    const response = resources.get(pathname);
    return response ? response.clone() : new Response("not found", { status: 404 });
  };

  return {
    root,
    distribution,
    trust,
    head,
    snapshot,
    snapshotBytes,
    rootKeys: { "root-1": rawPublicKey(root.publicKey) },
    fetchImpl,
  };
}

test("verified trust, head, snapshot, anti-rollback, and catalog discovery succeeds", async () => {
  const data = fixture();
  const result = await discoverVerifiedRegistry({
    baseUrl: "https://registry.example/",
    trustedRootKeys: data.rootKeys,
    antiRollbackStore: createMemoryAntiRollbackStore(),
    fetchImpl: data.fetchImpl,
    now: new Date("2026-09-10T00:01:00Z"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.verification.sequence, 2);
  assert.deepEqual(enumerateVerifiedPackages(result).map((entry) => entry.id), ["alpha-tool", "hidden-tool"]);
  assert.deepEqual(enumerateVerifiedPackages(result, { marketplaceOnly: true }).map((entry) => entry.id), ["alpha-tool"]);
  assert.equal(projectVerifiedMarketplaceProfile(result, "alpha-tool").details, "A verified test tool.");
  assert.equal(getVerifiedPackageView(result, "hidden-tool").marketplaceProfile, null);
});

test("default and stable release resolution is deterministic", async () => {
  const data = fixture();
  const result = await discoverVerifiedRegistry({ baseUrl: "https://registry.example/", trustedRootKeys: data.rootKeys, antiRollbackStore: createMemoryAntiRollbackStore(), fetchImpl: data.fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(resolveVerifiedDefaultRelease(result, "alpha-tool"), resolveVerifiedStableRelease(result, "alpha-tool"));
  assert.equal(resolveVerifiedStableRelease(result, "alpha-tool").version, "1.2.3");
});

test("verified catalog search uses package and verified profile fields", async () => {
  const data = fixture();
  const result = await discoverVerifiedRegistry({ baseUrl: "https://registry.example/", trustedRootKeys: data.rootKeys, antiRollbackStore: createMemoryAntiRollbackStore(), fetchImpl: data.fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(searchVerifiedPackages(result, "inspect", { marketplaceOnly: true }).map((entry) => entry.id), ["alpha-tool"]);
  assert.deepEqual(searchVerifiedPackages(result, "missing", { marketplaceOnly: true }), []);
});

test("untrusted root key fails closed", async () => {
  const data = fixture();
  const result = await discoverVerifiedRegistry({ baseUrl: "https://registry.example/", trustedRootKeys: {}, antiRollbackStore: createMemoryAntiRollbackStore(), fetchImpl: data.fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.state, "FAIL_CLOSED");
  assert.equal(result.code, REGISTRY_DISCOVERY_ERROR_CODES.ROOT_KEY_UNTRUSTED);
});

test("tampered Root signature fails closed", async () => {
  const data = fixture();
  data.trust.proof.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyRegistryTrustEnvelope(data.trust, { trustedRootKeys: data.rootKeys }), (error) => error.code === REGISTRY_DISCOVERY_ERROR_CODES.ROOT_SIGNATURE_INVALID);
});

test("tampered distribution signature fails closed", () => {
  const data = fixture();
  const verifiedTrust = verifyRegistryTrustEnvelope(data.trust, { trustedRootKeys: data.rootKeys });
  data.head.proof.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => verifyRegistryHeadEnvelope(data.head, verifiedTrust), (error) => error.code === REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_SIGNATURE_INVALID);
});

test("snapshot digest mismatch fails closed", () => {
  const data = fixture();
  const verifiedTrust = verifyRegistryTrustEnvelope(data.trust, { trustedRootKeys: data.rootKeys });
  const verifiedHead = verifyRegistryHeadEnvelope(data.head, verifiedTrust);
  const tampered = Buffer.from(data.snapshotBytes);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => verifyRegistrySnapshotBytes(tampered, verifiedHead), (error) => error.code === REGISTRY_DISCOVERY_ERROR_CODES.SNAPSHOT_DIGEST_MISMATCH);
});

test("anti-rollback rejects older sequence and same-sequence revision conflict", async () => {
  const store = createMemoryAntiRollbackStore({ schema: REGISTRY_ANTI_ROLLBACK_STATE_SCHEMA, sequence: 5, revision: "c".repeat(40) });
  await assert.rejects(() => acceptRegistrySequence(store, { sequence: 4, revision: "b".repeat(40) }), (error) => error.code === REGISTRY_DISCOVERY_ERROR_CODES.ROLLBACK_DETECTED);
  await assert.rejects(() => acceptRegistrySequence(store, { sequence: 5, revision: "d".repeat(40) }), (error) => error.code === REGISTRY_DISCOVERY_ERROR_CODES.SEQUENCE_CONFLICT);
});

test("corrupt anti-rollback state fails closed", async () => {
  const data = fixture();
  const result = await discoverVerifiedRegistry({
    baseUrl: "https://registry.example/",
    trustedRootKeys: data.rootKeys,
    antiRollbackStore: { async load() { return {}; }, async save() {} },
    fetchImpl: data.fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, REGISTRY_DISCOVERY_ERROR_CODES.ANTI_ROLLBACK_STATE_CORRUPT);
});

test("missing Pages trust/head returns deterministic distribution inactive result", async () => {
  const result = await discoverVerifiedRegistry({
    baseUrl: "https://registry.example/",
    trustedRootKeys: {},
    antiRollbackStore: createMemoryAntiRollbackStore(),
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  assert.deepEqual({ ok: result.ok, state: result.state, code: result.code }, {
    ok: false,
    state: "DISTRIBUTION_INACTIVE",
    code: REGISTRY_DISCOVERY_ERROR_CODES.DISTRIBUTION_INACTIVE,
  });
});

test("defensive profile projection excludes malformed signed profile without becoming authoring validation", async () => {
  const data = fixture({ profile: { schemaVersion: 1, details: " ", features: "valid" } });
  const result = await discoverVerifiedRegistry({ baseUrl: "https://registry.example/", trustedRootKeys: data.rootKeys, antiRollbackStore: createMemoryAntiRollbackStore(), fetchImpl: data.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(projectVerifiedMarketplaceProfile(result, "alpha-tool"), null);
  assert.deepEqual(enumerateVerifiedPackages(result, { marketplaceOnly: true }), []);
});
