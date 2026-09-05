export type StagedArtifactState = "ALLOCATED" | "WRITING" | "STAGED" | "VERIFIED" | "RELEASED" | "DISPOSED";

export declare class RegistryArtifactStagingError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface InternalArtifactStagingResource {
  readonly state: StagedArtifactState;
  openWriteStream(): unknown;
  markStaged(): void;
  markVerified(): Promise<void>;
  markReleased(): void;
  openReleasedReadStream(): unknown;
  dispose(): Promise<void>;
}

export declare function allocateArtifactStagingResource(options?: {
  readonly temporaryRoot?: string;
}): Promise<InternalArtifactStagingResource>;
