import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import type { Config } from 'wagmi';
import { App } from './App';
import { loadDeployment, type Deployment } from './deployment';
import { createWagmiConfig } from './wagmi';
import './styles.css';

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; deployment: Deployment; config: Config; queryClient: QueryClient }
  | { status: 'error'; message: string };

function Boot() {
  const [state, setState] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    loadDeployment()
      .then((deployment) => {
        if (!active) return;
        setState({
          status: 'ready',
          deployment,
          config: createWagmiConfig(deployment),
          queryClient: new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === 'ready') {
    return <App deployment={state.deployment} config={state.config} queryClient={state.queryClient} />;
  }
  return (
    <main id="main" className="layout layout-boot">
      <h1>Soapbox</h1>
      {state.status === 'loading' ? (
        <p role="status">Loading deployment configuration…</p>
      ) : (
        <p role="alert" className="text-danger">
          Unable to start: {state.message} Reload the page; if this persists, the published files are incomplete.
        </p>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
