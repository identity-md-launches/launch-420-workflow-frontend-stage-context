// Feed data: Posted logs scanned in chunks from the deployment block, combined with post() views.

import { getAbiItem, type Abi, type AbiEvent, type Address, type Hex, type PublicClient } from 'viem';
import { LOG_CHUNK_SIZE, LOG_CONCURRENCY, LOG_MIN_CHUNK, LOG_RETRIES, READ_BATCH_SIZE } from './config';

export interface FeedPost {
  id: bigint;
  author: Address;
  topic: Hex;
  body: string;
  blockNumber: bigint;
  transactionHash: Hex;
  timestamp: bigint;
  tipsTotal: bigint;
}

export interface PostedLog {
  id: bigint;
  author: Address;
  topic: Hex;
  body: string;
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface FeedSnapshot {
  posts: FeedPost[];
  syncedBlock: bigint | null;
}

export interface LogScanner {
  getLogs(args: { address: Address; event: AbiEvent; fromBlock: bigint; toBlock: bigint; strict: true }): Promise<unknown[]>;
}

export interface ScanOptions {
  chunkSize?: bigint;
  minChunk?: bigint;
  concurrency?: number;
  retries?: number;
}

interface RawPostedLog {
  args: { id: bigint; author: Address; topic: Hex; body: string };
  blockNumber: bigint | null;
  transactionHash: Hex | null;
}

/** Scans `Posted` logs across [fromBlock, toBlock] in bounded chunks, halving a chunk that fails and retrying. */
export async function scanPosted(
  client: LogScanner,
  address: Address,
  abi: Abi,
  fromBlock: bigint,
  toBlock: bigint,
  options: ScanOptions = {},
): Promise<PostedLog[]> {
  if (toBlock < fromBlock) return [];
  const chunkSize = options.chunkSize ?? LOG_CHUNK_SIZE;
  const minChunk = options.minChunk ?? LOG_MIN_CHUNK;
  const concurrency = options.concurrency ?? LOG_CONCURRENCY;
  const retries = options.retries ?? LOG_RETRIES;
  const item = getAbiItem({ abi, name: 'Posted' }) as { type: string } | undefined;
  if (!item || item.type !== 'event') throw new Error('The Soapbox ABI has no Posted event.');
  const event = item as AbiEvent;

  const ranges: Array<[bigint, bigint]> = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n < toBlock ? start + chunkSize - 1n : toBlock;
    ranges.push([start, end]);
  }

  async function fetchRange(start: bigint, end: bigint, attempt: number): Promise<RawPostedLog[]> {
    try {
      return (await client.getLogs({ address, event, fromBlock: start, toBlock: end, strict: true })) as RawPostedLog[];
    } catch (error) {
      const span = end - start + 1n;
      if (span > minChunk) {
        const mid = start + span / 2n;
        const [left, right] = await Promise.all([fetchRange(start, mid - 1n, 0), fetchRange(mid, end, 0)]);
        return [...left, ...right];
      }
      if (attempt < retries) return fetchRange(start, end, attempt + 1);
      throw error;
    }
  }

  const results: RawPostedLog[][] = new Array(ranges.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ranges.length) {
      const index = next;
      next += 1;
      const [start, end] = ranges[index];
      results[index] = await fetchRange(start, end, 0);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));

  return results.flat().map((log) => ({
    id: log.args.id,
    author: log.args.author,
    topic: log.args.topic,
    body: log.args.body,
    blockNumber: log.blockNumber ?? 0n,
    transactionHash: log.transactionHash ?? ('0x' as Hex),
  }));
}

export interface PostMetadata {
  author: Address;
  topic: Hex;
  timestamp: bigint;
  tipsTotal: bigint;
}

export interface MetadataReader {
  readContract(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }): Promise<unknown>;
}

/** Reads `post(uint256)` for each id in bounded groups. The transport batches each group into one request. */
export async function readPostMetadata(client: MetadataReader, address: Address, abi: Abi, ids: bigint[]): Promise<Map<bigint, PostMetadata>> {
  const result = new Map<bigint, PostMetadata>();
  for (let index = 0; index < ids.length; index += READ_BATCH_SIZE) {
    const group = ids.slice(index, index + READ_BATCH_SIZE);
    const values = await Promise.all(group.map((id) => client.readContract({ address, abi, functionName: 'post', args: [id] })));
    group.forEach((id, position) => {
      const value = values[position] as PostMetadata;
      result.set(id, { author: value.author, topic: value.topic, timestamp: value.timestamp, tipsTotal: value.tipsTotal });
    });
  }
  return result;
}

/** Highest tips first; newer posts first among equals. */
export function sortPosts(posts: readonly FeedPost[]): FeedPost[] {
  return [...posts].sort((a, b) => {
    if (a.tipsTotal !== b.tipsTotal) return a.tipsTotal > b.tipsTotal ? -1 : 1;
    return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
  });
}

export function filterByTopic(posts: readonly FeedPost[], topic: Hex | null): FeedPost[] {
  if (topic === null) return [...posts];
  const wanted = topic.toLowerCase();
  return posts.filter((post) => post.topic.toLowerCase() === wanted);
}

export interface TopicCount {
  topic: Hex;
  count: number;
}

/** Distinct topics ordered by post count, then by first appearance. */
export function collectTopics(posts: readonly FeedPost[]): TopicCount[] {
  const counts = new Map<string, TopicCount>();
  for (const post of posts) {
    const key = post.topic.toLowerCase();
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { topic: post.topic, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export type FeedClient = LogScanner & MetadataReader & { getBlockNumber(): Promise<bigint> };

/** Keeps scanned posts between refreshes so each sync only reads blocks not seen before. */
export class FeedStore {
  private readonly posts = new Map<bigint, FeedPost>();
  private nextBlock: bigint;
  private syncedBlock: bigint | null = null;

  constructor(
    private readonly address: Address,
    private readonly abi: Abi,
    fromBlock: bigint,
  ) {
    this.nextBlock = fromBlock;
  }

  async sync(client: FeedClient): Promise<FeedSnapshot> {
    const latest = await client.getBlockNumber();
    if (latest >= this.nextBlock) {
      const logs = await scanPosted(client, this.address, this.abi, this.nextBlock, latest);
      for (const log of logs) {
        const existing = this.posts.get(log.id);
        this.posts.set(log.id, {
          ...log,
          timestamp: existing?.timestamp ?? 0n,
          tipsTotal: existing?.tipsTotal ?? 0n,
        });
      }
      this.nextBlock = latest + 1n;
    }
    const ids = [...this.posts.keys()];
    if (ids.length > 0) {
      const metadata = await readPostMetadata(client, this.address, this.abi, ids);
      for (const [id, meta] of metadata) {
        const post = this.posts.get(id);
        if (post) this.posts.set(id, { ...post, timestamp: meta.timestamp, tipsTotal: meta.tipsTotal });
      }
    }
    this.syncedBlock = latest;
    return this.snapshot();
  }

  snapshot(): FeedSnapshot {
    return { posts: sortPosts([...this.posts.values()]), syncedBlock: this.syncedBlock };
  }
}

export function asFeedClient(client: PublicClient): FeedClient {
  return client as unknown as FeedClient;
}
