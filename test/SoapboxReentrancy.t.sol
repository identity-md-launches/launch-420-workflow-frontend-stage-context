// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Soapbox} from "../src/Soapbox.sol";

/// @dev Adversarial token used only to exercise callbacks; the deployed SOAP token has no hooks.
contract CallbackToken is ERC20 {
    Soapbox private target;
    bytes private payload;
    bool private entered;
    bool public attempted;
    bool public callbackSuccess;
    bytes public callbackResult;

    constructor() ERC20("Callback test", "TEST") {
        _mint(msg.sender, 10_000e18);
        _mint(address(this), 1_000e18);
    }

    function arm(Soapbox app, bytes memory data) external {
        target = app;
        payload = data;
        _approve(address(this), address(app), type(uint256).max);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (address(target) != address(0) && !entered) {
            entered = true;
            attempted = true;
            (callbackSuccess, callbackResult) = address(target).call(payload);
            entered = false;
        }
        return super.transferFrom(from, to, amount);
    }
}

contract SoapboxReentrancyTest is Test {
    function test_postCannotReenterPost() public {
        _attemptReentry(true, true);
    }

    function test_postCannotReenterTip() public {
        _attemptReentry(true, false);
    }

    function test_tipCannotReenterPost() public {
        _attemptReentry(false, true);
    }

    function test_tipCannotReenterTip() public {
        _attemptReentry(false, false);
    }

    function _attemptReentry(bool outerPost, bool innerPost) private {
        CallbackToken token = new CallbackToken();
        Soapbox box = new Soapbox(address(token));
        token.approve(address(box), type(uint256).max);
        box.post(bytes32("first"), "first");
        bytes memory payload = innerPost
            ? abi.encodeWithSignature("post(bytes32,string)", bytes32("nested"), "nested")
            : abi.encodeCall(box.tip, (1, 1e18));
        token.arm(box, payload);
        if (outerPost) {
            box.post(bytes32("second"), "second");
        } else {
            box.tip(1, 1e18);
        }
        assertTrue(token.attempted());
        assertFalse(token.callbackSuccess());
        assertEq(token.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(box.postCount(), outerPost ? 2 : 1);
        assertEq(box.post(1).tipsTotal, outerPost ? 0 : 1e18);
        assertEq(token.balanceOf(address(box)), 0);
        assertEq(token.balanceOf(address(token)), 1_000e18);
        assertEq(token.balanceOf(address(this)), outerPost ? 9_800e18 : 9_900e18);
        assertEq(token.balanceOf(box.BURN_ADDRESS()), outerPost ? 200e18 : 100e18);
    }
}
