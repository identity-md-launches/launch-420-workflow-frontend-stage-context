// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SoapboxFixture} from "./Soapbox.t.sol";
import {Soapbox} from "../src/Soapbox.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @dev An independent accounting model checks every prefix of a randomized transaction sequence.
contract SoapboxSequenceTest is SoapboxFixture {
    struct ExpectedPost {
        uint256 authorIndex;
        bytes32 topic;
        uint256 timestamp;
        uint256 tips;
    }

    address[3] private actors = [ALICE, BOB, CAROL];
    uint256[3] private balances;
    uint256[3] private allowances;
    ExpectedPost[] private posts;

    function testFuzz_postTipSequences(uint256 seed, uint8 rawSteps) public {
        uint256 steps = bound(uint256(rawSteps), 8, 64);
        for (uint256 i; i < 3; ++i) {
            balances[i] = INITIAL_BALANCE;
            allowances[i] = type(uint256).max;
        }

        // Every run covers multiple authors and tips before randomized success and failure paths.
        _modelPost(0, bytes32(seed), "first", 1_800_000_000);
        _modelPost(1, bytes32(seed), "second", 1_800_000_001);
        _modelTip(2, 1, 1e18);
        _modelTip(0, 2, 2e18);

        for (uint256 step; step < steps; ++step) {
            uint256 word = uint256(keccak256(abi.encode(seed, step)));
            uint256 actor = (word >> 8) % 3;
            uint256 action = word % 8;
            if (action <= 2) {
                uint256 length = 1 + ((word >> 32) % 280);
                if (action == 2) length = (word & 256) == 0 ? 0 : 281;
                _modelPost(actor, bytes32(word), _body(length), 1_800_000_002 + step);
            } else if (action == 3) {
                uint256 allowance = ((word >> 32) % 5) * 100e18;
                if ((word & 512) == 0) allowance = type(uint256).max;
                _modelApprove(actor, allowance);
            } else {
                uint256 id = 1 + ((word >> 64) % posts.length);
                uint256 amount = 1e18 + ((word >> 96) % 500e18);
                if (action == 5) amount = (word & 512) == 0 ? 0 : 1e18 - 1;
                if (action == 6) id = (word & 512) == 0 ? 0 : posts.length + 1;
                if (action == 7) amount = INITIAL_BALANCE * 10;
                _modelTip(actor, id, amount);
            }
        }
    }

    function _modelApprove(uint256 actor, uint256 amount) private {
        vm.prank(actors[actor]);
        assertTrue(soap.approve(address(box), amount));
        allowances[actor] = amount;
        _assertModel();
    }

    function _modelPost(uint256 actor, bytes32 topic, string memory body, uint256 timestamp) private {
        vm.warp(timestamp);
        bytes memory expectedError;
        uint256 length = bytes(body).length;
        if (length == 0 || length > 280) {
            expectedError = abi.encodeWithSelector(Soapbox.InvalidBodyLength.selector, length);
        } else {
            expectedError = _paymentError(actor, FEE);
        }

        vm.prank(actors[actor]);
        (bool ok, bytes memory result) = address(box).call(abi.encodeWithSignature("post(bytes32,string)", topic, body));
        assertEq(ok, expectedError.length == 0, "post success must match model");
        if (ok) {
            balances[actor] -= FEE;
            _spendApproval(actor, FEE);
            posts.push(ExpectedPost(actor, topic, timestamp, 0));
            assertEq(abi.decode(result, (uint256)), posts.length, "post ID must match model");
        } else {
            assertEq(result, expectedError, "post failure must match model");
        }
        _assertModel();
    }

    function _modelTip(uint256 actor, uint256 id, uint256 amount) private {
        bytes memory expectedError;
        if (id == 0 || id > posts.length) {
            expectedError = abi.encodeWithSelector(Soapbox.PostNotFound.selector, id);
        } else if (amount < 1e18) {
            expectedError = abi.encodeWithSelector(Soapbox.TipTooSmall.selector, amount);
        } else {
            expectedError = _paymentError(actor, amount);
        }

        vm.prank(actors[actor]);
        (bool ok, bytes memory result) = address(box).call(abi.encodeCall(box.tip, (id, amount)));
        assertEq(ok, expectedError.length == 0, "tip success must match model");
        if (ok) {
            ExpectedPost storage entry = posts[id - 1];
            balances[actor] -= amount;
            balances[entry.authorIndex] += amount;
            entry.tips += amount;
            _spendApproval(actor, amount);
        } else {
            assertEq(result, expectedError, "tip failure must match model");
        }
        _assertModel();
    }

    function _paymentError(uint256 actor, uint256 amount) private view returns (bytes memory) {
        if (allowances[actor] < amount) {
            return abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(box), allowances[actor], amount
            );
        }
        if (balances[actor] < amount) {
            return abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, actors[actor], balances[actor], amount
            );
        }
        return "";
    }

    function _spendApproval(uint256 actor, uint256 amount) private {
        if (allowances[actor] != type(uint256).max) allowances[actor] -= amount;
    }

    function _assertModel() private view {
        uint256 deadBalance = posts.length * FEE;
        uint256 total = soap.balanceOf(address(this)) + deadBalance;
        assertEq(box.postCount(), posts.length);
        assertEq(soap.balanceOf(DEAD), deadBalance, "one exact fee for every successful post");
        assertEq(soap.balanceOf(address(box)), 0, "application never takes custody during posts or tips");
        assertEq(address(box).balance, 0);
        for (uint256 i; i < actors.length; ++i) {
            assertEq(soap.balanceOf(actors[i]), balances[i], "model wallet balance");
            assertEq(soap.allowance(actors[i], address(box)), allowances[i], "model allowance");
            total += balances[i];
        }
        assertEq(total, 1e27, "all tokens accounted for");
        assertEq(soap.totalSupply(), total, "fixed supply conserved");
        for (uint256 i; i < posts.length; ++i) {
            Soapbox.Post memory actual = box.post(i + 1);
            ExpectedPost memory expected = posts[i];
            assertEq(actual.author, actors[expected.authorIndex], "author immutable");
            assertEq(actual.topic, expected.topic, "topic immutable");
            assertEq(actual.timestamp, expected.timestamp, "timestamp immutable");
            assertEq(actual.tipsTotal, expected.tips, "tips credited only to the chosen post");
        }
    }
}
