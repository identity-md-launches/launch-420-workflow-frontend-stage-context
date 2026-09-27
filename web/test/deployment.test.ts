import { describe, expect, it } from 'vitest';
import { abiHash, canonicalJson, loadDeployment, type DeploymentManifest, type FetchLike } from '../src/deployment';
import { buildManifest, readAbi, readHandoff } from './fixtures';

function fetchFor(manifest: DeploymentManifest, abis: Record<string, unknown> = {}): FetchLike {
  return async (url: string) => {
    const path = new URL(url).pathname;
    let body: unknown;
    if (path.endsWith('/imd-deployment.json')) body = manifest;
    else if (path.endsWith('/abi/Soapbox.json')) body = abis.Soapbox ?? readAbi('Soapbox');
    else if (path.endsWith('/abi/LaunchToken.json')) body = abis.LaunchToken ?? readAbi('LaunchToken');
    else return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => body };
  };
}

describe('abiHash', () => {
  it('matches the handoff hashes for the pinned ABI exports', () => {
    for (const contract of readHandoff().contracts) {
      expect(abiHash(readAbi(contract.name))).toBe(contract.abiHash);
    }
  });

  it('canonicalises key order and whitespace', () => {
    expect(canonicalJson({ b: [1, { z: null, a: 'x' }], a: true })).toBe('{"a":true,"b":[1,{"a":"x","z":null}]}');
  });
});

describe('loadDeployment', () => {
  it('loads the manifest and ABIs relative to the page', async () => {
    const deployment = await loadDeployment({ fetch: fetchFor(buildManifest()), baseUrl: 'https://gateway.example/ipfs/QmX/index.html' });
    expect(deployment.chainId).toBe(11155111);
    expect(deployment.soapbox.address).toBe('0x91b25f1835d6df5baa547130d88545b3d17e9fdc');
    expect(deployment.launchToken.address).toBe('0xb7441f29c2e22dfc83f77d9e59686262476a9259');
    expect(deployment.soapbox.abi.some((item) => item.type === 'event' && item.name === 'Posted')).toBe(true);
    expect(deployment.network.uniswapV4.quoter).toBe('0x61b3f2011a92d183c7dbadbda940a7555ccf9227');
    expect(deployment.walletAddChain?.chainId).toBe('0xaa36a7');
  });

  it('refuses an ABI whose hash does not match the manifest', async () => {
    const tampered = [...readAbi('Soapbox'), { type: 'function', name: 'sweep', inputs: [], outputs: [], stateMutability: 'nonpayable' }];
    await expect(loadDeployment({ fetch: fetchFor(buildManifest(), { Soapbox: tampered }), baseUrl: 'http://localhost/' })).rejects.toThrow(/does not match the attested hash/);
  });

  it('refuses a manifest from a different launch or commit', async () => {
    await expect(loadDeployment({ fetch: fetchFor(buildManifest({ launchId: 'other' })), baseUrl: 'http://localhost/' })).rejects.toThrow(/belongs to launch/);
    await expect(loadDeployment({ fetch: fetchFor(buildManifest({ sourceCommit: 'deadbeef' })), baseUrl: 'http://localhost/' })).rejects.toThrow(/source commit/);
    await expect(loadDeployment({ fetch: fetchFor(buildManifest({ chainId: 1 })), baseUrl: 'http://localhost/' })).rejects.toThrow(/targets chain/);
  });

  it('refuses a manifest without a network block or with a traversal abiPath', async () => {
    await expect(loadDeployment({ fetch: fetchFor(buildManifest({ network: undefined })), baseUrl: 'http://localhost/' })).rejects.toThrow(/no network block/);
    const manifest = buildManifest();
    manifest.contracts[0] = { ...manifest.contracts[0], abiPath: '../abi/LaunchToken.json' };
    await expect(loadDeployment({ fetch: fetchFor(manifest), baseUrl: 'http://localhost/' })).rejects.toThrow(/invalid abiPath/);
  });

  it('reports a missing file plainly', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 404, json: async () => null });
    await expect(loadDeployment({ fetch: fetchFn, baseUrl: 'http://localhost/' })).rejects.toThrow(/HTTP 404/);
  });
});
