import { useId, useRef, useState, type FormEvent } from 'react';
import { MAX_BODY_BYTES, MAX_TOPIC_BYTES, TOKEN_FALLBACK } from '../config';
import { useSoapbox } from '../hooks/soapbox';
import { useTxAction } from '../hooks/useTxAction';
import { encodeTopic, formatToken, utf8ByteLength } from '../text';
import { TxStatus } from './TxStatus';

export function PostForm() {
  const { deployment, info, wallet, isConnected, onTargetChain, refresh } = useSoapbox();
  const ids = { topic: useId(), body: useId(), help: useId() };
  const [topic, setTopic] = useState('');
  const [body, setBody] = useState('');
  const [attempted, setAttempted] = useState(false);
  const topicRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const symbol = info?.symbol ?? TOKEN_FALLBACK.symbol;
  const decimals = info?.decimals ?? TOKEN_FALLBACK.decimals;
  const approve = useTxAction(symbol);
  const post = useTxAction(symbol);

  const bodyBytes = utf8ByteLength(body);
  const topicBytes = utf8ByteLength(topic.trim());
  const bodyError =
    bodyBytes === 0 ? 'Write a body: it needs at least 1 byte.' : bodyBytes > MAX_BODY_BYTES ? `Shorten the body to ${MAX_BODY_BYTES} bytes; it is ${bodyBytes}.` : undefined;
  const topicError = topicBytes > MAX_TOPIC_BYTES ? `Shorten the topic to ${MAX_TOPIC_BYTES} bytes; it is ${topicBytes}.` : undefined;
  const showBodyError = attempted && bodyError !== undefined;
  const showTopicError = topicError !== undefined;

  const fee = info?.postFee;
  const feeLabel = fee !== undefined ? `${formatToken(fee, decimals)} ${symbol}` : `100 ${symbol}`;
  const hasFunds = wallet !== undefined && fee !== undefined && wallet.balance >= fee;
  const approved = wallet !== undefined && fee !== undefined && wallet.allowance >= fee;

  const prerequisite = !isConnected
    ? 'Connect a wallet to post.'
    : !onTargetChain
      ? `Switch the wallet to ${deployment.network.name} to post.`
      : !info
        ? 'Waiting for contract state.'
        : !info.tokenMatchesManifest
          ? 'Posting is disabled because the token address does not match the deployment.'
          : !wallet
            ? 'Reading your balance…'
            : !hasFunds
              ? `You need ${feeLabel} to post; this wallet has ${formatToken(wallet.balance, decimals)} ${symbol}.`
              : !approved
                ? `Step 1 first: approve ${feeLabel} for Soapbox.`
                : undefined;
  const canApprove = isConnected && onTargetChain && info !== undefined && info.tokenMatchesManifest && wallet !== undefined && hasFunds && !approved;
  const canPost = prerequisite === undefined && !approve.busy && !post.busy;

  async function handleApprove() {
    if (!info || fee === undefined) return;
    await approve.run({
      description: `Approve ${feeLabel}`,
      address: info.tokenAddress,
      abi: deployment.launchToken.abi,
      functionName: 'approve',
      args: [deployment.soapbox.address, fee],
      onConfirmed: refresh,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (topicError) {
      topicRef.current?.focus();
      return;
    }
    if (bodyError) {
      bodyRef.current?.focus();
      return;
    }
    if (!canPost) return;
    const confirmed = await post.run({
      description: `Post for ${feeLabel}`,
      address: deployment.soapbox.address,
      abi: [...deployment.soapbox.abi, ...deployment.launchToken.abi],
      functionName: 'post',
      args: [encodeTopic(topic), body],
      onConfirmed: async () => {
        setBody('');
        setAttempted(false);
        await refresh();
      },
    });
    if (!confirmed) bodyRef.current?.focus();
  }

  return (
    <section className="card" aria-labelledby="post-heading">
      <h2 id="post-heading">Write a post</h2>
      <p className="text-secondary text-small">
        Posting burns {feeLabel} (sent to the dead address). Posts are public forever and cannot be edited or deleted.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor={ids.topic}>Topic (optional)</label>
          <input
            id={ids.topic}
            ref={topicRef}
            type="text"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="general"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showTopicError || undefined}
            aria-describedby={`${ids.topic}-count`}
          />
          <p id={`${ids.topic}-count`} className={showTopicError ? 'field-hint text-danger' : 'field-hint'}>
            {showTopicError ? topicError : <span className="num">{topicBytes} / {MAX_TOPIC_BYTES} bytes</span>}
          </p>
        </div>
        <div className="field">
          <label htmlFor={ids.body}>Body</label>
          <textarea
            id={ids.body}
            ref={bodyRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            placeholder="Say it once. It stays."
            aria-invalid={showBodyError || undefined}
            aria-describedby={`${ids.body}-count`}
          />
          <p id={`${ids.body}-count`} className={showBodyError || bodyBytes > MAX_BODY_BYTES ? 'field-hint text-danger' : 'field-hint'}>
            {showBodyError ? bodyError : <span className="num">{bodyBytes} / {MAX_BODY_BYTES} bytes</span>}
          </p>
        </div>
        <ol className="steps">
          <li>
            {approved ? (
              <span className="step-done">✓ Approved: Soapbox may spend {formatToken(wallet.allowance, decimals)} {symbol}</span>
            ) : (
              <button type="button" className="button button-secondary" onClick={handleApprove} disabled={!canApprove || approve.busy || post.busy}>
                {approve.busy ? `Approving ${feeLabel}…` : `Approve ${feeLabel}`}
              </button>
            )}
          </li>
          <li>
            <button type="submit" className="button button-primary" disabled={!canPost} aria-describedby={ids.help}>
              {post.busy ? 'Posting…' : `Post for ${feeLabel}`}
            </button>
          </li>
        </ol>
        <p id={ids.help} className="field-hint">
          {prerequisite ?? `Ready: posting sends ${feeLabel} to the dead address.`}
        </p>
        <TxStatus state={approve.state} deployment={deployment} />
        <TxStatus state={post.state} deployment={deployment} />
      </form>
    </section>
  );
}
