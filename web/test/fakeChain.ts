// An in-memory JSON-RPC "chain" that models SOAP and Soapbox closely enough to drive the UI.
// It answers the fetch() calls made by viem's http transport and by the wagmi mock connector.

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  numberToHex,
  stringToHex,
  zeroAddress,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from 'viem';
import { V4_QUOTER_ABI } from '../src/quote';

export interface FakePost {
  id: bigint;
  author: Address;
  topic: Hex;
  body: string;
  timestamp: bigint;
  tipsTotal: bigint;
  blockNumber: bigint;
  txHash: Hex;
}

export interface SentTransaction {
  from: Address;
  to: Address;
  functionName: string;
  args: readonly unknown[];
  hash: Hex;
}

interface RpcError {
  code: number;
  message: string;
  data?: Hex;
}

const ZERO32: Hex = `0x${'0'.repeat(64)}`;
const EMPTY_BLOOM: Hex = `0x${'0'.repeat(512)}`;
const POST_FEE = 100n * 10n ** 18n;
const MIN_TIP = 10n ** 18n;

function rpcError(code: number, message: string, data?: Hex): RpcError {
  return { code, message, data };
}

function abiFunction(abi: Abi, name: string, inputs: number): AbiFunction {
  const item = abi.find((entry) => entry.type === 'function' && entry.name === name && entry.inputs.length === inputs) as AbiFunction | undefined;
  if (!item) throw new Error(`ABI has no ${name}/${inputs}`);
  return item;
}

export class FakeChain {
  readonly requests: Array<{ method: string; params: unknown[] }> = [];
  readonly sent: SentTransaction[] = [];
  readonly posts = new Map<bigint, FakePost>();
  readonly balances = new Map<string, bigint>();
  readonly allowances = new Map<string, bigint>();
  readonly receipts = new Map<Hex, { blockNumber: bigint; from: Address; to: Address; input: Hex }>();
  blockNumber: bigint;
  /** Output of the quoter for the sample amount; null makes the quoter revert. */
  quoteOut: bigint | null = 1234n * 10n ** 18n;
  private nonce = 0;

  constructor(
    readonly chainId: number,
    readonly soapbox: Address,
    readonly token: Address,
    readonly quoter: Address,
    readonly soapboxAbi: Abi,
    readonly tokenAbi: Abi,
    readonly deploymentBlock: bigint,
  ) {
    this.blockNumber = deploymentBlock + 100n;
  }

  setBalance(address: Address, amount: bigint) {
    this.balances.set(address.toLowerCase(), amount);
  }

  balanceOf(address: Address): bigint {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  allowanceOf(owner: Address, spender: Address): bigint {
    return this.allowances.get(`${owner.toLowerCase()}|${spender.toLowerCase()}`) ?? 0n;
  }

  private setAllowance(owner: Address, spender: Address, amount: bigint) {
    this.allowances.set(`${owner.toLowerCase()}|${spender.toLowerCase()}`, amount);
  }

  seedPost(post: { author: Address; topic: Hex; body: string; tipsTotal?: bigint }): FakePost {
    const id = BigInt(this.posts.size + 1);
    this.blockNumber += 1n;
    const entry: FakePost = {
      id,
      author: post.author,
      topic: post.topic,
      body: post.body,
      timestamp: 1_760_000_000n + id * 60n,
      tipsTotal: post.tipsTotal ?? 0n,
      blockNumber: this.blockNumber,
      txHash: keccak256(stringToHex(`seed-${id}`)),
    };
    this.posts.set(id, entry);
    return entry;
  }

  private blockHash(number: bigint): Hex {
    return keccak256(stringToHex(`block-${number}`));
  }

  private nextHash(): Hex {
    this.nonce += 1;
    return keccak256(stringToHex(`tx-${this.nonce}`));
  }

  private revert(abi: Abi, errorName: string, args: readonly unknown[]): never {
    throw rpcError(3, 'execution reverted', encodeErrorResult({ abi, errorName, args }));
  }

  private applyCall(from: Address, to: Address, data: Hex, commit: boolean): { result: Hex; functionName: string; args: readonly unknown[] } {
    const target = to.toLowerCase();
    if (target === this.quoter.toLowerCase()) {
      if (this.quoteOut === null) throw rpcError(3, 'execution reverted', '0x');
      return {
        result: encodeFunctionResult({ abi: V4_QUOTER_ABI, functionName: 'quoteExactInputSingle', result: [this.quoteOut, 0n] }),
        functionName: 'quoteExactInputSingle',
        args: [],
      };
    }
    if (target === this.token.toLowerCase()) {
      const { functionName, args = [] } = decodeFunctionData({ abi: this.tokenAbi, data }) as unknown as { functionName: string; args?: readonly unknown[] };
      const encode = (result: unknown) => encodeFunctionResult({ abi: [abiFunction(this.tokenAbi, functionName, args.length)], functionName, result: result as never });
      switch (functionName) {
        case 'balanceOf':
          return { result: encode(this.balanceOf(args[0] as Address)), functionName, args };
        case 'allowance':
          return { result: encode(this.allowanceOf(args[0] as Address, args[1] as Address)), functionName, args };
        case 'symbol':
          return { result: encode('SOAP'), functionName, args };
        case 'name':
          return { result: encode('Soapbox'), functionName, args };
        case 'decimals':
          return { result: encode(18), functionName, args };
        case 'totalSupply':
          return { result: encode(10n ** 27n), functionName, args };
        case 'approve':
          if (commit) this.setAllowance(from, args[0] as Address, args[1] as bigint);
          return { result: encode(true), functionName, args };
        default:
          throw rpcError(-32601, `fake token: ${functionName} not modelled`);
      }
    }
    if (target === this.soapbox.toLowerCase()) {
      const { functionName, args = [] } = decodeFunctionData({ abi: this.soapboxAbi, data }) as unknown as { functionName: string; args?: readonly unknown[] };
      const encode = (result: unknown) => encodeFunctionResult({ abi: [abiFunction(this.soapboxAbi, functionName, args.length)], functionName, result: result as never });
      switch (functionName) {
        case 'token':
          return { result: encode(this.token), functionName, args };
        case 'POST_FEE':
          return { result: encode(POST_FEE), functionName, args };
        case 'MIN_TIP':
          return { result: encode(MIN_TIP), functionName, args };
        case 'MAX_BODY_BYTES':
          return { result: encode(280n), functionName, args };
        case 'postCount':
          return { result: encode(BigInt(this.posts.size)), functionName, args };
        case 'post': {
          if (args.length === 1) {
            const post = this.posts.get(args[0] as bigint);
            if (!post) this.revert(this.soapboxAbi, 'PostNotFound', [args[0]]);
            return { result: encode({ author: post.author, topic: post.topic, timestamp: post.timestamp, tipsTotal: post.tipsTotal }), functionName, args };
          }
          const [topic, body] = args as [Hex, string];
          const length = new TextEncoder().encode(body).length;
          if (length === 0 || length > 280) this.revert(this.soapboxAbi, 'InvalidBodyLength', [BigInt(length)]);
          if (this.allowanceOf(from, this.soapbox) < POST_FEE) {
            this.revert(this.tokenAbi, 'ERC20InsufficientAllowance', [this.soapbox, this.allowanceOf(from, this.soapbox), POST_FEE]);
          }
          if (this.balanceOf(from) < POST_FEE) this.revert(this.tokenAbi, 'ERC20InsufficientBalance', [from, this.balanceOf(from), POST_FEE]);
          const id = BigInt(this.posts.size + 1);
          if (commit) {
            this.setAllowance(from, this.soapbox, this.allowanceOf(from, this.soapbox) - POST_FEE);
            this.setBalance(from, this.balanceOf(from) - POST_FEE);
            this.blockNumber += 1n;
            this.posts.set(id, { id, author: from, topic, body, timestamp: 1_760_000_000n + id * 60n, tipsTotal: 0n, blockNumber: this.blockNumber, txHash: ZERO32 });
          }
          return { result: encode(id), functionName, args };
        }
        case 'tip': {
          const [postId, amount] = args as [bigint, bigint];
          const post = this.posts.get(postId);
          if (!post) this.revert(this.soapboxAbi, 'PostNotFound', [postId]);
          if (amount < MIN_TIP) this.revert(this.soapboxAbi, 'TipTooSmall', [amount]);
          if (this.allowanceOf(from, this.soapbox) < amount) {
            this.revert(this.tokenAbi, 'ERC20InsufficientAllowance', [this.soapbox, this.allowanceOf(from, this.soapbox), amount]);
          }
          if (this.balanceOf(from) < amount) this.revert(this.tokenAbi, 'ERC20InsufficientBalance', [from, this.balanceOf(from), amount]);
          if (commit) {
            this.setAllowance(from, this.soapbox, this.allowanceOf(from, this.soapbox) - amount);
            this.setBalance(from, this.balanceOf(from) - amount);
            this.setBalance(post.author, this.balanceOf(post.author) + amount);
            post.tipsTotal += amount;
            this.blockNumber += 1n;
          }
          return { result: '0x', functionName, args };
        }
        default:
          throw rpcError(-32601, `fake soapbox: ${functionName} not modelled`);
      }
    }
    throw rpcError(-32000, `fake chain: no contract at ${to}`);
  }

  private logsFor(filter: { address?: Address | Address[]; topics?: (Hex | Hex[] | null)[]; fromBlock?: Hex | 'latest'; toBlock?: Hex | 'latest' }) {
    const from = filter.fromBlock && filter.fromBlock !== 'latest' ? BigInt(filter.fromBlock) : 0n;
    const to = filter.toBlock && filter.toBlock !== 'latest' ? BigInt(filter.toBlock) : this.blockNumber;
    const addresses = (Array.isArray(filter.address) ? filter.address : filter.address ? [filter.address] : []).map((a) => a.toLowerCase());
    if (addresses.length > 0 && !addresses.includes(this.soapbox.toLowerCase())) return [];
    const postedTopic = encodeEventTopics({ abi: this.soapboxAbi, eventName: 'Posted' })[0] as Hex;
    const wanted = filter.topics?.[0];
    if (wanted && (Array.isArray(wanted) ? !wanted.includes(postedTopic) : wanted !== postedTopic)) return [];
    const logs = [];
    for (const post of this.posts.values()) {
      if (post.blockNumber < from || post.blockNumber > to) continue;
      logs.push({
        address: this.soapbox,
        topics: encodeEventTopics({ abi: this.soapboxAbi, eventName: 'Posted', args: { id: post.id, author: post.author, topic: post.topic } }),
        data: encodeAbiParameters([{ type: 'string' }], [post.body]),
        blockNumber: numberToHex(post.blockNumber),
        blockHash: this.blockHash(post.blockNumber),
        transactionHash: post.txHash,
        transactionIndex: '0x0',
        logIndex: '0x0',
        removed: false,
      });
    }
    return logs;
  }

  async handle(method: string, params: unknown[] = []): Promise<unknown> {
    this.requests.push({ method, params });
    switch (method) {
      case 'eth_chainId':
        return numberToHex(this.chainId);
      case 'eth_blockNumber':
        return numberToHex(this.blockNumber);
      case 'eth_getBalance':
        return numberToHex(10n ** 18n);
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_estimateGas':
        return '0x186a0';
      case 'eth_getTransactionCount':
        return numberToHex(this.nonce);
      case 'eth_getCode':
        return '0x6001';
      case 'wallet_addEthereumChain':
        return null;
      case 'eth_call': {
        const { to, data, from } = params[0] as { to: Address; data: Hex; from?: Address };
        return this.applyCall(from ?? zeroAddress, to, data, false).result;
      }
      case 'eth_sendTransaction': {
        const { to, data, from } = params[0] as { to: Address; data: Hex; from: Address };
        const { functionName, args } = this.applyCall(from, to, data, true);
        const hash = this.nextHash();
        this.receipts.set(hash, { blockNumber: this.blockNumber, from, to, input: data });
        this.sent.push({ from: from.toLowerCase() as Address, to: to.toLowerCase() as Address, functionName, args, hash });
        return hash;
      }
      case 'eth_getTransactionReceipt': {
        const hash = params[0] as Hex;
        const receipt = this.receipts.get(hash);
        if (!receipt) return null;
        return {
          transactionHash: hash,
          transactionIndex: '0x0',
          blockHash: this.blockHash(receipt.blockNumber),
          blockNumber: numberToHex(receipt.blockNumber),
          from: receipt.from,
          to: receipt.to,
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          contractAddress: null,
          logs: [],
          logsBloom: EMPTY_BLOOM,
          status: '0x1',
          effectiveGasPrice: '0x3b9aca00',
          type: '0x2',
        };
      }
      case 'eth_getTransactionByHash': {
        const hash = params[0] as Hex;
        const receipt = this.receipts.get(hash);
        if (!receipt) return null;
        return {
          hash,
          nonce: '0x1',
          blockHash: this.blockHash(receipt.blockNumber),
          blockNumber: numberToHex(receipt.blockNumber),
          transactionIndex: '0x0',
          from: receipt.from,
          to: receipt.to,
          value: '0x0',
          gas: '0x186a0',
          gasPrice: '0x3b9aca00',
          maxFeePerGas: '0x3b9aca00',
          maxPriorityFeePerGas: '0x3b9aca00',
          input: receipt.input,
          type: '0x2',
          chainId: numberToHex(this.chainId),
          accessList: [],
          v: '0x1',
          r: '0x1',
          s: '0x1',
        };
      }
      case 'eth_getBlockByNumber': {
        const tag = params[0] as Hex | 'latest' | 'pending';
        const number = tag === 'latest' || tag === 'pending' ? this.blockNumber : BigInt(tag);
        return {
          number: numberToHex(number),
          hash: this.blockHash(number),
          parentHash: this.blockHash(number - 1n),
          timestamp: numberToHex(1_760_000_000n + number),
          baseFeePerGas: '0x3b9aca00',
          gasLimit: '0x1c9c380',
          gasUsed: '0x0',
          miner: zeroAddress,
          nonce: '0x0000000000000000',
          difficulty: '0x0',
          totalDifficulty: '0x0',
          extraData: '0x',
          logsBloom: EMPTY_BLOOM,
          mixHash: ZERO32,
          receiptsRoot: ZERO32,
          sha3Uncles: ZERO32,
          size: '0x0',
          stateRoot: ZERO32,
          transactions: [],
          transactionsRoot: ZERO32,
          uncles: [],
        };
      }
      case 'eth_getLogs':
        return this.logsFor(params[0] as Parameters<FakeChain['logsFor']>[0]);
      default:
        throw rpcError(-32601, `fake chain: method ${method} not modelled`);
    }
  }

  /** A fetch() replacement that serves JSON-RPC (single or batch) for any URL. */
  readonly fetch = async (_input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as unknown;
    const requests = Array.isArray(body) ? body : [body];
    const responses = await Promise.all(
      requests.map(async (request: { id: number; method: string; params?: unknown[] }) => {
        try {
          const result = await this.handle(request.method, request.params ?? []);
          return { jsonrpc: '2.0', id: request.id, result };
        } catch (error) {
          const rpc = error as RpcError;
          return { jsonrpc: '2.0', id: request.id, error: { code: rpc.code ?? -32000, message: rpc.message ?? String(error), data: rpc.data } };
        }
      }),
    );
    return new Response(JSON.stringify(Array.isArray(body) ? responses : responses[0]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
