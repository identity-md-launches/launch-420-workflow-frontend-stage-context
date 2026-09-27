// Interaction tests: the real App rendered against an in-memory chain through wagmi's mock connector.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createConfig, http, mock, type Config } from 'wagmi';
import { getAddress, type Address, type Chain } from 'viem';
import { App } from '../src/App';
import { DEPLOYMENT_BLOCK } from '../src/config';
import type { Deployment } from '../src/deployment';
import { encodeTopic, shortAddress } from '../src/text';
import { chainFromDeployment, createWagmiConfig } from '../src/wagmi';
import { FakeChain } from './fakeChain';
import { buildDeployment, FAKE_RPC_URL } from './fixtures';

const ALICE = '0x1111111111111111111111111111111111111111' as Address;
const BOB = '0x2222222222222222222222222222222222222222' as Address;
const VISITOR = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
const ONE = 10n ** 18n;
const INJECTION_BODY = '<img src=x onerror=alert(1)> & <script>alert(2)</script> https://example.com';

interface Harness {
  chain: FakeChain;
  deployment: Deployment;
  config: Config;
}

function makeChain(deployment: Deployment): FakeChain {
  const chain = new FakeChain(
    deployment.chainId,
    deployment.soapbox.address,
    deployment.launchToken.address,
    deployment.network.uniswapV4.quoter,
    deployment.soapbox.abi,
    deployment.launchToken.abi,
    DEPLOYMENT_BLOCK,
  );
  chain.seedPost({ author: ALICE, topic: encodeTopic('general'), body: 'First post', tipsTotal: 5n * ONE });
  chain.seedPost({ author: BOB, topic: encodeTopic('dev'), body: INJECTION_BODY });
  chain.seedPost({ author: ALICE, topic: encodeTopic('general'), body: 'Most tipped', tipsTotal: 50n * ONE });
  chain.setBalance(VISITOR, 1000n * ONE);
  vi.stubGlobal('fetch', chain.fetch);
  return chain;
}

function mount(config: Config, deployment: Deployment) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App deployment={deployment} config={config} queryClient={queryClient} />);
}

function setup(): Harness {
  const deployment = buildDeployment();
  const chain = makeChain(deployment);
  const config = createWagmiConfig(deployment, {
    connectors: [mock({ accounts: [VISITOR] })],
    transport: http(FAKE_RPC_URL, { batch: true }),
    pollingInterval: 20,
  });
  mount(config, deployment);
  return { chain, deployment, config };
}

/** A config whose wallet starts on another chain, to exercise the wrong-network state. */
function setupOnOtherChain(switchChainError?: Error): Harness {
  const deployment = buildDeployment();
  const chain = makeChain(deployment);
  const other: Chain = { id: 1, name: 'Other', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [FAKE_RPC_URL] } } };
  const target = chainFromDeployment(deployment);
  const config = createConfig({
    chains: [other, target],
    connectors: [mock({ accounts: [VISITOR], features: { switchChainError } })],
    multiInjectedProviderDiscovery: false,
    transports: { [other.id]: http(FAKE_RPC_URL), [target.id]: http(FAKE_RPC_URL, { batch: true }) },
    ...({ pollingInterval: 20 } as object),
  });
  mount(config, deployment);
  return { chain, deployment, config };
}

async function connect() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Connect Mock Connector' }));
  await screen.findByText(shortAddress(getAddress(VISITOR)));
  return user;
}

function postArticles(): HTMLElement[] {
  return screen.getAllByRole('article');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('feed', () => {
  it('lists posts from Posted events ranked by tips, renders bodies as escaped text and filters by topic', async () => {
    setup();
    await screen.findByText('Most tipped');
    await screen.findByText(/3 posts · synced to block/);

    const ids = postArticles().map((article) => within(article).getByText(/^#\d+$/).textContent);
    expect(ids).toEqual(['#3', '#1', '#2']);

    const injected = screen.getByText(INJECTION_BODY);
    expect(injected.tagName).toBe('P');
    expect(injected.querySelector('*')).toBeNull();
    expect(document.querySelector('img, script')).toBeNull();
    expect(document.querySelector('a[href="https://example.com"]')).toBeNull();
    expect(screen.getByText(/unmoderated user content/)).toBeInTheDocument();
    expect(within(postArticles()[0]).getByText('Tips: 50 SOAP')).toBeInTheDocument();
    expect(within(postArticles()[0]).getByText('general')).toBeInTheDocument();

    const filter = screen.getByLabelText('Topic', { selector: 'select' });
    expect(within(filter).getByRole('option', { name: 'All topics (3)' })).toBeInTheDocument();
    await userEvent.selectOptions(filter, screen.getByRole('option', { name: 'dev (1)' }));
    expect(postArticles()).toHaveLength(1);
    expect(screen.getByText(INJECTION_BODY)).toBeInTheDocument();
    await userEvent.selectOptions(filter, screen.getByRole('option', { name: 'All topics (3)' }));
    expect(postArticles()).toHaveLength(3);
  });

  it('shows the indicative quote and contract links from the network block', async () => {
    const { deployment } = setup();
    await screen.findByText(/0\.01 ETH ≈ 1,234 SOAP/);
    const links = screen.getAllByRole('link', { name: /Soapbox 0x91b2/ });
    expect(links[0]).toHaveAttribute('href', `${deployment.network.explorer}/address/${deployment.soapbox.address}`);
  });
});

describe('posting', () => {
  it('keeps the post action disabled with a stated reason until connected, funded and approved, then posts', async () => {
    const { chain, deployment } = setup();
    await screen.findByText('Most tipped');

    const postButton = screen.getByRole('button', { name: /^Post for 100 SOAP$/ });
    expect(postButton).toBeDisabled();
    expect(screen.getByText('Connect a wallet to post.')).toBeInTheDocument();
    expect(screen.getByText('0 / 280 bytes')).toBeInTheDocument();

    const user = await connect();
    expect(await screen.findByText('Sepolia', { selector: '.badge' })).toBeInTheDocument();
    await screen.findByText('1,000 SOAP');
    expect(screen.getByText('Approved for Soapbox').nextElementSibling).toHaveTextContent('0 SOAP');
    expect(postButton).toBeDisabled();
    expect(screen.getByText('Step 1 first: approve 100 SOAP for Soapbox.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Body'), 'Hello wörld');
    expect(screen.getByText('12 / 280 bytes')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Topic (optional)'), 'general');

    await user.click(screen.getByRole('button', { name: 'Approve 100 SOAP' }));
    await screen.findByText(/✓ Approved: Soapbox may spend 100 SOAP/, undefined, { timeout: 5000 });
    expect(chain.sent[0]).toMatchObject({ functionName: 'approve', to: deployment.launchToken.address });
    expect(chain.sent[0].args).toEqual([getAddress(deployment.soapbox.address), 100n * ONE]);

    await waitFor(() => expect(postButton).toBeEnabled());
    expect(screen.getByText('Ready: posting sends 100 SOAP to the dead address.')).toBeInTheDocument();
    await user.click(postButton);
    await screen.findByText('✓ Post for 100 SOAP confirmed.', undefined, { timeout: 5000 });
    expect(chain.sent[1]).toMatchObject({ functionName: 'post', to: deployment.soapbox.address, from: VISITOR });
    expect(chain.sent[1].args).toEqual([encodeTopic('general'), 'Hello wörld']);

    await screen.findByText('Hello wörld', undefined, { timeout: 5000 });
    expect(screen.getByLabelText('Body')).toHaveValue('');
    await screen.findByText('900 SOAP');
    expect(screen.getByText(/4 posts · synced to block/)).toBeInTheDocument();
    const txLinks = screen.getAllByRole('link', { name: /View transaction/ });
    expect(txLinks.at(-1)).toHaveAttribute('href', `${deployment.network.explorer}/tx/${chain.sent[1].hash}`);
  });

  it('validates body and topic length on submit and focuses the invalid field', async () => {
    const { chain, deployment } = setup();
    chain.allowances.set(`${VISITOR}|${deployment.soapbox.address}`, 100n * ONE);
    await screen.findByText('Most tipped');
    const user = await connect();
    const postButton = screen.getByRole('button', { name: /^Post for 100 SOAP$/ });
    await waitFor(() => expect(postButton).toBeEnabled());

    const body = screen.getByLabelText('Body');
    await user.click(postButton);
    expect(await screen.findByText('Write a body: it needs at least 1 byte.')).toBeInTheDocument();
    expect(body).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toBe(body);

    fireEvent.change(body, { target: { value: 'é'.repeat(141) } });
    expect(screen.getByText('Shorten the body to 280 bytes; it is 282.')).toBeInTheDocument();
    await user.click(postButton);
    expect(chain.sent).toHaveLength(0);

    fireEvent.change(body, { target: { value: 'é'.repeat(140) } });
    expect(screen.getByText('280 / 280 bytes')).toBeInTheDocument();
    expect(body).not.toHaveAttribute('aria-invalid');

    const topic = screen.getByLabelText('Topic (optional)');
    fireEvent.change(topic, { target: { value: 'x'.repeat(33) } });
    expect(screen.getByText('Shorten the topic to 32 bytes; it is 33.')).toBeInTheDocument();
    await user.click(postButton);
    expect(document.activeElement).toBe(topic);
    expect(chain.sent).toHaveLength(0);
  });

  it('shows the decoded revert reason when the simulation fails', async () => {
    const { chain, deployment } = setup();
    chain.allowances.set(`${VISITOR}|${deployment.soapbox.address}`, 100n * ONE);
    await screen.findByText('Most tipped');
    const user = await connect();
    const postButton = screen.getByRole('button', { name: /^Post for 100 SOAP$/ });
    await waitFor(() => expect(postButton).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'hello' } });
    // The balance disappears after the page read it, so the simulation, not the UI gate, has to catch it.
    chain.setBalance(VISITOR, 0n);
    await user.click(postButton);
    const alert = await screen.findByRole('alert', undefined, { timeout: 5000 });
    expect(alert).toHaveTextContent('Post for 100 SOAP failed. Not enough SOAP in this wallet.');
    expect(chain.sent).toHaveLength(0);
  });
});

describe('tipping', () => {
  it('approves and tips a post, sending SOAP straight to the author', async () => {
    const { chain, deployment } = setup();
    await screen.findByText('Most tipped');
    const user = await connect();
    await screen.findByText('1,000 SOAP');

    const article = postArticles().find((a) => within(a).queryByText(INJECTION_BODY))!;
    await user.click(within(article).getByText('Tip the author'));
    const amount = within(article).getByLabelText('Tip amount (SOAP)');
    expect(amount).toHaveValue('1');
    const tipButton = within(article).getByRole('button', { name: /^Tip/ });
    expect(tipButton).toBeDisabled();
    expect(within(article).getByText('Step 1 first: approve 1 SOAP for Soapbox.')).toBeInTheDocument();

    fireEvent.change(amount, { target: { value: '0.5' } });
    expect(within(article).getByRole('button', { name: 'Approve SOAP' })).toBeDisabled();
    expect(within(article).getByText('Tips must be at least 1 SOAP.')).toBeInTheDocument();

    fireEvent.change(amount, { target: { value: '2.5' } });
    await user.click(within(article).getByRole('button', { name: 'Approve 2.5 SOAP' }));
    await within(article).findByText(/✓ Approved for 2.5 SOAP/, undefined, { timeout: 5000 });
    await waitFor(() => expect(within(article).getByRole('button', { name: 'Tip 2.5 SOAP' })).toBeEnabled());
    await user.click(within(article).getByRole('button', { name: 'Tip 2.5 SOAP' }));
    await within(article).findByText('✓ Tip 2.5 SOAP to post #2 confirmed.', undefined, { timeout: 5000 });

    expect(chain.sent.map((t) => t.functionName)).toEqual(['approve', 'tip']);
    expect(chain.sent[1].args).toEqual([2n, 25n * 10n ** 17n]);
    expect(chain.balanceOf(BOB)).toBe(25n * 10n ** 17n);
    expect(chain.balanceOf(VISITOR)).toBe(1000n * ONE - 25n * 10n ** 17n);
    await within(article).findByText('Tips: 2.5 SOAP', undefined, { timeout: 5000 });
    expect(chain.sent[1].to).toBe(deployment.soapbox.address);
  });
});

describe('network', () => {
  it('offers a switch, then wallet_addEthereumChain with the exact parameters when the wallet does not know the chain', async () => {
    const { chain, deployment } = setupOnOtherChain(Object.assign(new Error('Unrecognized chain ID "0xaa36a7".'), { code: 4902 }));
    await screen.findByText('Most tipped');
    const user = await connect();
    expect(await screen.findByText(/This wallet is on chain 1\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Post for/ })).toBeDisabled();
    expect(screen.getByText('Switch the wallet to Sepolia to post.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 5000 });
    expect(alert).toHaveTextContent(/Unable to switch.*Unrecognized chain ID/);
    const added = chain.requests.filter((r) => r.method === 'wallet_addEthereumChain');
    expect(added).toHaveLength(1);
    expect(added[0].params).toEqual([deployment.walletAddChain]);
  });

  it('switches to the deployment chain when the wallet knows it', async () => {
    setupOnOtherChain();
    await screen.findByText('Most tipped');
    const user = await connect();
    await user.click(await screen.findByRole('button', { name: 'Switch to Sepolia' }));
    expect(await screen.findByText('Sepolia', { selector: '.badge' })).toBeInTheDocument();
    await screen.findByText('1,000 SOAP');
    expect(screen.queryByRole('button', { name: 'Switch to Sepolia' })).toBeNull();
  });

  it('shows a read error with a retry when the RPC fails', async () => {
    const deployment = buildDeployment();
    vi.stubGlobal('fetch', async () => new Response('bad gateway', { status: 502 }));
    const config = createWagmiConfig(deployment, { connectors: [mock({ accounts: [VISITOR] })], transport: http(FAKE_RPC_URL, { retryCount: 0 }), pollingInterval: 20 });
    mount(config, deployment);
    expect(await screen.findByText(/Unable to read posts/, undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
