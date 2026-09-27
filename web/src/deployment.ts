// Runtime deployment configuration: loads `imd-deployment.json` and the ABI files it names.

import { isAddress, keccak256, stringToBytes, type Abi, type Address, type Hex } from 'viem';
import { EXPECTED_CHAIN_ID, EXPECTED_LAUNCH_ID, EXPECTED_SOURCE_COMMIT, MANIFEST_PATH } from './config';

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface UniswapV4Addresses {
  poolManager: Address;
  universalRouter: Address;
  quoter: Address;
  stateView: Address;
  positionManager: Address;
  permit2: Address;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: NativeCurrency;
  faucets?: string[];
  uniswapV4: UniswapV4Addresses;
}

export interface WalletAddChain {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: NativeCurrency;
  blockExplorerUrls: string[];
}

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface ManifestAsset {
  path: string;
  sha256: string;
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: ManifestAsset[];
  network?: NetworkBlock;
  walletAddChain?: WalletAddChain;
}

export interface LoadedContract extends ManifestContract {
  abi: Abi;
}

export interface Deployment {
  manifest: DeploymentManifest;
  chainId: number;
  network: NetworkBlock;
  walletAddChain: WalletAddChain | undefined;
  soapbox: LoadedContract;
  launchToken: LoadedContract;
}

export class DeploymentError extends Error {
  override name = 'DeploymentError';
}

/** JSON with object keys sorted recursively and no whitespace: the form the handoff hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Lowercase hex Keccak-256 of the canonical ABI JSON, without a 0x prefix. */
export function abiHash(abi: unknown): string {
  return keccak256(stringToBytes(canonicalJson(abi))).slice(2);
}

const HEX64 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DeploymentError(message);
}

function validateNetwork(value: unknown): NetworkBlock {
  assert(isRecord(value), 'Deployment configuration has no network block.');
  assert(typeof value.chainId === 'number', 'Network block has no numeric chainId.');
  assert(typeof value.name === 'string' && value.name, 'Network block has no name.');
  assert(isStringArray(value.rpcUrls) && value.rpcUrls.length > 0, 'Network block lists no RPC URLs.');
  assert(typeof value.explorer === 'string', 'Network block has no explorer URL.');
  assert(isRecord(value.nativeCurrency), 'Network block has no native currency.');
  assert(isRecord(value.uniswapV4), 'Network block has no Uniswap v4 addresses.');
  for (const key of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2']) {
    const address = value.uniswapV4[key];
    assert(typeof address === 'string' && isAddress(address), `Network block has an invalid ${key} address.`);
  }
  return value as unknown as NetworkBlock;
}

export function validateManifest(value: unknown): DeploymentManifest {
  assert(isRecord(value), 'Deployment configuration is not a JSON object.');
  assert(value.version === 1, 'Unsupported deployment configuration version.');
  assert(typeof value.launchId === 'string' && value.launchId, 'Deployment configuration has no launchId.');
  assert(typeof value.chainId === 'number', 'Deployment configuration has no numeric chainId.');
  assert(typeof value.sourceCommit === 'string', 'Deployment configuration has no sourceCommit.');
  assert(typeof value.attestationHash === 'string', 'Deployment configuration has no attestationHash.');
  assert(Array.isArray(value.contracts) && value.contracts.length > 0, 'Deployment configuration lists no contracts.');
  for (const contract of value.contracts) {
    assert(isRecord(contract), 'A contract entry is not an object.');
    assert(typeof contract.name === 'string' && contract.name, 'A contract entry has no name.');
    assert(typeof contract.address === 'string' && isAddress(contract.address), `Contract ${String(contract.name)} has an invalid address.`);
    assert(typeof contract.abiHash === 'string' && HEX64.test(contract.abiHash), `Contract ${String(contract.name)} has an invalid abiHash.`);
    assert(
      typeof contract.abiPath === 'string' && contract.abiPath && !contract.abiPath.includes('..') && !/^[a-z]+:/i.test(contract.abiPath) && !contract.abiPath.startsWith('/'),
      `Contract ${String(contract.name)} has an invalid abiPath.`,
    );
  }
  assert(Array.isArray(value.assets), 'Deployment configuration has no asset list.');
  if (value.network !== undefined) validateNetwork(value.network);
  return value as unknown as DeploymentManifest;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

async function fetchJson(fetchFn: FetchLike, url: string, what: string): Promise<unknown> {
  let response: FetchResponseLike;
  try {
    response = await fetchFn(url);
  } catch (error) {
    throw new DeploymentError(`Unable to load ${what} (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!response.ok) throw new DeploymentError(`Unable to load ${what} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new DeploymentError(`${what} is not valid JSON.`);
  }
}

export interface LoadDeploymentOptions {
  fetch?: FetchLike;
  manifestUrl?: string;
  baseUrl?: string;
}

/**
 * Loads the runtime deployment configuration and its ABI files, verifies each ABI against
 * the hash in the manifest and refuses a manifest that belongs to a different launch than the
 * one this bundle was built for.
 */
export async function loadDeployment(options: LoadDeploymentOptions = {}): Promise<Deployment> {
  const fetchFn: FetchLike = options.fetch ?? ((url) => fetch(url, { cache: 'no-cache' }));
  const base = options.baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  const manifestUrl = new URL(options.manifestUrl ?? MANIFEST_PATH, base).href;
  const manifest = validateManifest(await fetchJson(fetchFn, manifestUrl, 'the deployment configuration'));

  if (manifest.launchId !== EXPECTED_LAUNCH_ID) {
    throw new DeploymentError(`This build belongs to launch ${EXPECTED_LAUNCH_ID}, but the deployment configuration names ${manifest.launchId}.`);
  }
  if (manifest.sourceCommit !== EXPECTED_SOURCE_COMMIT) {
    throw new DeploymentError(`This build was made from source commit ${EXPECTED_SOURCE_COMMIT}, but the deployment configuration names ${manifest.sourceCommit}.`);
  }
  if (manifest.chainId !== EXPECTED_CHAIN_ID) {
    throw new DeploymentError(`This build targets chain ${EXPECTED_CHAIN_ID}, but the deployment configuration names ${manifest.chainId}.`);
  }
  if (!manifest.network) {
    throw new DeploymentError('The deployment configuration has no network block, so no public RPC is configured.');
  }
  if (manifest.network.chainId !== manifest.chainId) {
    throw new DeploymentError('The network block and the deployment disagree on the chain id.');
  }

  const loaded = new Map<string, LoadedContract>();
  for (const contract of manifest.contracts) {
    const abiUrl = new URL(contract.abiPath, manifestUrl).href;
    const abi = await fetchJson(fetchFn, abiUrl, `the ${contract.name} ABI`);
    if (!Array.isArray(abi)) throw new DeploymentError(`The ${contract.name} ABI is not a JSON array.`);
    const hash = abiHash(abi);
    if (hash !== contract.abiHash) {
      throw new DeploymentError(`The ${contract.name} ABI does not match the attested hash (${hash} vs ${contract.abiHash}).`);
    }
    loaded.set(contract.name, { ...contract, abi: abi as Abi });
  }

  const soapbox = loaded.get('Soapbox');
  const launchToken = loaded.get('LaunchToken');
  if (!soapbox) throw new DeploymentError('The deployment configuration has no Soapbox contract.');
  if (!launchToken) throw new DeploymentError('The deployment configuration has no LaunchToken contract.');

  return {
    manifest,
    chainId: manifest.chainId,
    network: manifest.network,
    walletAddChain: manifest.walletAddChain,
    soapbox,
    launchToken,
  };
}

export function explorerAddressUrl(deployment: Deployment, address: string): string {
  return `${deployment.network.explorer.replace(/\/$/, '')}/address/${address}`;
}

export function explorerTxUrl(deployment: Deployment, hash: string): string {
  return `${deployment.network.explorer.replace(/\/$/, '')}/tx/${hash}`;
}
