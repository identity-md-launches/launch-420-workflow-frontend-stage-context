// One transaction at a time: simulate, ask the wallet to sign, wait for the receipt, report each phase.

import { useCallback, useState } from 'react';
import { usePublicClient, useWalletClient } from 'wagmi';
import type { Abi, Address, Hex } from 'viem';
import { describeError } from '../errors';
import { useSoapbox } from './soapbox';

export type TxPhase = 'idle' | 'simulating' | 'signing' | 'pending' | 'confirmed' | 'failed';

export interface TxState {
  phase: TxPhase;
  /** Short description of the action, e.g. "Approve 100 SOAP". */
  description?: string;
  hash?: Hex;
  error?: string;
}

export interface TxRequest {
  description: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  onConfirmed?: () => void | Promise<void>;
}

export interface TxAction {
  state: TxState;
  busy: boolean;
  run(request: TxRequest): Promise<boolean>;
  reset(): void;
}

export function useTxAction(symbol = 'SOAP'): TxAction {
  const { deployment } = useSoapbox();
  const publicClient = usePublicClient({ chainId: deployment.chainId });
  const { data: walletClient } = useWalletClient();
  const [state, setState] = useState<TxState>({ phase: 'idle' });

  const run = useCallback(
    async (request: TxRequest): Promise<boolean> => {
      const { description } = request;
      if (!publicClient || !walletClient) {
        setState({ phase: 'failed', description, error: 'Connect a wallet first.' });
        return false;
      }
      setState({ phase: 'simulating', description });
      try {
        const { request: prepared } = await publicClient.simulateContract({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
          account: walletClient.account,
        });
        setState({ phase: 'signing', description });
        const hash = await walletClient.writeContract(prepared);
        setState({ phase: 'pending', description, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          setState({ phase: 'failed', description, hash, error: 'The transaction was mined but reverted. Nothing changed.' });
          return false;
        }
        setState({ phase: 'confirmed', description, hash });
        await request.onConfirmed?.();
        return true;
      } catch (error) {
        setState((previous) => ({ phase: 'failed', description, hash: previous.hash, error: describeError(error, symbol) }));
        return false;
      }
    },
    [publicClient, walletClient, symbol],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  const busy = state.phase === 'simulating' || state.phase === 'signing' || state.phase === 'pending';
  return { state, busy, run, reset };
}
