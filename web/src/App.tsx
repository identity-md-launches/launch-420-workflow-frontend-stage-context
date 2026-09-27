import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { WagmiProvider, type Config } from 'wagmi';
import { Feed } from './components/Feed';
import { PostForm } from './components/PostForm';
import { WalletBar } from './components/WalletBar';
import { WalletPanel } from './components/WalletPanel';
import { explorerAddressUrl, type Deployment } from './deployment';
import { SoapboxProvider, useSoapbox } from './hooks/soapbox';
import { shortHash } from './text';

function Page() {
  const { deployment } = useSoapbox();
  const { network, manifest } = deployment;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand">
          <h1>Soapbox</h1>
          <p className="tagline">Unmoderated posts on {network.name}, paid in SOAP.</p>
        </div>
        <WalletBar />
      </header>
      <main id="main" className="layout">
        <div className="column-side">
          <WalletPanel />
          <PostForm />
        </div>
        <div className="column-feed">
          <Feed />
        </div>
      </main>
      <footer className="site-footer">
        <ul className="link-list">
          {manifest.contracts.map((contract) => (
            <li key={contract.name}>
              <a href={explorerAddressUrl(deployment, contract.address)} target="_blank" rel="noreferrer">
                {contract.name} <span className="mono">{contract.address}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-small text-secondary">
          {network.name} (chain {network.chainId}) · source commit <span className="mono">{shortHash(manifest.sourceCommit)}</span> · launch{' '}
          <span className="mono">{manifest.launchId.slice(0, 8)}</span>. Posts cannot be edited or removed by anyone, including the people who built this
          page.
        </p>
      </footer>
    </>
  );
}

export interface AppProps {
  deployment: Deployment;
  config: Config;
  queryClient: QueryClient;
}

export function App({ deployment, config, queryClient }: AppProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SoapboxProvider deployment={deployment}>
          <Page />
        </SoapboxProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
