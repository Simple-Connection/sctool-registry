import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rawPublicKeyFromPrivate } from "./lib/signing.mjs";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outDir = resolve(readArg("--out") || ".");
const name = readArg("--name") || "registry-key";
if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("Invalid key file name.");

await mkdir(outDir, { recursive: true });
const { privateKey } = generateKeyPairSync("ed25519");
const privateDer = privateKey.export({ format: "der", type: "pkcs8" });
const publicRaw = rawPublicKeyFromPrivate(privateKey);

const privatePath = resolve(outDir, `${name}-private.pk8.b64`);
const publicPath = resolve(outDir, `${name}-public.raw.b64`);
await writeFile(privatePath, `${privateDer.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
await writeFile(publicPath, `${publicRaw}\n`, { encoding: "utf8", mode: 0o644 });

console.log(`Private key written to: ${privatePath}`);
console.log(`Public key written to:  ${publicPath}`);
console.log("Private key material was not printed. Keep the root private key offline and outside the repository.");
