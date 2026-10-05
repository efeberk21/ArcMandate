export type Provenance = { gitCommit: string; dirty: boolean; sourceTreeSha256: string; sourceScope: string; trackedPatchSha256: string; lockfileSha256: string; artifactSha256: string; foundrySettingsSha256: string; compiler: unknown; settings: unknown };
export function sourceProvenance(): Provenance;
