import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function assertCanonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Canonical SCTool JSON v1 only permits safe integers.");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalValue(item);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) throw new Error(`Undefined canonical JSON member: ${key}`);
      assertCanonicalValue(child);
    }
    return;
  }
  throw new Error(`Unsupported canonical JSON value type: ${typeof value}`);
}

export function canonicalJson(value) {
  assertCanonicalValue(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const body = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",");
  return `{${body}}`;
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text) {
  return sha256Bytes(Buffer.from(text, "utf8"));
}

export function privateKeyFromPkcs8Base64(value) {
  if (!value || typeof value !== "string") {
    throw new Error("Missing base64 PKCS#8 Ed25519 private key.");
  }
  return createPrivateKey({
    key: Buffer.from(value.trim(), "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function rawPublicKeyFromPrivate(privateKey) {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  if (spki.length !== ED25519_SPKI_PREFIX.length + 32 || !spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error("Private key is not an Ed25519 key.");
  }
  return spki.subarray(ED25519_SPKI_PREFIX.length).toString("base64");
}

export function publicKeyFromRawBase64(value) {
  const raw = Buffer.from(String(value).trim(), "base64");
  if (raw.length !== 32) throw new Error("Ed25519 raw public key must be exactly 32 bytes.");
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function signCanonical(privateKey, value) {
  return ed25519Sign(null, canonicalBytes(value), privateKey).toString("base64");
}

export function verifyCanonical(publicKey, value, signature) {
  return ed25519Verify(null, canonicalBytes(value), publicKey, Buffer.from(String(signature), "base64"));
}

export function signedEnvelopePayload(envelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    signed: envelope.signed,
  };
}
