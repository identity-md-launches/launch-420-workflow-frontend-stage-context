// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable, unmoderated posts paid for in SOAP, with tips sent directly to their authors.
/// @dev Configure only with LaunchToken. Body limits count bytes; content and UTF-8 validity are not filtered.
contract Soapbox is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant POST_FEE = 100e18;
    uint256 public constant MIN_TIP = 1e18;
    uint256 public constant MAX_BODY_BYTES = 280;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token;
    uint256 public postCount;

    struct Post {
        address author;
        bytes32 topic;
        uint256 timestamp;
        uint256 tipsTotal;
    }

    mapping(uint256 id => Post) private _posts;

    error InvalidToken(address tokenAddress);
    error InvalidBodyLength(uint256 length);
    error PostNotFound(uint256 id);
    error TipTooSmall(uint256 amount);

    event Posted(uint256 indexed id, address indexed author, bytes32 indexed topic, string body);
    event Tipped(uint256 indexed postId, address indexed tipper, uint256 amount);

    /// @param tokenAddress The SOAP LaunchToken address, resolved from $token by the project factory.
    constructor(address tokenAddress) {
        if (tokenAddress.code.length == 0) revert InvalidToken(tokenAddress);
        token = IERC20(tokenAddress);
    }

    /// @notice Pay exactly 100 SOAP to the dead address and publish a body of 1 through 280 bytes.
    /// @return id Sequential post ID, starting at 1. The body is emitted only and cannot be edited.
    function post(bytes32 topic, string calldata body) external nonReentrant returns (uint256 id) {
        uint256 length = bytes(body).length;
        if (length == 0 || length > MAX_BODY_BYTES) revert InvalidBodyLength(length);

        id = ++postCount;
        _posts[id] = Post({author: msg.sender, topic: topic, timestamp: block.timestamp, tipsTotal: 0});

        // A failed payment reverts the count and all stored metadata. SOAP never passes through this contract.
        token.safeTransferFrom(msg.sender, BURN_ADDRESS, POST_FEE);
        emit Posted(id, msg.sender, topic, body);
    }

    /// @notice Send at least 1 SOAP directly to an existing post's author. Self-tips are permitted.
    function tip(uint256 postId, uint256 amount) external nonReentrant {
        Post storage entry = _posts[postId];
        if (entry.author == address(0)) revert PostNotFound(postId);
        if (amount < MIN_TIP) revert TipTooSmall(amount);

        entry.tipsTotal += amount;
        token.safeTransferFrom(msg.sender, entry.author, amount);
        emit Tipped(postId, msg.sender, amount);
    }

    /// @notice Read immutable metadata and cumulative tips. Reverts for nonexistent IDs, including 0.
    function post(uint256 id) external view returns (Post memory) {
        Post memory entry = _posts[id];
        if (entry.author == address(0)) revert PostNotFound(id);
        return entry;
    }
}
