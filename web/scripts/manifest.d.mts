export function canonicalJson(value: unknown): string;
export function abiHash(abi: unknown): string;
export function sha256(bytes: Uint8Array | string): string;
export function buildManifest(options: { handoff: unknown; network: unknown; distDir: string; abiDir: string; write: boolean }): {
  manifest: Record<string, unknown>;
  totalBytes: number;
};
export function validateManifestShape(manifest: unknown, handoff: unknown, network: unknown): void;
