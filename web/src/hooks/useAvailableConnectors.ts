// Lists connectors whose provider actually exists in this browser.

import { useEffect, useState } from 'react';
import { useConnectors, type Connector } from 'wagmi';

export function useAvailableConnectors(): Connector[] | undefined {
  const connectors = useConnectors();
  const [available, setAvailable] = useState<Connector[] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    Promise.all(
      connectors.map(async (connector) => {
        try {
          const provider = await connector.getProvider();
          return provider ? connector : null;
        } catch {
          return null;
        }
      }),
    ).then((list) => {
      if (!active) return;
      const present = list.filter((connector): connector is Connector => connector !== null);
      // EIP-6963 discovery adds a named connector for each wallet; hide the generic one when a named one exists.
      const named = present.filter((connector) => connector.id !== 'injected');
      setAvailable(named.length > 0 ? named : present);
    });
    return () => {
      active = false;
    };
  }, [connectors]);

  return available;
}
