# Soapbox contracts

Soapbox is an immutable, unmoderated message board paid for in SOAP. This contribution supplies the launch token, application, Foundry tests, vendored dependencies, and ABI exports. It does not deploy contracts or publish a website.

## Build and check

Use Foundry with Solidity **0.8.26**, as pinned in `foundry.toml`. All library source is included under `lib/`; no dependency download is needed. The verifier supplies the pinned compiler. FFI and EVM filesystem permissions are disabled. Tests require no RPC, wallet, environment variables, or external services.

```sh
forge build
forge test
forge fmt --check
python3 scripts/export_abi.py --check
```

After changing a public interface, run `forge build` followed by `python3 scripts/export_abi.py` to regenerate the JSON ABI arrays. See [the ABI reference](docs/abi/README.md) and [dependency provenance](lib/DEPENDENCIES.md).

## Behavior

`LaunchToken` is a standard ERC-20 named **Soapbox**, symbol **SOAP**, with 18 decimals. Its argument-free, nonpayable constructor mints exactly **1,000,000,000 SOAP (10^27 units)** to its caller. There is no subsequent mint, owner, fee, blocklist, pause, or upgrade interface. The project factory is the constructor caller and receives the entire launch supply.

`Soapbox` takes the SOAP address in its nonpayable constructor and exposes it as immutable `token()`. The constructor rejects zero addresses and addresses without deployed code. It does not validate token economics: services must resolve this parameter to the accepted `LaunchToken`, not an arbitrary ERC-20. The application needs no token funding or initialization.

| Action | Behavior |
| --- | --- |
| `post(bytes32,string)` | Requires 1–280 bytes; transfers exactly 100 SOAP from the caller to `0x000000000000000000000000000000000000dEaD`; returns the next ID starting at 1. |
| `tip(uint256,uint256)` | Requires an existing post and at least 1 SOAP; transfers the amount directly from caller to that post's author and increments only its `tipsTotal`. |
| `post(uint256)` | Returns author, topic, timestamp, and cumulative tips; missing IDs, including zero, revert. |
| `postCount()` / `token()` | Return the number of successful posts and immutable payment token address. |

Every paying action requires an ERC-20 approval to Soapbox and uses `SafeERC20.safeTransferFrom`. Both entry points use checks, effects, interactions and a reentrancy guard. Insufficient funds, insufficient approval, a reverted transfer, or a false transfer result revert the entire operation, including count, metadata, allowance changes, and tip accounting. There is no privileged caller, moderation, editing, deletion, pause, or upgrade mechanism.

Bodies appear only in `Posted` events, not application storage. Topics are arbitrary `bytes32`; zero topics and repeated content are allowed. Limits count bytes, not Unicode characters, and the contract does not validate UTF-8 or sanitize content. Timestamp records the posting block's timestamp and is not a randomness source. `Tipped` events identify the target post and tipper. Self-tips are allowed, consume finite approval, and increase `tipsTotal` while leaving the sender's net balance unchanged. Consequently, tip rankings are not proof of independent support and can be inflated by self-tips or cooperating wallets.

## Assumptions and specification interpretation

The approved workflow contains a generic sentence about pull withdrawals, followed by explicit requirements for fees sent directly to the dead address, tips sent directly to authors, and zero application custody. This implementation follows those concrete post/tip rules. There is no withdrawal queue or payable function, receive function, or fallback.

The SOAP balance is zero at deployment and remains zero through every normal sequence of posts and tips. ERC-20 recipients cannot reject unsolicited transfers, so a third party can nevertheless send SOAP directly to the application. Such tokens are stranded and cannot pay another user's posting fee. Likewise, no contract can universally prevent forced ETH credits. Normal ETH calls and constructor value are rejected; forced or accidental assets have no recovery path. These are limits of the workflow's absolute “always zero” wording, not funds held for withdrawals.

“Burn” means a transfer to the dead address, not a reduction of `totalSupply()`. The supply remains 10^27 units. Accounting assumes the specified plain, fixed-supply SOAP token with exact transfers, no transfer fees, rebasing, or callbacks. Reentrancy tests use a malicious token solely to test defense; they do not establish support for arbitrary token economics. There are no oracles, keepers, randomness, signatures, or off-chain authorization dependencies.

## Deployment parameters and responsibilities

Target network: **Sepolia, chain ID 11155111**. The chain restriction is an operational deployment requirement; these contracts do not hard-code a chain guard. Use the project factory and the accepted manifest. No transactions are authorized by this repository, and no wallet keys or broadcasting scripts are included.

| Artifact | Constructor arguments | Value | Dependency |
| --- | --- | --- | --- |
| `src/LaunchToken.sol:LaunchToken` | `[]` | 0 | None; mints supply to factory. |
| `src/Soapbox.sol:Soapbox` | `["$token"]` (one `address`) | 0 | Deploy after LaunchToken; no app funding or owner argument. |

The separate manifest contributor writes `launch.json` with kind `evm_project`, launch token `LaunchToken`, and the single application identifier `Soapbox`. This source contribution does not generate the manifest. The accepted policy, signed artifact linkage, source publication, attestation, admission, CREATE2 salts and predicted addresses, factory selection, liquidity/reward distribution, and deployment are service responsibilities. Services must preserve the compiler settings, verify `token()` and supply, and record deployed addresses and deployment blocks for the frontend. The token-only launch pool supplies SOAP to users; the application never receives a launch allocation and requires no initialization call.

The independent contributor reviews the accepted source **and** manifest before release, including the resolved token address, constructor behavior, fee bypass, misdirected tips, and any authorization conflicts. This implementation's tests are not an independent security audit. No independent-review outcome or live deployment is claimed here.

After deployment, the frontend contributor builds the one-page `lab-soapbox` static export (`dist/index.html`) using the live Sepolia deployment. It must read the token address from `Soapbox.token()`, show wallet balance and allowance, provide approval before paying actions and a UTF-8 byte counter, and explain that SOAP comes from swapping Sepolia ETH in the launch pool (no in-page swap). Read `Posted` logs in chunks from the recorded deployment block; combine with contract views for tip ordering and topic filtering, without a backend or indexer. Render bodies and topics as escaped plain text, with no HTML or automatic links, and show the unmoderated-content notice. The later independent site review must test script injection through both bodies and topics. The contract intentionally preserves such input; the contract test for raw markup is not a browser injection test. GitHub publication and IPFS hosting belong to those later service/frontend steps.

## Test coverage

- Body lengths 0, 1, 280, and 281; multibyte UTF-8 boundaries; duplicate bodies and arbitrary topics; sequential IDs, metadata, and emitted content.
- Exact 100 SOAP dead-address payment for each successful post; unchanged supply; no fee bypass by reusing approval, failed transfers, reentry, or unsolicited application balances.
- Minimum tips, exact author receipts, self-tips, accumulated tips isolated by post and author, missing IDs, small amounts, and insufficient balances/approvals; failure rollback.
- False-returning transfers and all four post/tip reentrancy combinations; direct ETH and nonpayable constructor rejection.
- Fixed token supply, transfer and allowance behavior, transfer failures, and unavailable administrative/mint selectors.
- Factory-style CREATE2 deployment without app funding or initialization; supply preservation, runtime size, and scans for forbidden opcodes while skipping PUSH data.
- A model-based fuzz test executes mixed post/tip/approval sequences across three actors. After **every** operation it compares balances, allowances, dead-address payments, immutable metadata, per-post tips, supply conservation, and zero application custody against an independent model. It covers valid and invalid calls and retries. Separate fuzz tests cover body lengths and token transfers.
