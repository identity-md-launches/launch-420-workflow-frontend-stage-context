# Soapbox website (`lab-soapbox`)

One static page for the Soapbox contracts on Sepolia: read the feed, post for 100 SOAP, tip authors in SOAP. Built with Vite, React 19, TypeScript, wagmi 3 and viem. The production export lives in the repository-root `dist/` and is what gets pinned; it works from any static host, gateway subpath or ENS name because every asset URL is relative.

## Configuration: one file, read at runtime

Addresses, chain id, ABI paths, public RPC URLs, explorer and the Uniswap v4 addresses all come from **`dist/imd-deployment.json`**, which the page fetches next to `index.html` when it starts. The build generates that file from two copies of the workflow handoff kept under `web/deployment/`:

| File | Source | Used for |
| --- | --- | --- |
| `web/deployment/handoff.json` | `.imd/reads/deployment.json`, verbatim | launch id, chain id, source commit, attestation hash, contract addresses, ABI hashes, deployment block, pool fee/tick spacing |
| `web/deployment/network.json` | `.imd/reads/network.json`, verbatim | `network` (public RPCs, explorer, faucets, Uniswap v4 addresses) and `walletAddChain` (EIP-3085 parameters), copied unchanged into the manifest |
| `docs/abi/<Contract>.json` | ABI export at the pinned source commit | copied byte for byte to `dist/abi/<Contract>.json`; the canonical Keccak of each must equal the handoff `abiHash` |

`web/src/config.ts` holds only what the manifest schema does not carry: the deployment block used as the log-scan floor, the pool key parameters, scan chunk sizes and refresh intervals. It also records the handoff's launch id, source commit and chain id, and the app refuses to start if the manifest it loads names a different launch, commit or chain. At runtime every ABI is re-hashed and compared with the manifest before use (`web/src/deployment.ts`).

The SOAP token address used for balances and approvals is read from `Soapbox.token()`; if it ever differs from the manifest's LaunchToken entry the page shows an alert and disables paying actions.

There are no private credentials anywhere. Reads go through the manifest's public RPC URLs with viem's `fallback` transport; signing stays in the visitor's wallet.

### Optional: WalletConnect

Only browser wallets are wired (wagmi `injected()` plus EIP-6963 discovery). To add WalletConnect, install `@walletconnect/ethereum-provider` support through `walletConnect({ projectId })` from `wagmi/connectors` in `web/src/wagmi.ts` and read the public project id from `import.meta.env.VITE_WALLETCONNECT_PROJECT_ID`. A project id is a public identifier, not a secret, but none is supplied with this assignment.

## Install, build, preview, verify

Node 22 and npm are required (the lockfile is `package-lock.json`).

```sh
cd web
npm ci                # install exactly the locked dependencies
npm run typecheck     # tsc, app and vite config
npm test              # vitest: unit + interaction tests against an in-memory chain
npm run build         # tsc + vite build into ../dist + dist/imd-deployment.json
npm run verify        # rebuild the manifest in memory and compare with dist/imd-deployment.json
npm run preview       # serve ../dist locally (vite preview)
```

`npm run build` always ends by running `scripts/manifest.mjs`, which copies the ABIs into `dist/abi/`, checks their hashes against the handoff, hashes every exported file with SHA-256 and writes `dist/imd-deployment.json`. Rerun the build after any source change and commit `dist/` together with `web/`. `npm run verify` fails if the manifest is stale, if an ABI hash or address disagrees with the handoff, or if the manifest carries an unexpected top-level key.

To refresh the deployment inputs, replace the two files under `web/deployment/` with the new handoff and rebuild.

## What the page does

- **Feed**: `Posted` events scanned from the deployment block in bounded chunks (10,000 blocks, halved on RPC errors, three in flight), combined with `post(id)` views for `tipsTotal` and timestamp. Sorted by tips, then newest. Topic filter from the topics seen. Incremental: later refreshes only scan new blocks. Bodies and topics render as escaped plain text with no markup and no auto-links, under an unmoderated-content notice.
- **Wallet**: connect a browser wallet, see SOAP balance, the allowance granted to Soapbox and ETH balance. Wrong network shows one "Switch to Sepolia" control; if the wallet reports the chain as unknown (EIP-3326 code 4902) the page offers `wallet_addEthereumChain` with the manifest's `walletAddChain` parameters and switches again.
- **Post**: topic (≤ 32 bytes) and body with a UTF-8 byte counter (1–280 bytes). Step 1 approves exactly the fee, step 2 posts. The post control stays disabled, with the reason beside it, until the wallet is connected on Sepolia with enough SOAP and allowance. Every transaction is simulated first and revert reasons are decoded (`InvalidBodyLength`, `PostNotFound`, `TipTooSmall`, `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`).
- **Tip**: each post has a disclosure with an amount field (minimum 1 SOAP), its own approve step and the tip action. Tips go straight to the author.
- **Get SOAP**: explains that SOAP comes from swapping Sepolia ETH in the hookless Uniswap v4 launch pool and shows an indicative quote for 0.01 ETH from the chain's quoter (`quoteExactInputSingle`, simulated, never sent). There is no in-page swap, as the approved workflow requires.

## Validation

See [`docs/VALIDATION.md`](../docs/VALIDATION.md) for the commands run, the interaction tests, the browser inspection and the checks that could not be performed on this worker. The design system is documented in [`docs/DESIGN.md`](../docs/DESIGN.md).
