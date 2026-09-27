import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { collectTopics, FeedStore, filterByTopic, scanPosted, sortPosts, type FeedPost } from '../src/feed';
import { encodeTopic } from '../src/text';
import { readAbi } from './fixtures';

const abi = readAbi('Soapbox');
const SOAPBOX = '0x91b25f1835d6df5baa547130d88545b3d17e9fdc' as Address;
const ALICE = '0x1111111111111111111111111111111111111111' as Address;
const BOB = '0x2222222222222222222222222222222222222222' as Address;

function post(id: number, tips: bigint, topic = 'a'): FeedPost {
  return {
    id: BigInt(id),
    author: ALICE,
    topic: encodeTopic(topic),
    body: `post ${id}`,
    blockNumber: 100n + BigInt(id),
    transactionHash: '0x' as Hex,
    timestamp: 0n,
    tipsTotal: tips,
  };
}

describe('sortPosts', () => {
  it('orders by tips descending, then newest first', () => {
    const sorted = sortPosts([post(1, 5n), post(2, 10n), post(3, 5n), post(4, 0n)]);
    expect(sorted.map((p) => Number(p.id))).toEqual([2, 3, 1, 4]);
  });
});

describe('topics', () => {
  it('filters by topic and counts distinct topics', () => {
    const posts = [post(1, 0n, 'x'), post(2, 0n, 'y'), post(3, 0n, 'x')];
    expect(filterByTopic(posts, encodeTopic('x')).map((p) => Number(p.id))).toEqual([1, 3]);
    expect(filterByTopic(posts, null)).toHaveLength(3);
    expect(collectTopics(posts)).toEqual([
      { topic: encodeTopic('x'), count: 2 },
      { topic: encodeTopic('y'), count: 1 },
    ]);
  });
});

describe('scanPosted', () => {
  it('splits the range into chunks and returns every log', async () => {
    const calls: Array<[bigint, bigint]> = [];
    const client = {
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock]);
        return fromBlock <= 1005n && toBlock >= 1005n
          ? [{ args: { id: 1n, author: ALICE, topic: encodeTopic('t'), body: 'hi' }, blockNumber: 1005n, transactionHash: '0xabc' }]
          : [];
      }),
    };
    const logs = await scanPosted(client, SOAPBOX, abi, 1000n, 1025n, { chunkSize: 10n, minChunk: 2n, concurrency: 2 });
    expect(calls.sort((a, b) => Number(a[0] - b[0]))).toEqual([
      [1000n, 1009n],
      [1010n, 1019n],
      [1020n, 1025n],
    ]);
    expect(logs).toEqual([{ id: 1n, author: ALICE, topic: encodeTopic('t'), body: 'hi', blockNumber: 1005n, transactionHash: '0xabc' }]);
  });

  it('halves a failing chunk before retrying and gives up only at the minimum size', async () => {
    let failures = 0;
    const client = {
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 4n) {
          failures += 1;
          throw new Error('query returned more than 10000 results');
        }
        return [];
      }),
    };
    await expect(scanPosted(client, SOAPBOX, abi, 0n, 15n, { chunkSize: 16n, minChunk: 4n, concurrency: 1, retries: 1 })).resolves.toEqual([]);
    expect(failures).toBe(3); // 16 -> 8+8 -> 4+4+4+4
    expect(client.getLogs).toHaveBeenCalledTimes(7);
  });

  it('retries a minimum-size chunk and then surfaces the error', async () => {
    let attempts = 0;
    const client = {
      getLogs: vi.fn(async () => {
        attempts += 1;
        throw new Error('rpc down');
      }),
    };
    await expect(scanPosted(client, SOAPBOX, abi, 0n, 3n, { chunkSize: 4n, minChunk: 4n, concurrency: 1, retries: 2 })).rejects.toThrow('rpc down');
    expect(attempts).toBe(3);
  });

  it('returns nothing for an empty range', async () => {
    const client = { getLogs: vi.fn() };
    await expect(scanPosted(client, SOAPBOX, abi, 10n, 9n)).resolves.toEqual([]);
    expect(client.getLogs).not.toHaveBeenCalled();
  });
});

describe('FeedStore', () => {
  it('scans only new blocks on later syncs and refreshes tips from views', async () => {
    const scanned: Array<[bigint, bigint]> = [];
    let latest = 1010n;
    const tips = new Map<bigint, bigint>([[1n, 3n * 10n ** 18n]]);
    const client = {
      getBlockNumber: async () => latest,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        scanned.push([fromBlock, toBlock]);
        const logs = [];
        if (fromBlock <= 1005n && toBlock >= 1005n) logs.push({ args: { id: 1n, author: ALICE, topic: encodeTopic('t'), body: 'one' }, blockNumber: 1005n, transactionHash: '0x1' });
        if (fromBlock <= 1015n && toBlock >= 1015n) logs.push({ args: { id: 2n, author: BOB, topic: encodeTopic('t'), body: 'two' }, blockNumber: 1015n, transactionHash: '0x2' });
        return logs;
      },
      readContract: async ({ args }: { args: readonly unknown[] }) => {
        const id = args[0] as bigint;
        return { author: id === 1n ? ALICE : BOB, topic: encodeTopic('t'), timestamp: 1_700_000_000n + id, tipsTotal: tips.get(id) ?? 0n };
      },
    };
    const store = new FeedStore(SOAPBOX, abi, 1000n);
    const first = await store.sync(client);
    expect(first.syncedBlock).toBe(1010n);
    expect(first.posts.map((p) => [Number(p.id), p.tipsTotal])).toEqual([[1, 3n * 10n ** 18n]]);
    expect(first.posts[0].timestamp).toBe(1_700_000_001n);

    latest = 1020n;
    tips.set(2n, 9n * 10n ** 18n);
    const second = await store.sync(client);
    expect(scanned).toEqual([
      [1000n, 1010n],
      [1011n, 1020n],
    ]);
    expect(second.posts.map((p) => Number(p.id))).toEqual([2, 1]);
  });
});
