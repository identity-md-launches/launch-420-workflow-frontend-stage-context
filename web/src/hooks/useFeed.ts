// Feed query: syncs the FeedStore against the public RPC and exposes the sorted snapshot.

import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { DEPLOYMENT_BLOCK, FEED_REFRESH_MS } from '../config';
import { asFeedClient, FeedStore, type FeedSnapshot } from '../feed';
import { describeError } from '../errors';
import { useSoapbox } from './soapbox';

export interface FeedResult {
  snapshot: FeedSnapshot | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: string | undefined;
  refresh(): Promise<void>;
}

export function useFeed(): FeedResult {
  const { deployment } = useSoapbox();
  const publicClient = usePublicClient({ chainId: deployment.chainId });
  const queryClient = useQueryClient();
  const storeRef = useRef<FeedStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = new FeedStore(deployment.soapbox.address, deployment.soapbox.abi, DEPLOYMENT_BLOCK);
  }

  const query = useQuery({
    queryKey: ['feed', deployment.chainId, deployment.soapbox.address],
    enabled: publicClient !== undefined,
    refetchInterval: FEED_REFRESH_MS,
    retry: 1,
    queryFn: async (): Promise<FeedSnapshot> => {
      if (!publicClient) throw new Error('No RPC client.');
      return storeRef.current!.sync(asFeedClient(publicClient));
    },
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['feed'] });
  }, [queryClient]);

  return {
    snapshot: query.data ?? (query.error ? storeRef.current.snapshot() : undefined),
    isLoading: query.isPending,
    isFetching: query.isFetching,
    error: query.error ? describeError(query.error) : undefined,
    refresh,
  };
}
