// Shared contract state: token address from Soapbox.token(), fees, and the connected wallet's balance/allowance.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnection, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { FEED_REFRESH_MS, WALLET_REFRESH_MS } from '../config';
import type { Deployment } from '../deployment';
import { describeError } from '../errors';

export interface ChainInfo {
  tokenAddress: Address;
  tokenMatchesManifest: boolean;
  symbol: string;
  decimals: number;
  postFee: bigint;
  minTip: bigint;
  postCount: bigint;
}

export interface WalletState {
  balance: bigint;
  allowance: bigint;
  nativeBalance: bigint;
}

export interface SoapboxContextValue {
  deployment: Deployment;
  address: Address | undefined;
  isConnected: boolean;
  chainId: number | undefined;
  onTargetChain: boolean;
  info: ChainInfo | undefined;
  infoError: string | undefined;
  infoLoading: boolean;
  wallet: WalletState | undefined;
  walletError: string | undefined;
  walletLoading: boolean;
  /** Re-reads contract state, the wallet's balances and the feed. */
  refresh(): Promise<void>;
}

const SoapboxContext = createContext<SoapboxContextValue | null>(null);

export function SoapboxProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const publicClient = usePublicClient({ chainId: deployment.chainId });
  const queryClient = useQueryClient();
  const connection = useConnection();
  const address = connection.address;
  const isConnected = connection.status === 'connected';
  const chainId = connection.chainId;
  const onTargetChain = isConnected && chainId === deployment.chainId;
  const { soapbox, launchToken } = deployment;

  const infoQuery = useQuery({
    queryKey: ['chain-info', deployment.chainId, soapbox.address],
    enabled: publicClient !== undefined,
    staleTime: 15_000,
    refetchInterval: FEED_REFRESH_MS,
    queryFn: async (): Promise<ChainInfo> => {
      if (!publicClient) throw new Error('No RPC client.');
      const readSoapbox = (functionName: string) => publicClient.readContract({ address: soapbox.address, abi: soapbox.abi, functionName });
      const [tokenAddress, postFee, minTip, postCount] = (await Promise.all([
        readSoapbox('token'),
        readSoapbox('POST_FEE'),
        readSoapbox('MIN_TIP'),
        readSoapbox('postCount'),
      ])) as [Address, bigint, bigint, bigint];
      const readToken = (functionName: string) => publicClient.readContract({ address: tokenAddress, abi: launchToken.abi, functionName });
      const [symbol, decimals] = (await Promise.all([readToken('symbol'), readToken('decimals')])) as [string, number];
      return {
        tokenAddress,
        tokenMatchesManifest: tokenAddress.toLowerCase() === launchToken.address.toLowerCase(),
        symbol,
        decimals: Number(decimals),
        postFee,
        minTip,
        postCount,
      };
    },
  });

  const tokenAddress = infoQuery.data?.tokenAddress;
  const walletQuery = useQuery({
    queryKey: ['wallet', deployment.chainId, tokenAddress, address],
    enabled: publicClient !== undefined && address !== undefined && tokenAddress !== undefined,
    refetchInterval: WALLET_REFRESH_MS,
    queryFn: async (): Promise<WalletState> => {
      if (!publicClient || !address || !tokenAddress) throw new Error('No wallet.');
      const readToken = (functionName: string, args: readonly unknown[]) =>
        publicClient.readContract({ address: tokenAddress, abi: launchToken.abi, functionName, args });
      const [balance, allowance, nativeBalance] = (await Promise.all([
        readToken('balanceOf', [address]),
        readToken('allowance', [address, soapbox.address]),
        publicClient.getBalance({ address }),
      ])) as [bigint, bigint, bigint];
      return { balance, allowance, nativeBalance };
    },
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['chain-info'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['feed'] }),
    ]);
  }, [queryClient]);

  const value = useMemo<SoapboxContextValue>(
    () => ({
      deployment,
      address,
      isConnected,
      chainId,
      onTargetChain,
      info: infoQuery.data,
      infoError: infoQuery.error ? describeError(infoQuery.error) : undefined,
      infoLoading: infoQuery.isPending,
      wallet: walletQuery.data,
      walletError: walletQuery.error ? describeError(walletQuery.error) : undefined,
      walletLoading: address !== undefined && walletQuery.isPending,
      refresh,
    }),
    [deployment, address, isConnected, chainId, onTargetChain, infoQuery.data, infoQuery.error, infoQuery.isPending, walletQuery.data, walletQuery.error, walletQuery.isPending, refresh],
  );

  return <SoapboxContext.Provider value={value}>{children}</SoapboxContext.Provider>;
}

export function useSoapbox(): SoapboxContextValue {
  const value = useContext(SoapboxContext);
  if (!value) throw new Error('useSoapbox must be used inside SoapboxProvider.');
  return value;
}
