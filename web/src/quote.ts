// Indicative ETH to SOAP quote from the chain's Uniswap v4 quoter. Read-only: this page never swaps.

import { zeroAddress, type Address, type PublicClient } from 'viem';
import { POOL } from './config';

/** Minimal local interface for IV4Quoter.quoteExactInputSingle. No address lives here. */
export const V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** Launch pool key: paired currency (native ETH as the zero address) against the token, sorted ascending. */
export function buildPoolKey(token: Address, paired: Address = POOL.pairedCurrency): PoolKey {
  const [currency0, currency1] =
    paired === zeroAddress || paired.toLowerCase() < token.toLowerCase() ? [paired, token] : [token, paired];
  return { currency0, currency1, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: POOL.hooks };
}

export interface QuoteResult {
  amountIn: bigint;
  amountOut: bigint;
}

/** Simulates quoteExactInputSingle for `amountIn` of the paired currency into the token. Never a transaction. */
export async function quotePairedToToken(client: PublicClient, quoter: Address, token: Address, amountIn: bigint): Promise<QuoteResult> {
  const poolKey = buildPoolKey(token);
  const zeroForOne = poolKey.currency0.toLowerCase() !== token.toLowerCase();
  const { result } = await client.simulateContract({
    address: quoter,
    abi: V4_QUOTER_ABI,
    functionName: 'quoteExactInputSingle',
    args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: '0x' }],
  });
  return { amountIn, amountOut: result[0] };
}
