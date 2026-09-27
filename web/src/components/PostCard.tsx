import { useId, useState } from 'react';
import { TOKEN_FALLBACK } from '../config';
import { explorerAddressUrl } from '../deployment';
import type { FeedPost } from '../feed';
import { useSoapbox } from '../hooks/soapbox';
import { useTxAction } from '../hooks/useTxAction';
import { decodeTopic, formatTimestamp, formatToken, parseTokenAmount, shortAddress, topicLabel } from '../text';
import { TxStatus } from './TxStatus';

function TipForm({ post }: { post: FeedPost }) {
  const { deployment, info, wallet, address, isConnected, onTargetChain, refresh } = useSoapbox();
  const amountId = useId();
  const [amount, setAmount] = useState('1');
  const [attempted, setAttempted] = useState(false);
  const symbol = info?.symbol ?? TOKEN_FALLBACK.symbol;
  const decimals = info?.decimals ?? TOKEN_FALLBACK.decimals;
  const approve = useTxAction(symbol);
  const tip = useTxAction(symbol);

  const parsed = parseTokenAmount(amount, decimals);
  const minTip = info?.minTip;
  const amountError =
    parsed === null
      ? `Enter a plain number of ${symbol}, like 1 or 2.5.`
      : minTip !== undefined && parsed < minTip
        ? `Tips must be at least ${formatToken(minTip, decimals)} ${symbol}.`
        : undefined;
  const amountValid = parsed !== null && amountError === undefined;
  const amountLabel = amountValid ? `${formatToken(parsed, decimals)} ${symbol}` : symbol;
  const hasFunds = wallet !== undefined && parsed !== null && wallet.balance >= parsed;
  const approved = wallet !== undefined && parsed !== null && wallet.allowance >= parsed;
  const isOwnPost = address !== undefined && address.toLowerCase() === post.author.toLowerCase();

  const prerequisite = !isConnected
    ? 'Connect a wallet to tip.'
    : !onTargetChain
      ? `Switch the wallet to ${deployment.network.name} to tip.`
      : !info
        ? 'Waiting for contract state.'
        : !info.tokenMatchesManifest
          ? 'Tipping is disabled because the token address does not match the deployment.'
          : !wallet
            ? 'Reading your balance…'
            : !amountValid
              ? amountError
              : !hasFunds
                ? `This wallet has ${formatToken(wallet.balance, decimals)} ${symbol}, less than the tip.`
                : !approved
                  ? `Step 1 first: approve ${amountLabel} for Soapbox.`
                  : undefined;
  const canApprove = isConnected && onTargetChain && info !== undefined && info.tokenMatchesManifest && wallet !== undefined && amountValid && hasFunds && !approved;
  const canTip = prerequisite === undefined && !approve.busy && !tip.busy;

  async function handleApprove() {
    if (!info || parsed === null) return;
    await approve.run({
      description: `Approve ${amountLabel}`,
      address: info.tokenAddress,
      abi: deployment.launchToken.abi,
      functionName: 'approve',
      args: [deployment.soapbox.address, parsed],
      onConfirmed: refresh,
    });
  }

  async function handleTip(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (!canTip || parsed === null) return;
    await tip.run({
      description: `Tip ${amountLabel} to post #${post.id}`,
      address: deployment.soapbox.address,
      abi: [...deployment.soapbox.abi, ...deployment.launchToken.abi],
      functionName: 'tip',
      args: [post.id, parsed],
      onConfirmed: refresh,
    });
  }

  const showAmountError = attempted && amountError !== undefined;

  return (
    <form className="tip-form" onSubmit={handleTip} noValidate>
      <div className="field">
        <label htmlFor={amountId}>Tip amount ({symbol})</label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoComplete="off"
          aria-invalid={showAmountError || undefined}
          aria-describedby={`${amountId}-hint`}
        />
        <p id={`${amountId}-hint`} className={showAmountError ? 'field-hint text-danger' : 'field-hint'}>
          {showAmountError ? amountError : `Sent directly to ${shortAddress(post.author)}. Minimum ${minTip !== undefined ? formatToken(minTip, decimals) : '1'} ${symbol}.`}
        </p>
      </div>
      {isOwnPost ? <p className="field-hint">This is your own post. A self-tip returns the {symbol} to you and only raises the count.</p> : null}
      <ol className="steps">
        <li>
          {approved && amountValid ? (
            <span className="step-done">✓ Approved for {formatToken(wallet.allowance, decimals)} {symbol}</span>
          ) : (
            <button type="button" className="button button-secondary" onClick={handleApprove} disabled={!canApprove || approve.busy || tip.busy}>
              {approve.busy ? `Approving ${amountLabel}…` : `Approve ${amountLabel}`}
            </button>
          )}
        </li>
        <li>
          <button type="submit" className="button button-primary" disabled={!canTip}>
            {tip.busy ? 'Tipping…' : `Tip ${amountLabel}`}
          </button>
        </li>
      </ol>
      <p className="field-hint">{prerequisite ?? `Ready: ${amountLabel} goes straight to the author.`}</p>
      <TxStatus state={approve.state} deployment={deployment} />
      <TxStatus state={tip.state} deployment={deployment} />
    </form>
  );
}

export function PostCard({ post }: { post: FeedPost }) {
  const { deployment, info } = useSoapbox();
  const symbol = info?.symbol ?? TOKEN_FALLBACK.symbol;
  const decimals = info?.decimals ?? TOKEN_FALLBACK.decimals;
  const topic = decodeTopic(post.topic);
  const titleId = `post-${post.id}-title`;
  const isoTime = post.timestamp === 0n ? undefined : new Date(Number(post.timestamp) * 1000).toISOString();

  return (
    <article className="post" aria-labelledby={titleId}>
      <header className="post-meta">
        <span id={titleId} className="post-id num">
          #{post.id.toString()}
        </span>
        {topic.label !== '' ? (
          <span className={topic.isText ? 'topic-chip' : 'topic-chip mono'} title={topic.raw}>
            {topicLabel(topic)}
          </span>
        ) : null}
        <a className="mono" href={explorerAddressUrl(deployment, post.author)} target="_blank" rel="noreferrer" title={post.author}>
          {shortAddress(post.author)}
        </a>
        <time dateTime={isoTime}>{formatTimestamp(post.timestamp)}</time>
      </header>
      {/* Plain text only: React escapes the string and CSS keeps whitespace. No HTML, no links. */}
      <p className="post-body">{post.body}</p>
      <footer className="post-footer">
        <span className="tips num">
          Tips: {formatToken(post.tipsTotal, decimals)} {symbol}
        </span>
        <details className="tip-disclosure">
          <summary>Tip the author</summary>
          <TipForm post={post} />
        </details>
      </footer>
    </article>
  );
}
