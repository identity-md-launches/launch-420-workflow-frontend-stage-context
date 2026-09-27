// Test fixtures built from the real handoff, network table and ABI exports.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Abi, Address } from 'viem';
import type { Deployment, DeploymentManifest, NetworkBlock, WalletAddChain } from '../src/deployment';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(WEB_ROOT, '..');

export const FAKE_RPC_URL = 'http://fake.chain/rpc';

export interface Handoff {
  chainId: number;
  launchId: string;
  sourceCommit: string;
  attestationHash: string;
  contracts: Array<{ name: string; address: Address; abiHash: string; blockNumber: number }>;
}

export function readHandoff(): Handoff {
  return JSON.parse(readFileSync(join(WEB_ROOT, 'deployment', 'handoff.json'), 'utf8')) as Handoff;
}

export function readNetwork(): { network: NetworkBlock; walletAddChain: WalletAddChain } {
  return JSON.parse(readFileSync(join(WEB_ROOT, 'deployment', 'network.json'), 'utf8'));
}

export function readAbi(name: string): Abi {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'docs', 'abi', `${name}.json`), 'utf8')) as Abi;
}

export function buildManifest(overrides: Partial<DeploymentManifest> = {}): DeploymentManifest {
  const handoff = readHandoff();
  const network = readNetwork();
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((contract) => ({
      name: contract.name,
      address: contract.address,
      abiHash: contract.abiHash,
      abiPath: `abi/${contract.name}.json`,
    })),
    assets: [],
    network: network.network,
    walletAddChain: network.walletAddChain,
    ...overrides,
  };
}

/** A Deployment whose RPC points at the fake chain used by the interaction tests. */
export function buildDeployment(): Deployment {
  const manifest = buildManifest({ network: { ...readNetwork().network, rpcUrls: [FAKE_RPC_URL] } });
  const contract = (name: string) => {
    const entry = manifest.contracts.find((c) => c.name === name);
    if (!entry) throw new Error(`no ${name}`);
    return { ...entry, abi: readAbi(name) };
  };
  return {
    manifest,
    chainId: manifest.chainId,
    network: manifest.network!,
    walletAddChain: manifest.walletAddChain,
    soapbox: contract('Soapbox'),
    launchToken: contract('LaunchToken'),
  };
}
