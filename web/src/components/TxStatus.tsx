import { explorerTxUrl, type Deployment } from '../deployment';
import type { TxState } from '../hooks/useTxAction';
import { shortHash } from '../text';

function TxLink({ deployment, hash }: { deployment: Deployment; hash: string }) {
  return (
    <a className="mono" href={explorerTxUrl(deployment, hash)} target="_blank" rel="noreferrer">
      View transaction {shortHash(hash)}
    </a>
  );
}

/** A stable polite status region plus an alert that only appears on failure. */
export function TxStatus({ state, deployment }: { state: TxState; deployment: Deployment }) {
  let message: string | null = null;
  switch (state.phase) {
    case 'simulating':
      message = `Checking ${state.description ?? 'the transaction'}…`;
      break;
    case 'signing':
      message = `Confirm ${state.description ?? 'the transaction'} in your wallet.`;
      break;
    case 'pending':
      message = `Sent. Waiting for ${state.description ?? 'the transaction'} to confirm…`;
      break;
    case 'confirmed':
      message = `✓ ${state.description ?? 'Transaction'} confirmed.`;
      break;
    default:
      message = null;
  }
  return (
    <div className="tx-status">
      <p role="status" className={state.phase === 'confirmed' ? 'tx-message tx-confirmed' : 'tx-message'}>
        {message}
        {message && state.hash ? (
          <>
            {' '}
            <TxLink deployment={deployment} hash={state.hash} />
          </>
        ) : null}
      </p>
      {state.phase === 'failed' ? (
        <p role="alert" className="tx-message tx-failed">
          ✕ {state.description ? `${state.description} failed. ` : ''}
          {state.error}
          {state.hash ? (
            <>
              {' '}
              <TxLink deployment={deployment} hash={state.hash} />
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
