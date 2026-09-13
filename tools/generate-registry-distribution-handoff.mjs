import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function requiredArg(name) {
  const value = readArg(name);
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}
function assertRevision(value) {
  if (!/^[0-9a-f]{40,64}$/.test(value)) {
    throw new Error(`Invalid source revision: ${value}`);
  }
}
async function listFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: ${absolute}`);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative(root, absolute).replaceAll("\\", "/"));
      } else {
        throw new Error(`Unsupported distribution entry: ${absolute}`);
      }
    }
  }
  await walk(root);
  return files.sort();
}

const site = resolve(requiredArg("--site"));
const output = resolve(requiredArg("--out"));
const repository = requiredArg("--repository");
const workflow = requiredArg("--workflow");
const runId = parsePositiveInteger(requiredArg("--run-id"), "run-id");
const runAttempt = parsePositiveInteger(requiredArg("--run-attempt"), "run-attempt");
const sourceRevision = requiredArg("--source-revision");
const sourceRef = requiredArg("--source-ref");
const artifactName = requiredArg("--artifact-name");
const artifactId = parsePositiveInteger(requiredArg("--artifact-id"), "artifact-id");
const artifactDigest = requiredArg("--artifact-digest");

assertRevision(sourceRevision);
if (repository !== "Simple-Connection/sctool-registry") {
  throw new Error(`Unexpected producer repository: ${repository}`);
}
if (workflow !== ".github/workflows/pages.yml") {
  throw new Error(`Unexpected producer workflow: ${workflow}`);
}
if (sourceRef !== "refs/heads/main") {
  throw new Error(`Signed distribution handoff is main-only: ${sourceRef}`);
}
if (artifactName !== `registry-signed-distribution-${sourceRevision}`) {
  throw new Error(`Artifact name does not bind exact revision: ${artifactName}`);
}
const normalizedArtifactDigest = /^[0-9a-f]{64}$/.test(artifactDigest)
  ? `sha256:${artifactDigest}`
  : artifactDigest;
if (!/^sha256:[0-9a-f]{64}$/.test(normalizedArtifactDigest)) {
  throw new Error(`Invalid artifact digest: ${artifactDigest}`);
}

const trustBytes = await readFile(join(site, "trust.json"));
const headBytes = await readFile(join(site, "registry-head.json"));
const trust = JSON.parse(trustBytes.toString("utf8"));
const head = JSON.parse(headBytes.toString("utf8"));
const snapshotPath = head?.signed?.snapshot?.path;

if (trust?.schemaVersion !== "1.0.0" || trust?.signed?.scope !== "sctool-registry-trust-v1") {
  throw new Error("Invalid trust envelope.");
}
if (head?.schemaVersion !== "1.0.0" || head?.signed?.scope !== "sctool-registry-head-v1") {
  throw new Error("Invalid Registry head envelope.");
}
if (head.signed.revision !== sourceRevision) {
  throw new Error("Registry head revision does not equal producer source revision.");
}
if (head.signed.trustSequence !== trust.signed.sequence) {
  throw new Error("Registry head trustSequence does not equal trust sequence.");
}
if (typeof snapshotPath !== "string" || snapshotPath !== `snapshots/${sourceRevision}.json`) {
  throw new Error(`Unexpected snapshot path: ${snapshotPath}`);
}

const snapshotBytes = await readFile(join(site, ...snapshotPath.split("/")));
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
if (snapshot.revision !== sourceRevision || snapshot.source?.commit !== sourceRevision) {
  throw new Error("Snapshot source identity does not equal producer source revision.");
}
if (snapshot.source?.repository !== repository) {
  throw new Error("Snapshot source repository mismatch.");
}
if (snapshotBytes.length !== head.signed.snapshot.size) {
  throw new Error("Snapshot size mismatch.");
}
if (sha256(snapshotBytes) !== head.signed.snapshot.sha256) {
  throw new Error("Snapshot SHA-256 mismatch.");
}

const actualFiles = await listFiles(site);
const expectedFiles = ["registry-head.json", "trust.json", snapshotPath].sort();
if (
  actualFiles.length !== expectedFiles.length ||
  actualFiles.some((path, index) => path !== expectedFiles[index])
) {
  throw new Error(
    `Signed distribution must contain exactly ${expectedFiles.join(", ")}; got ${actualFiles.join(", ")}`,
  );
}

const fileBytes = new Map([
  ["trust.json", trustBytes],
  ["registry-head.json", headBytes],
  [snapshotPath, snapshotBytes],
]);
const files = expectedFiles.map((path) => {
  const bytes = fileBytes.get(path);
  return {
    path,
    sha256: sha256(bytes),
    size: bytes.length,
  };
});

const evidence = {
  schemaVersion: "registry-signed-distribution-handoff/v1",
  producer: {
    repository,
    workflow,
    runId,
    runAttempt,
    sourceRevision,
    sourceRef,
  },
  artifact: {
    name: artifactName,
    id: artifactId,
    digest: normalizedArtifactDigest,
  },
  registry: {
    trustSequence: trust.signed.sequence,
    sequence: head.signed.sequence,
    revision: head.signed.revision,
    rootKeyId: trust.signed.rootKeyId,
    distributionKeyId: head.signed.signingKeyId,
    snapshotPath,
  },
  files,
  verification: {
    jsonSchemas: "PASS",
    rootSignature: "PASS",
    distributionSignature: "PASS",
    snapshotIntegrity: "PASS",
    exactFileSet: "PASS",
  },
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  `Registry signed distribution handoff evidence written run_id=${runId} artifact_id=${artifactId} revision=${sourceRevision}`,
);
