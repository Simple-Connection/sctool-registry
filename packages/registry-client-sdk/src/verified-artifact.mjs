export class RegistryVerifiedArtifactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryVerifiedArtifactError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const LEASE_BRAND = new WeakSet();

class VerifiedArtifactLease {
  #resource;

  constructor(verifiedRecord) {
    const resource = verifiedRecord?.resource;
    if (!resource || resource.state !== "VERIFIED") {
      throw new RegistryVerifiedArtifactError("invalid-verified-artifact", "verified artifact lease requires VERIFIED staging state");
    }
    resource.markReleased();
    this.#resource = resource;
    LEASE_BRAND.add(this);
    Object.freeze(this);
  }

  openReadStream() {
    try {
      return this.#resource.openReleasedReadStream();
    } catch (error) {
      if (error?.code === "artifact-disposed") {
        throw new RegistryVerifiedArtifactError("artifact-disposed", "verified artifact lease has been disposed");
      }
      throw error;
    }
  }

  async dispose() {
    try {
      await this.#resource.dispose();
    } catch (error) {
      if (error?.code === "artifact-busy") {
        throw new RegistryVerifiedArtifactError("artifact-busy", "verified artifact lease has active read streams", error.details);
      }
      throw error;
    }
  }
}

export function createVerifiedArtifactLease(verifiedRecord) {
  return new VerifiedArtifactLease(verifiedRecord);
}

export function isVerifiedArtifactLease(value) {
  return typeof value === "object" && value !== null && LEASE_BRAND.has(value);
}
