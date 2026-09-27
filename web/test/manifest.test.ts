import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { abiHash, buildManifest, sha256, validateManifestShape } from '../scripts/manifest.mjs';
import { readHandoff, readNetwork } from './fixtures';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ABI_DIR = join(WEB_ROOT, '..', 'docs', 'abi');

describe('manifest script', () => {
  it('hashes the pinned ABI exports to the handoff values', () => {
    for (const contract of readHandoff().contracts) {
      expect(abiHash(JSON.parse(readFileSync(join(ABI_DIR, `${contract.name}.json`), 'utf8')))).toBe(contract.abiHash);
    }
  });

  it('builds a manifest that lists every exported file except itself, with lowercase sha256', () => {
    const dist = mkdtempSync(join(tmpdir(), 'soapbox-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dist, 'imd-deployment.json'), '{}');
    const handoff = readHandoff();
    const network = readNetwork();
    const { manifest } = buildManifest({ handoff, network, distDir: dist, abiDir: ABI_DIR, write: true });
    validateManifestShape(manifest, handoff, network);
    expect(Object.keys(manifest)).toEqual(['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain']);
    const assets = manifest.assets as Array<{ path: string; sha256: string }>;
    expect(assets.map((a) => a.path)).toEqual(['abi/LaunchToken.json', 'abi/Soapbox.json', 'assets/app.js', 'index.html']);
    expect(assets.find((a) => a.path === 'index.html')?.sha256).toBe(sha256('<!doctype html><title>t</title>'));
    for (const asset of assets) expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dist, 'abi', 'Soapbox.json'))).toEqual(readFileSync(join(ABI_DIR, 'Soapbox.json')));
    expect(manifest.network).toEqual(network.network);
    expect(manifest.walletAddChain).toEqual(network.walletAddChain);
  });

  it('rejects an ABI export whose hash differs from the handoff', () => {
    const dist = mkdtempSync(join(tmpdir(), 'soapbox-dist-'));
    const abiDir = mkdtempSync(join(tmpdir(), 'soapbox-abi-'));
    writeFileSync(join(dist, 'index.html'), 'x');
    for (const name of ['LaunchToken', 'Soapbox']) writeFileSync(join(abiDir, `${name}.json`), '[]');
    expect(() => buildManifest({ handoff: readHandoff(), network: readNetwork(), distDir: dist, abiDir, write: true })).toThrow(/ABI hash mismatch/);
  });

  it('rejects unexpected top-level keys', () => {
    const handoff = readHandoff();
    const network = readNetwork();
    const dist = mkdtempSync(join(tmpdir(), 'soapbox-dist-'));
    writeFileSync(join(dist, 'index.html'), 'x');
    const { manifest } = buildManifest({ handoff, network, distDir: dist, abiDir: ABI_DIR, write: true });
    expect(() => validateManifestShape({ ...manifest, router: '0x1' }, handoff, network)).toThrow(/Unexpected top-level key/);
  });
});
