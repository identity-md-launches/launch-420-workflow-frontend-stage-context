// Turns viem, wallet and RPC errors into one plain sentence a visitor can act on.

import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';

function explainRevert(errorName: string, args: readonly unknown[] | undefined, symbol: string): string {
  switch (errorName) {
    case 'InvalidBodyLength':
      return `The body must be 1 to 280 bytes (got ${String(args?.[0] ?? '?')}).`;
    case 'PostNotFound':
      return 'That post does not exist.';
    case 'TipTooSmall':
      return `Tips must be at least 1 ${symbol}.`;
    case 'ERC20InsufficientAllowance':
      return `Approve enough ${symbol} for Soapbox first.`;
    case 'ERC20InsufficientBalance':
      return `Not enough ${symbol} in this wallet.`;
    case 'ReentrancyGuardReentrantCall':
      return 'The contract rejected a re-entrant call.';
    default:
      return `The contract rejected the call (${errorName}).`;
  }
}

export function describeError(error: unknown, symbol = 'SOAP'): string {
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError)) return 'Request rejected in the wallet. Nothing was sent.';
    const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert?.data?.errorName) return explainRevert(revert.data.errorName, revert.data.args, symbol);
    if (revert) return `The contract rejected the call${revert.reason ? `: ${revert.reason}` : '.'}`;
    const details = error.details && error.details.length < 160 && !error.shortMessage.includes(error.details) ? ` ${error.details}` : '';
    return `${error.shortMessage}${details}`;
  }
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 4001) {
    return 'Request rejected in the wallet. Nothing was sent.';
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
