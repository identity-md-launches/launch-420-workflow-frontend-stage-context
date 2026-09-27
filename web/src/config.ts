// Build-time configuration.
//
// Addresses, chain id, ABIs and public RPC URLs are NOT defined here. The app reads them at
// runtime from `imd-deployment.json` next to `index.html` (see `deployment.ts`), which the
// build generates from `web/deployment/handoff.json` and `web/deployment/network.json`.
// This module only carries values the manifest schema does not allow (the pool key and the
// deployment block) plus identifiers used to refuse a manifest from a different launch.

import { zeroAddress, type Address } from 'viem';
import handoff from '../deployment/handoff.json';

/** Runtime deployment configuration, relative to index.html so gateway subpaths work. */
export const MANIFEST_PATH = './imd-deployment.json';

/** Identity of the handoff this bundle was built against. A manifest for another launch is refused. */
export const EXPECTED_LAUNCH_ID: string = handoff.launchId;
export const EXPECTED_SOURCE_COMMIT: string = handoff.sourceCommit;
export const EXPECTED_CHAIN_ID: number = handoff.chainId;

/** First block that can contain Soapbox events: the deployment block from the handoff. */
export const DEPLOYMENT_BLOCK: bigint = BigInt(Math.min(...handoff.contracts.map((c) => c.blockNumber)));

/** Launch pool parameters from the attested manifest. The pool has no hook. */
export const POOL = {
  fee: handoff.manifest.pool.fee,
  tickSpacing: handoff.manifest.pool.tickSpacing,
  pairedCurrency: handoff.manifest.pool.pairedCurrency as Address,
  hooks: zeroAddress as Address,
} as const;

/** Token metadata from the manifest, used only as display fallback until the chain answers. */
export const TOKEN_FALLBACK = {
  symbol: handoff.manifest.token.symbol,
  decimals: handoff.manifest.token.decimals,
} as const;

/** Log scanning: chunk size in blocks, minimum chunk after adaptive halving, parallel requests. */
export const LOG_CHUNK_SIZE = 10_000n;
export const LOG_MIN_CHUNK = 500n;
export const LOG_CONCURRENCY = 3;
export const LOG_RETRIES = 3;

/** Reads of per-post metadata are issued in groups of this size. */
export const READ_BATCH_SIZE = 25;

/** How often the feed and wallet balances re-poll, in milliseconds. */
export const FEED_REFRESH_MS = 60_000;
export const WALLET_REFRESH_MS = 20_000;

/** Sample size for the indicative ETH to SOAP quote shown beside the balance. */
export const QUOTE_SAMPLE_ETH = 10n ** 16n; // 0.01 ETH

/** Contract limits mirrored for client-side validation; the contract remains authoritative. */
export const MAX_BODY_BYTES = 280;
export const MAX_TOPIC_BYTES = 32;
