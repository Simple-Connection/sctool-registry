import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PREFIX = "sctool-registry-";
const PARTIAL_NAME = "artifact.partial";
const VERIFIED_NAME = "artifact.verified";
const RESOURCE_TOKEN = Symbol("registry-artifact-staging-resource");

export class RegistryArtifactStagingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryArtifactStagingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class ArtifactStagingResource {
  #directory;
  #partialPath;
  #verifiedPath;
  #state = "ALLOCATED";
  #activeReaders = 0;

  constructor(token, directory) {
    if (token !== RESOURCE_TOKEN) {
      throw new RegistryArtifactStagingError("construction-forbidden", "staging resources must be allocated by the Registry SDK");
    }
    this.#directory = directory;
    this.#partialPath = join(directory, PARTIAL_NAME);
    this.#verifiedPath = join(directory, VERIFIED_NAME);
  }

  get state() {
    return this.#state;
  }

  openWriteStream() {
    if (this.#state !== "ALLOCATED") {
      throw new RegistryArtifactStagingError("invalid-state", "staging write requires ALLOCATED state", { state: this.#state });
    }
    this.#state = "WRITING";
    return createWriteStream(this.#partialPath, { flags: "wx", mode: 0o600 });
  }

  markStaged() {
    if (this.#state !== "WRITING") {
      throw new RegistryArtifactStagingError("invalid-state", "staging completion requires WRITING state", { state: this.#state });
    }
    this.#state = "STAGED";
  }

  async markVerified() {
    if (this.#state !== "STAGED") {
      throw new RegistryArtifactStagingError("invalid-state", "verification finalization requires STAGED state", { state: this.#state });
    }
    await rename(this.#partialPath, this.#verifiedPath);
    this.#state = "VERIFIED";
  }

  markReleased() {
    if (this.#state !== "VERIFIED") {
      throw new RegistryArtifactStagingError("invalid-state", "verified access release requires VERIFIED state", { state: this.#state });
    }
    this.#state = "RELEASED";
  }

  openReleasedReadStream() {
    if (this.#state !== "RELEASED") {
      const code = this.#state === "DISPOSED" ? "artifact-disposed" : "invalid-state";
      throw new RegistryArtifactStagingError(code, "artifact read access requires RELEASED state", { state: this.#state });
    }
    this.#activeReaders += 1;
    const stream = createReadStream(this.#verifiedPath);
    let released = false;
    const releaseReader = () => {
      if (released) return;
      released = true;
      this.#activeReaders -= 1;
    };
    stream.once("close", releaseReader);
    return stream;
  }

  async dispose() {
    if (this.#state === "DISPOSED") return;
    if (this.#activeReaders > 0) {
      throw new RegistryArtifactStagingError("artifact-busy", "staging resource cannot be disposed while read streams are active", {
        activeReaders: this.#activeReaders,
      });
    }
    await rm(this.#directory, { recursive: true, force: true });
    this.#state = "DISPOSED";
  }
}

export async function allocateArtifactStagingResource({ temporaryRoot = tmpdir() } = {}) {
  if (typeof temporaryRoot !== "string" || temporaryRoot.length === 0) {
    throw new RegistryArtifactStagingError("configuration-error", "temporaryRoot must be a non-empty string");
  }
  const directory = await mkdtemp(join(temporaryRoot, PREFIX));
  return new ArtifactStagingResource(RESOURCE_TOKEN, directory);
}
