// Wallet network switching with the EIP-3085 add-chain fallback.

import { numberToHex } from 'viem';
import type { WalletAddChain } from './deployment';

/** EIP-3326: the wallet does not know the requested chain. */
export const UNRECOGNIZED_CHAIN_CODE = 4902;

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function codesOf(error: unknown): number[] {
  if (!error || typeof error !== 'object') return [];
  const record = error as Record<string, unknown>;
  const codes: unknown[] = [record.code];
  const data = record.data;
  if (data && typeof data === 'object') {
    const dataRecord = data as Record<string, unknown>;
    codes.push(dataRecord.code);
    const original = dataRecord.originalError;
    if (original && typeof original === 'object') codes.push((original as Record<string, unknown>).code);
  }
  return codes.filter((code): code is number => typeof code === 'number');
}

/** True when a `wallet_switchEthereumChain` failure means the wallet has not added the chain. */
export function isUnrecognizedChainError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (codesOf(current).includes(UNRECOGNIZED_CHAIN_CODE)) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && /unrecognized chain|unknown chain|not been added|4902/i.test(message)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export type SwitchOutcome = 'switched' | 'added';

/**
 * Asks the wallet to switch to `chainId`. When the wallet reports the chain as unknown and
 * `addChain` parameters are available, offers `wallet_addEthereumChain` with exactly those
 * parameters and then switches again.
 */
export async function switchOrAddChain(provider: Eip1193Provider, chainId: number, addChain?: WalletAddChain): Promise<SwitchOutcome> {
  const hexChainId = numberToHex(chainId);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
    return 'switched';
  } catch (error) {
    if (!addChain || !isUnrecognizedChainError(error)) throw error;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [addChain] });
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
  return 'added';
}
