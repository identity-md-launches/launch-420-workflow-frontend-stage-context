// wagmi configuration derived from the runtime deployment configuration.

import { createConfig, fallback, http, injected, type Config, type CreateConnectorFn, type Transport } from 'wagmi';
import type { Chain } from 'viem';
import type { Deployment } from './deployment';

/** Builds the viem chain object from the manifest's network block. Nothing is hard-coded. */
export function chainFromDeployment(deployment: Deployment): Chain {
  const { network } = deployment;
  return {
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
    testnet: network.testnet,
  };
}

export interface WagmiConfigOptions {
  /** Override connectors, for tests. Browser wallets are used by default. */
  connectors?: CreateConnectorFn[];
  /** Override the read transport, for tests. The manifest's public RPC URLs are used by default. */
  transport?: Transport;
  /** Receipt/block polling interval in milliseconds; viem's default when omitted. */
  pollingInterval?: number;
}

export function createWagmiConfig(deployment: Deployment, options: WagmiConfigOptions = {}): Config {
  const chain = chainFromDeployment(deployment);
  const transport = options.transport ?? fallback(deployment.network.rpcUrls.map((url) => http(url, { batch: true })));
  return createConfig({
    chains: [chain],
    connectors: options.connectors ?? [injected()],
    multiInjectedProviderDiscovery: options.connectors === undefined,
    transports: { [chain.id]: transport },
    // Forwarded to viem's createClient by wagmi; not part of the typed parameters.
    ...(options.pollingInterval !== undefined ? ({ pollingInterval: options.pollingInterval } as object) : {}),
  });
}
