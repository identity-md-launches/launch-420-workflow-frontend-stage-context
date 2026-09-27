// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken private token;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint256 private constant SUPPLY = 1e27;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setUp() public {
        token = new LaunchToken();
    }

    function test_fixedSupplyAndMetadata() public view {
        assertEq(token.name(), "Soapbox");
        assertEq(token.symbol(), "SOAP");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(this)), SUPPLY);
        assertEq(token.balanceOf(ALICE), 0);
    }

    function test_transferIsExactAndEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(address(this), ALICE, 123e18);
        assertTrue(token.transfer(ALICE, 123e18));
        assertEq(token.balanceOf(ALICE), 123e18);
        assertEq(token.balanceOf(address(this)), SUPPLY - 123e18);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_approvalAndTransferFromConsumeAllowance() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Approval(address(this), BOB, 5e18);
        assertTrue(token.approve(BOB, 5e18));
        vm.prank(BOB);
        assertTrue(token.transferFrom(address(this), ALICE, 3e18));
        assertEq(token.allowance(address(this), BOB), 2e18);
        assertEq(token.balanceOf(ALICE), 3e18);
        assertEq(token.balanceOf(address(this)), SUPPLY - 3e18);
    }

    function test_infiniteAllowanceRemainsUnchanged() public {
        token.approve(BOB, type(uint256).max);
        vm.prank(BOB);
        token.transferFrom(address(this), ALICE, 1e18);
        assertEq(token.allowance(address(this), BOB), type(uint256).max);
    }

    function test_transferInsufficientBalanceReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, 0, 1));
        vm.prank(ALICE);
        token.transfer(BOB, 1);
        assertEq(token.balanceOf(BOB), 0);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferFromRequiresApprovalEvenForOwner() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(this), 0, 1));
        token.transferFrom(address(this), ALICE, 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, BOB, 0, 1));
        vm.prank(BOB);
        token.transferFrom(address(this), ALICE, 1);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(address(this)), SUPPLY);
    }

    function test_zeroAddressTransferAndApprovalRevert() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        token.approve(address(0), 1);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_noMintOrAdministrativeEntryPointsForDeployerOrStranger() public {
        bytes[] memory calls = new bytes[](12);
        calls[0] = abi.encodeWithSignature("mint(address,uint256)", ALICE, 1e27);
        calls[1] = abi.encodeWithSignature("mint(uint256)", 1e27);
        calls[2] = abi.encodeWithSignature("mint()");
        calls[3] = abi.encodeWithSignature("issue(uint256)", 1e27);
        calls[4] = abi.encodeWithSignature("setOwner(address)", ALICE);
        calls[5] = abi.encodeWithSignature("transferOwnership(address)", ALICE);
        calls[6] = abi.encodeWithSignature("upgradeTo(address)", ALICE);
        calls[7] = abi.encodeWithSignature("initialize(address)", ALICE);
        calls[8] = abi.encodeWithSignature("pause()");
        calls[9] = abi.encodeWithSignature("unpause()");
        calls[10] = abi.encodeWithSignature("setMinter(address)", ALICE);
        calls[11] = abi.encodeWithSignature("setFee(uint256)", 10);
        for (uint256 i; i < calls.length; ++i) {
            (bool deployerSuccess,) = address(token).call(calls[i]);
            assertFalse(deployerSuccess);
            vm.prank(ALICE);
            (bool attackerSuccess,) = address(token).call(calls[i]);
            assertFalse(attackerSuccess);
            assertEq(token.totalSupply(), SUPPLY);
            assertEq(token.balanceOf(address(this)), SUPPLY);
            assertEq(token.balanceOf(ALICE), 0);
        }
    }

    function testFuzz_transfersConserveSupply(uint256 rawAmount) public {
        uint256 amount = bound(rawAmount, 0, SUPPLY);
        token.transfer(ALICE, amount);
        assertEq(token.balanceOf(ALICE), amount);
        assertEq(token.balanceOf(address(this)), SUPPLY - amount);
        vm.prank(ALICE);
        token.transfer(BOB, amount);
        assertEq(token.balanceOf(ALICE), 0);
        assertEq(token.balanceOf(BOB), amount);
        assertEq(token.balanceOf(address(this)) + token.balanceOf(BOB), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }
}
