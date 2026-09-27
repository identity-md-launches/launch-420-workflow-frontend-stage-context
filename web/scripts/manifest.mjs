#!/usr/bin/env node
// Builds (or, with --check, verifies) dist/imd-deployment.json after `vite build`.
//
// Inputs:  web/deployment/handoff.json  (workflow deployment handoff, copied verbatim)
//          web/deployment/network.json  (vetted chain table, copied verbatim)
//          docs/abi/<Contract>.json     (implementation-derived ABIs at the pinned source commit)
// Output:  dist/abi/<Contract>.json     (byte-for-byte copies of the ABI exports)
//          dist/imd-deployment.json     (runtime deployment configuration + asset inventory)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToBytes } from 'viem';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(WEB_ROOT, '..');
const DIST = join(REPO_ROOT, 'dist');
const MANIFEST_NAME = 'imd-deployment.json';
const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const EXPORT_BUDGET_BYTES = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget
const ALLOWED_KEYS = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain'];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function abiHash(abi) {
  return keccak256(stringToBytes(canonicalJson(abi))).slice(2);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else if (entry.isFile()) files.push(relative(base, full).split(sep).join('/'));
  }
  return files.sort();
}

export function buildManifest({ handoff, network, distDir, abiDir, write }) {
  if (!existsSync(join(distDir, 'index.html'))) throw new Error(`${distDir}/index.html is missing; run vite build first.`);

  const contracts = handoff.contracts.map((contract) => {
    const abiPath = `abi/${contract.name}.json`;
    const source = join(abiDir, `${contract.name}.json`);
    if (!existsSync(source)) throw new Error(`Missing ABI export ${source}`);
    const bytes = readFileSync(source);
    const abi = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(abi)) throw new Error(`${source} is not a JSON array`);
    const hash = abiHash(abi);
    if (hash !== contract.abiHash) throw new Error(`ABI hash mismatch for ${contract.name}: ${hash} != ${contract.abiHash}`);
    if (write) {
      mkdirSync(join(distDir, 'abi'), { recursive: true });
      writeFileSync(join(distDir, abiPath), bytes);
    } else if (!existsSync(join(distDir, abiPath)) || !readFileSync(join(distDir, abiPath)).equals(bytes)) {
      throw new Error(`dist/${abiPath} differs from ${source}`);
    }
    return { name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath };
  });

  const files = walk(distDir).filter((path) => path !== MANIFEST_NAME);
  if (files.length > MAX_ASSETS) throw new Error(`${files.length} exported files exceed the ${MAX_ASSETS} asset limit`);
  let total = 0;
  const assets = files.map((path) => {
    const bytes = readFileSync(join(distDir, path));
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${path} exceeds 8 MiB`);
    total += bytes.length;
    return { path, sha256: sha256(bytes) };
  });
  if (total > EXPORT_BUDGET_BYTES) throw new Error(`Export is ${total} bytes, above the ${EXPORT_BUDGET_BYTES} byte budget`);
  for (const contract of contracts) {
    if (!assets.some((asset) => asset.path === contract.abiPath)) throw new Error(`${contract.abiPath} is not in the asset list`);
  }

  const manifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts,
    assets,
  };
  if (network) {
    manifest.network = network.network;
    if (network.walletAddChain) manifest.walletAddChain = network.walletAddChain;
  }
  return { manifest, totalBytes: total };
}

export function validateManifestShape(manifest, handoff, network) {
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_KEYS.includes(key)) throw new Error(`Unexpected top-level key "${key}" in ${MANIFEST_NAME}`);
  }
  if (manifest.version !== 1) throw new Error('version must be 1');
  if (manifest.launchId !== handoff.launchId) throw new Error('launchId differs from the handoff');
  if (manifest.chainId !== handoff.chainId) throw new Error('chainId differs from the handoff');
  if (manifest.sourceCommit !== handoff.sourceCommit) throw new Error('sourceCommit differs from the handoff');
  if (manifest.attestationHash !== handoff.attestationHash) throw new Error('attestationHash differs from the handoff');
  if (manifest.contracts.length !== handoff.contracts.length) throw new Error('contract set differs from the handoff');
  for (const expected of handoff.contracts) {
    const actual = manifest.contracts.find((c) => c.name === expected.name);
    if (!actual) throw new Error(`contract ${expected.name} missing`);
    if (actual.address !== expected.address) throw new Error(`address differs for ${expected.name}`);
    if (actual.abiHash !== expected.abiHash) throw new Error(`abiHash differs for ${expected.name}`);
    if (!/^abi\/[A-Za-z0-9_]+\.json$/.test(actual.abiPath)) throw new Error(`abiPath is not a plain relative path for ${expected.name}`);
  }
  for (const asset of manifest.assets) {
    if (asset.path.startsWith('/') || asset.path.includes('..') || /^[a-z]+:/i.test(asset.path)) throw new Error(`asset path ${asset.path} is not relative`);
    if (!/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error(`asset ${asset.path} has a malformed sha256`);
  }
  if (network) {
    if (canonicalJson(manifest.network) !== canonicalJson(network.network)) throw new Error('network block differs from network.json');
    if (network.walletAddChain && canonicalJson(manifest.walletAddChain) !== canonicalJson(network.walletAddChain)) {
      throw new Error('walletAddChain differs from network.json');
    }
  } else if (manifest.network || manifest.walletAddChain) {
    throw new Error('network keys present without network.json');
  }
}

function main() {
  const check = process.argv.includes('--check');
  const handoff = JSON.parse(readFileSync(join(WEB_ROOT, 'deployment', 'handoff.json'), 'utf8'));
  const networkPath = join(WEB_ROOT, 'deployment', 'network.json');
  const network = existsSync(networkPath) ? JSON.parse(readFileSync(networkPath, 'utf8')) : null;
  const abiDir = join(REPO_ROOT, 'docs', 'abi');
  const manifestPath = join(DIST, MANIFEST_NAME);

  const { manifest, totalBytes } = buildManifest({ handoff, network, distDir: DIST, abiDir, write: !check });
  validateManifestShape(manifest, handoff, network);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;

  if (check) {
    if (!existsSync(manifestPath)) throw new Error(`${manifestPath} does not exist`);
    const existing = readFileSync(manifestPath, 'utf8');
    if (existing !== text) throw new Error(`${MANIFEST_NAME} is stale; rerun the build or "npm run manifest"`);
    console.log(`OK: ${MANIFEST_NAME} matches ${manifest.assets.length} assets (${totalBytes} bytes) and the handoff.`);
  } else {
    writeFileSync(manifestPath, text);
    console.log(`Wrote ${MANIFEST_NAME}: ${manifest.assets.length} assets, ${totalBytes} bytes, ${manifest.contracts.length} contracts.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
