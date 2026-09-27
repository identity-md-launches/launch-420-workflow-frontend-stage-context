import { useState } from 'react';
import { useConnect, useConnection, useDisconnect } from 'wagmi';
import { switchOrAddChain, type Eip1193Provider } from '../chain';
import { explorerAddressUrl } from '../deployment';
import { describeError } from '../errors';
import { useAvailableConnectors } from '../hooks/useAvailableConnectors';
import { useSoapbox } from '../hooks/soapbox';
import { shortAddress } from '../text';

export function WalletBar() {
  const { deployment, address, chainId, onTargetChain } = useSoapbox();
  const connection = useConnection();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const connectors = useAvailableConnectors();
  const [switchError, setSwitchError] = useState<string | undefined>(undefined);
  const [switching, setSwitching] = useState(false);
  const networkName = deployment.network.name;

  async function handleSwitch() {
    const connector = connection.connector;
    if (!connector) return;
    setSwitching(true);
    setSwitchError(undefined);
    try {
      const provider = (await connector.getProvider()) as Eip1193Provider;
      await switchOrAddChain(provider, deployment.chainId, deployment.walletAddChain);
    } catch (error) {
      setSwitchError(`Unable to switch: ${describeError(error)}`);
    } finally {
      setSwitching(false);
    }
  }

  if (connection.status === 'connecting' || connection.status === 'reconnecting') {
    return (
      <div className="wallet-bar">
        <p role="status" className="wallet-status">
          Connecting to the wallet…
        </p>
      </div>
    );
  }

  if (connection.status !== 'connected' || !address) {
    return (
      <div className="wallet-bar">
        {connectors === undefined ? (
          <p role="status" className="wallet-status">
            Looking for browser wallets…
          </p>
        ) : connectors.length === 0 ? (
          <p className="wallet-status">No browser wallet found. Install a wallet extension, then reload this page.</p>
        ) : (
          <div className="wallet-actions">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                className="button button-primary"
                disabled={connect.isPending}
                onClick={() => connect.mutate({ connector })}
              >
                {connect.isPending && connect.variables?.connector === connector ? 'Connecting…' : `Connect ${connector.name}`}
              </button>
            ))}
          </div>
        )}
        {connect.error ? (
          <p role="alert" className="wallet-error">
            {describeError(connect.error)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-bar">
      <div className="wallet-actions">
        <a className="address-chip mono" href={explorerAddressUrl(deployment, address)} target="_blank" rel="noreferrer" title={address}>
          {shortAddress(address)}
        </a>
        {onTargetChain ? (
          <span className="badge badge-ok">{networkName}</span>
        ) : (
          <button type="button" className="button button-primary" onClick={handleSwitch} disabled={switching}>
            {switching ? 'Switching…' : `Switch to ${networkName}`}
          </button>
        )}
        <button type="button" className="button button-secondary" onClick={() => disconnect.mutate({})}>
          Disconnect
        </button>
      </div>
      {!onTargetChain ? (
        <p className="wallet-warning">
          This wallet is on chain {chainId ?? 'unknown'}. Switch to {networkName} to post or tip. If the wallet does not know {networkName}, the switch will offer to add it.
        </p>
      ) : null}
      {switchError ? (
        <p role="alert" className="wallet-error">
          {switchError}
        </p>
      ) : null}
    </div>
  );
}
