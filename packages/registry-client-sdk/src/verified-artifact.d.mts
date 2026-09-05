import type { VerifiedArtifactRecord } from "./artifact-integrity.mjs";

export interface VerifiedArtifactReadStream extends AsyncIterable<Uint8Array> {
  destroy(error?: Error): void;
}

export interface VerifiedArtifactLease {
  openReadStream(): VerifiedArtifactReadStream;
  dispose(): Promise<void>;
}

export declare class RegistryVerifiedArtifactError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export declare function createVerifiedArtifactLease(record: VerifiedArtifactRecord): VerifiedArtifactLease;
export declare function isVerifiedArtifactLease(value: unknown): value is VerifiedArtifactLease;
