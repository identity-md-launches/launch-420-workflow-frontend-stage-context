import { describe, expect, it, vi } from 'vitest';
import { isUnrecognizedChainError, switchOrAddChain } from '../src/chain';
import { readNetwork } from './fixtures';

const { walletAddChain } = readNetwork();

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const request = vi.fn(async () => null);
    await expect(switchOrAddChain({ request }, 11155111, walletAddChain)).resolves.toBe('switched');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
  });

  it('offers wallet_addEthereumChain with the exact parameters after a 4902 failure, then switches again', async () => {
    let calls = 0;
    const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
      calls += 1;
      if (method === 'wallet_switchEthereumChain' && calls === 1) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
      return null;
    });
    await expect(switchOrAddChain({ request }, 11155111, walletAddChain)).resolves.toBe('added');
    expect(request.mock.calls.map(([call]) => call.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(request.mock.calls[1][0].params).toEqual([walletAddChain]);
  });

  it('recognises the 4902 code nested in a provider error', async () => {
    const nested = { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { code: 4902, message: 'Unrecognized chain' } } };
    expect(isUnrecognizedChainError(nested)).toBe(true);
    expect(isUnrecognizedChainError(new Error('User rejected the request.'))).toBe(false);
    expect(isUnrecognizedChainError({ code: 4001 })).toBe(false);
  });

  it('propagates a rejection without trying to add the chain', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    });
    await expect(switchOrAddChain({ request }, 11155111, walletAddChain)).rejects.toThrow('User rejected');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propagates 4902 when no add-chain parameters are available', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
    });
    await expect(switchOrAddChain({ request }, 11155111, undefined)).rejects.toThrow('Unrecognized');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
