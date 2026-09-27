# ABI reference

The [LaunchToken ABI](LaunchToken.json) and [Soapbox ABI](Soapbox.json) are JSON arrays exported from the Solidity 0.8.26 build. Regenerate with `forge build && python3 scripts/export_abi.py`; verify with `python3 scripts/export_abi.py --check`. The script reads local build artifacts and does not use a network or EVM filesystem cheatcodes.

## LaunchToken

Constructor: no arguments, nonpayable. Standard ERC-20 functions are `name()`, `symbol()`, `decimals()`, `totalSupply()`, `balanceOf(address)`, `allowance(address,address)`, `approve(address,uint256)`, `transfer(address,uint256)`, and `transferFrom(address,address,uint256)`. Amounts are integer minor units, with 10^18 units per SOAP. Standard `Transfer` and `Approval` events and OpenZeppelin ERC-20 custom errors appear in the JSON. The constructor is the only mint path. There are no external administrative functions.

## Soapbox

Constructor: `constructor(address tokenAddress)`, nonpayable. Resolve to the previously deployed launch token (`$token`).

| Signature | Result / effect |
| --- | --- |
| `token()` | `address`: immutable SOAP token. |
| `postCount()` | `uint256`: successful posts, IDs 1 through count. |
| `post(bytes32 topic,string body)` | Nonpayable; returns `uint256 id`. Body length 1–280 bytes, 100 SOAP approval and funds required. |
| `post(uint256 id)` | View; returns a tuple `(address author, bytes32 topic, uint256 timestamp, uint256 tipsTotal)`. Missing posts revert. |
| `tip(uint256 postId,uint256 amount)` | Nonpayable; no return. Amount at least 10^18; funds and approval required, including for self-tips. |
| `POST_FEE()` | `uint256`: 100000000000000000000. |
| `MIN_TIP()` | `uint256`: 1000000000000000000. |
| `MAX_BODY_BYTES()` | `uint256`: 280. |
| `BURN_ADDRESS()` | `address`: 0x000000000000000000000000000000000000dEaD. |

The two `post` functions are overloaded. Select `post(bytes32,string)` to write and `post(uint256)` to read in clients that require a complete function signature. The metadata view does not return a body; reconstruct bodies from logs. No function pages through posts on chain.

```solidity
event Posted(uint256 indexed id, address indexed author, bytes32 indexed topic, string body);
event Tipped(uint256 indexed postId, address indexed tipper, uint256 amount);
```

`Posted` carries the entire body and an exact topic value; both are untrusted text for the frontend. `Tipped` records the amount in minor units, including self-tips. `tipsTotal` is cumulative successful tip volume, not funds held by the contract or independent popularity. Logs require a deployment block and chunked provider queries; use the indexed topic for filters and views for current totals.

Application errors:

| Error | Condition |
| --- | --- |
| `InvalidToken(address tokenAddress)` | Constructor address has no contract code. |
| `InvalidBodyLength(uint256 length)` | Body has zero bytes or more than 280 bytes. |
| `PostNotFound(uint256 id)` | Missing ID, including zero, in tip or metadata view. |
| `TipTooSmall(uint256 amount)` | Tip below 10^18 units. Post existence is checked first. |
| `ReentrancyGuardReentrantCall()` | A paying call attempts to reenter either paying entry point. |
| `SafeERC20FailedOperation(address token)` | Token transfer returns false. |

The ABI also includes reachable OpenZeppelin Address library errors. Revert data from SOAP is bubbled through, including `ERC20InsufficientAllowance` and `ERC20InsufficientBalance`; decode those with the token ABI. Failed operations commit no payment, new post, tip credit, or event. None of these functions accept ETH, and there is no fallback, receive, withdrawal, or configuration method.
