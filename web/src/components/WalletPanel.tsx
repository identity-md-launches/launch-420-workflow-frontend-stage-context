import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { POOL, QUOTE_SAMPLE_ETH, TOKEN_FALLBACK } from '../config';
import { explorerAddressUrl } from '../deployment';
import { describeError } from '../errors';
import { useSoapbox } from '../hooks/soapbox';
import { quotePairedToToken } from '../quote';
import { formatToken } from '../text';

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function WalletPanel() {
  const { deployment, info, infoError, infoLoading, wallet, walletError, walletLoading, isConnected, onTargetChain } = useSoapbox();
  const publicClient = usePublicClient({ chainId: deployment.chainId });
  const { network } = deployment;
  const symbol = info?.symbol ?? TOKEN_FALLBACK.symbol;
  const decimals = info?.decimals ?? TOKEN_FALLBACK.decimals;
  const native = network.nativeCurrency;

  const quote = useQuery({
    queryKey: ['quote', deployment.chainId, info?.tokenAddress],
    enabled: publicClient !== undefined && info !== undefined,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (!publicClient || !info) throw new Error('No RPC client.');
      return quotePairedToToken(publicClient, network.uniswapV4.quoter, info.tokenAddress, QUOTE_SAMPLE_ETH);
    },
  });

  return (
    <section className="card" aria-labelledby="wallet-heading">
      <h2 id="wallet-heading">Wallet</h2>
      {infoError ? (
        <p role="alert" className="text-danger">
          Unable to read the contracts: {infoError}
        </p>
      ) : null}
      {info && !info.tokenMatchesManifest ? (
        <p role="alert" className="text-danger">
          Soapbox.token() returns {info.tokenAddress}, which differs from the deployment configuration. Paying actions are disabled.
        </p>
      ) : null}
      {!isConnected ? (
        <p className="text-secondary">Connect a wallet to see its {symbol} balance and how much Soapbox may spend.</p>
      ) : !onTargetChain ? (
        <p className="text-secondary">Switch the wallet to {network.name} to read balances.</p>
      ) : walletLoading || (infoLoading && !info) ? (
        <p role="status" className="text-secondary">
          Reading balances…
        </p>
      ) : walletError ? (
        <p role="alert" className="text-danger">
          Unable to read balances: {walletError}
        </p>
      ) : wallet ? (
        <dl className="stats">
          <div>
            <dt>{symbol} balance</dt>
            <dd className="num">
              {formatToken(wallet.balance, decimals)} {symbol}
            </dd>
          </div>
          <div>
            <dt>Approved for Soapbox</dt>
            <dd className="num">
              {formatToken(wallet.allowance, decimals)} {symbol}
            </dd>
          </div>
          <div>
            <dt>{native.symbol} balance</dt>
            <dd className="num">
              {formatToken(wallet.nativeBalance, native.decimals)} {native.symbol}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="text-secondary text-small">
        Soapbox pulls {symbol} from your wallet with transferFrom, so each paying action needs an approval that covers it. Posting burns 100 {symbol}; tips go
        straight to the author.
      </p>

      <h3>Get {symbol}</h3>
      <p className="text-small">
        {symbol} comes from swapping {network.name} {native.symbol} in the launch pool: a hookless Uniswap v4 {native.symbol}/{symbol} pool with a {POOL.fee / 10_000}%
        fee. This page does not swap.
      </p>
      <p className="text-small num" role="status">
        {quote.data
          ? `Right now ${formatToken(quote.data.amountIn, native.decimals)} ${native.symbol} ≈ ${formatToken(quote.data.amountOut, decimals)} ${symbol} (quoter estimate, before slippage).`
          : quote.error
            ? `Quote unavailable: ${describeError(quote.error, symbol)}`
            : info
              ? 'Fetching an indicative price…'
              : ''}
      </p>
      <ul className="link-list text-small">
        {info ? (
          <li>
            <a href={explorerAddressUrl(deployment, info.tokenAddress)} target="_blank" rel="noreferrer">
              {symbol} token on the explorer
            </a>
          </li>
        ) : null}
        <li>
          <a href={explorerAddressUrl(deployment, network.uniswapV4.poolManager)} target="_blank" rel="noreferrer">
            Uniswap v4 PoolManager on the explorer
          </a>
        </li>
        {(network.faucets ?? []).map((faucet) => (
          <li key={faucet}>
            <a href={faucet} target="_blank" rel="noreferrer">
              {native.symbol} faucet at {hostLabel(faucet)}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
