// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {Soapbox} from "../src/Soapbox.sol";

abstract contract SoapboxFixture is Test {
    LaunchToken internal soap;
    Soapbox internal box;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA401);
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant INITIAL_BALANCE = 10_000e18;
    uint256 internal constant FEE = 100e18;
    bytes32 internal constant TOPIC = bytes32("soap");

    function setUp() public virtual {
        soap = new LaunchToken();
        box = new Soapbox(address(soap));
        _fund(ALICE);
        _fund(BOB);
        _fund(CAROL);
    }

    function _fund(address actor) internal {
        soap.transfer(actor, INITIAL_BALANCE);
        vm.prank(actor);
        soap.approve(address(box), type(uint256).max);
    }

    function _publish(address author, bytes32 topic, string memory body) internal returns (uint256 id) {
        vm.prank(author);
        id = box.post(topic, body);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function _body(uint256 length) internal pure returns (string memory) {
        bytes memory content = new bytes(length);
        for (uint256 i; i < length; ++i) {
            content[i] = "a";
        }
        return string(content);
    }
}

contract SoapboxTest is SoapboxFixture {
    event Posted(uint256 indexed id, address indexed author, bytes32 indexed topic, string body);
    event Tipped(uint256 indexed postId, address indexed tipper, uint256 amount);

    function test_constructorNeedsNoFundingOrInitialization() public view {
        assertEq(address(box.token()), address(soap));
        assertEq(box.postCount(), 0);
        assertEq(soap.balanceOf(address(box)), 0);
        assertEq(address(box).balance, 0);
        assertEq(box.POST_FEE(), FEE);
        assertEq(box.MIN_TIP(), 1e18);
        assertEq(box.MAX_BODY_BYTES(), 280);
        assertEq(box.BURN_ADDRESS(), DEAD);
    }

    function test_constructorRejectsZeroAndNonContractToken() public {
        vm.expectRevert(abi.encodeWithSelector(Soapbox.InvalidToken.selector, address(0)));
        new Soapbox(address(0));
        vm.expectRevert(abi.encodeWithSelector(Soapbox.InvalidToken.selector, ALICE));
        new Soapbox(ALICE);
    }

    function test_postOneByteEmitsBodyAndStoresMetadata() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(true, true, true, true, address(box));
        emit Posted(1, ALICE, TOPIC, "a");
        uint256 id = _publish(ALICE, TOPIC, "a");
        assertEq(id, 1);
        assertEq(box.postCount(), 1);
        Soapbox.Post memory entry = box.post(id);
        assertEq(entry.author, ALICE);
        assertEq(entry.topic, TOPIC);
        assertEq(entry.timestamp, 1_800_000_000);
        assertEq(entry.tipsTotal, 0);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE);
        assertEq(soap.balanceOf(DEAD), FEE);
        assertEq(soap.totalSupply(), 1e27);
    }

    function test_post280BytesPaysExactly100Soap() public {
        uint256 id = _publish(ALICE, bytes32(0), _body(280));
        assertEq(id, 1);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE);
        assertEq(soap.balanceOf(DEAD), FEE);
        assertEq(box.post(id).topic, bytes32(0));
        assertEq(soap.totalSupply(), 1e27);
    }

    function test_emptyBodyRevertsWithoutBurnOrId() public {
        _assertRejectedBody("");
    }

    function test_281ByteBodyRevertsWithoutBurnOrId() public {
        _assertRejectedBody(_body(281));
    }

    function test_utf8LimitCountsBytesInsteadOfCharacters() public {
        string memory body = string(abi.encodePacked(_body(276), unicode"🧼"));
        assertEq(bytes(body).length, 280);
        _publish(ALICE, TOPIC, body);
        _assertRejectedBody(string(abi.encodePacked(body, "a")));
    }

    function test_duplicateContentAndArbitraryTopicsAreAllowedWithSeparateFees() public {
        bytes32 topic = bytes32("<script>alert(1)</script>");
        string memory body = "<img src=x onerror=alert(1)>";
        vm.expectEmit(true, true, true, true, address(box));
        emit Posted(1, ALICE, topic, body);
        _publish(ALICE, topic, body);
        vm.warp(1_800_000_001);
        uint256 second = _publish(BOB, topic, body);
        assertEq(second, 2);
        assertEq(box.post(1).author, ALICE);
        assertEq(box.post(2).author, BOB);
        assertEq(box.post(2).timestamp, 1_800_000_001);
        assertEq(soap.balanceOf(DEAD), 2 * FEE);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE);
        assertEq(soap.balanceOf(BOB), INITIAL_BALANCE - FEE);
    }

    function test_exactApprovalIsConsumedAndCannotPayForSecondPost() public {
        vm.prank(ALICE);
        soap.approve(address(box), FEE);
        _publish(ALICE, TOPIC, "first");
        assertEq(soap.allowance(ALICE, address(box)), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(box), 0, FEE));
        vm.prank(ALICE);
        box.post(TOPIC, "unpaid");
        assertEq(box.postCount(), 1);
        assertEq(soap.balanceOf(DEAD), FEE);
        vm.expectRevert(abi.encodeWithSelector(Soapbox.PostNotFound.selector, 2));
        box.post(2);
        vm.prank(ALICE);
        soap.approve(address(box), FEE);
        assertEq(_publish(ALICE, TOPIC, "second"), 2);
    }

    function test_postInsufficientApprovalRevertsAtomically() public {
        vm.prank(ALICE);
        soap.approve(address(box), FEE - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(box), FEE - 1, FEE)
        );
        vm.prank(ALICE);
        box.post(TOPIC, "unpaid");
        assertEq(box.postCount(), 0);
        assertEq(soap.allowance(ALICE, address(box)), FEE - 1);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE);
        assertEq(soap.balanceOf(DEAD), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_postInsufficientBalanceRevertsAtomically() public {
        vm.startPrank(ALICE);
        soap.transfer(BOB, INITIAL_BALANCE - FEE + 1);
        soap.approve(address(box), FEE);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, FEE - 1, FEE));
        box.post(TOPIC, "unpaid");
        vm.stopPrank();
        assertEq(box.postCount(), 0);
        assertEq(soap.allowance(ALICE, address(box)), FEE);
        assertEq(soap.balanceOf(DEAD), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_tipPaysAuthorAndEmitsEvent() public {
        _publish(ALICE, TOPIC, "tip me");
        vm.prank(BOB);
        soap.approve(address(box), 7e18);
        vm.expectEmit(true, true, false, true, address(box));
        emit Tipped(1, BOB, 7e18);
        vm.prank(BOB);
        box.tip(1, 7e18);
        assertEq(box.post(1).tipsTotal, 7e18);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE + 7e18);
        assertEq(soap.balanceOf(BOB), INITIAL_BALANCE - 7e18);
        assertEq(soap.balanceOf(DEAD), FEE);
        assertEq(soap.allowance(BOB, address(box)), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_minimumTipAccepted() public {
        _publish(ALICE, TOPIC, "one");
        vm.prank(BOB);
        box.tip(1, 1e18);
        assertEq(box.post(1).tipsTotal, 1e18);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE + 1e18);
        assertEq(soap.balanceOf(BOB), INITIAL_BALANCE - 1e18);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_tipsStayWithSelectedPostAndAuthor() public {
        _publish(ALICE, TOPIC, "alice one");
        _publish(BOB, TOPIC, "bob two");
        _publish(ALICE, bytes32("elsewhere"), "alice three");
        vm.startPrank(CAROL);
        box.tip(2, 2e18);
        box.tip(1, 3e18);
        box.tip(2, 5e18);
        box.tip(3, 11e18);
        vm.stopPrank();
        assertEq(box.post(1).tipsTotal, 3e18);
        assertEq(box.post(2).tipsTotal, 7e18);
        assertEq(box.post(3).tipsTotal, 11e18);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - 2 * FEE + 14e18);
        assertEq(soap.balanceOf(BOB), INITIAL_BALANCE - FEE + 7e18);
        assertEq(soap.balanceOf(CAROL), INITIAL_BALANCE - 21e18);
        assertEq(soap.balanceOf(DEAD), 3 * FEE);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_selfTipsCountButDoNotChangeBalance() public {
        _publish(ALICE, TOPIC, "mine");
        vm.startPrank(ALICE);
        soap.approve(address(box), 123e18);
        box.tip(1, 123e18);
        vm.stopPrank();
        assertEq(box.post(1).tipsTotal, 123e18);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE);
        assertEq(soap.allowance(ALICE, address(box)), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_tipZeroAndBelowMinimumRevertWithoutPayment() public {
        _publish(ALICE, TOPIC, "mine");
        _assertRejectedTip(1, 0, abi.encodeWithSelector(Soapbox.TipTooSmall.selector, 0));
        _assertRejectedTip(1, 1e18 - 1, abi.encodeWithSelector(Soapbox.TipTooSmall.selector, 1e18 - 1));
        assertEq(box.post(1).tipsTotal, 0);
    }

    function test_missingPostsCannotBeTippedOrRead() public {
        _publish(ALICE, TOPIC, "one");
        _assertRejectedTip(0, 1e18, abi.encodeWithSelector(Soapbox.PostNotFound.selector, 0));
        _assertRejectedTip(2, 1e18, abi.encodeWithSelector(Soapbox.PostNotFound.selector, 2));
        _assertRejectedTip(
            type(uint256).max, 1e18, abi.encodeWithSelector(Soapbox.PostNotFound.selector, type(uint256).max)
        );
        vm.expectRevert(abi.encodeWithSelector(Soapbox.PostNotFound.selector, 0));
        box.post(0);
        vm.expectRevert(abi.encodeWithSelector(Soapbox.PostNotFound.selector, 2));
        box.post(2);
        assertEq(box.post(1).tipsTotal, 0);
    }

    function test_tipInsufficientApprovalRollsBackTotal() public {
        _publish(ALICE, TOPIC, "one");
        vm.prank(BOB);
        soap.approve(address(box), 1e18 - 1);
        _assertRejectedTip(
            1,
            1e18,
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(box), 1e18 - 1, 1e18)
        );
        assertEq(box.post(1).tipsTotal, 0);
    }

    function test_tipInsufficientBalanceRollsBackTotalAndAllowance() public {
        _publish(ALICE, TOPIC, "one");
        uint256 amount = INITIAL_BALANCE + 1;
        vm.prank(BOB);
        soap.approve(address(box), amount);
        _assertRejectedTip(
            1,
            amount,
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, BOB, INITIAL_BALANCE, amount)
        );
        assertEq(box.post(1).tipsTotal, 0);
    }

    function test_safeTransferFromFalseCannotCreateFreePost() public {
        vm.mockCall(address(soap), abi.encodeCall(IERC20.transferFrom, (ALICE, DEAD, FEE)), abi.encode(false));
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(soap)));
        vm.prank(ALICE);
        box.post(TOPIC, "free?");
        assertEq(box.postCount(), 0);
        assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE);
        assertEq(soap.balanceOf(DEAD), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_safeTransferFromFalseCannotCreditTip() public {
        _publish(ALICE, TOPIC, "one");
        vm.mockCall(address(soap), abi.encodeCall(IERC20.transferFrom, (BOB, ALICE, 1e18)), abi.encode(false));
        _assertRejectedTip(1, 1e18, abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(soap)));
        assertEq(box.post(1).tipsTotal, 0);
    }

    function test_rejectsEthAndUnknownCalls() public {
        vm.deal(ALICE, 1 ether);
        vm.startPrank(ALICE);
        (bool sent,) = address(box).call{value: 1}("");
        assertFalse(sent);
        (bool posted,) = address(box).call{value: 1}(abi.encodeWithSignature("post(bytes32,string)", TOPIC, "paid eth"));
        assertFalse(posted);
        (bool tipped,) = address(box).call{value: 1}(abi.encodeCall(box.tip, (1, 1e18)));
        assertFalse(tipped);
        (bool fallbackAccepted,) = address(box).call(hex"ffffffff");
        assertFalse(fallbackAccepted);
        vm.stopPrank();
        assertEq(address(box).balance, 0);
        assertEq(box.postCount(), 0);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function test_unsolicitedSoapIsNotCreditedOrUsedForFees() public {
        // ERC-20 transfers cannot be refused by the recipient. No sweep authority exists.
        soap.transfer(address(box), FEE);
        vm.prank(ALICE);
        soap.approve(address(box), 0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(box), 0, FEE));
        vm.prank(ALICE);
        box.post(TOPIC, "use donation?");
        assertEq(box.postCount(), 0);
        assertEq(soap.balanceOf(address(box)), FEE);
        assertEq(soap.balanceOf(DEAD), 0);
    }

    function testFuzz_bodyBoundariesAndExactFee(bytes32 topic, uint16 rawLength) public {
        uint256 length = bound(uint256(rawLength), 0, 600);
        string memory body = _body(length);
        if (length == 0 || length > 280) {
            _assertRejectedBody(body);
        } else {
            uint256 id = _publish(ALICE, topic, body);
            assertEq(box.post(id).topic, topic);
            assertEq(soap.balanceOf(ALICE), INITIAL_BALANCE - FEE);
            assertEq(soap.balanceOf(DEAD), FEE);
        }
    }

    function _assertRejectedBody(string memory body) private {
        uint256 count = box.postCount();
        uint256 balance = soap.balanceOf(ALICE);
        uint256 deadBalance = soap.balanceOf(DEAD);
        uint256 allowance = soap.allowance(ALICE, address(box));
        vm.expectRevert(abi.encodeWithSelector(Soapbox.InvalidBodyLength.selector, bytes(body).length));
        vm.prank(ALICE);
        box.post(TOPIC, body);
        assertEq(box.postCount(), count);
        assertEq(soap.balanceOf(ALICE), balance);
        assertEq(soap.balanceOf(DEAD), deadBalance);
        assertEq(soap.allowance(ALICE, address(box)), allowance);
        assertEq(soap.balanceOf(address(box)), 0);
    }

    function _assertRejectedTip(uint256 id, uint256 amount, bytes memory reason) private {
        uint256 authorBalance = soap.balanceOf(ALICE);
        uint256 tipperBalance = soap.balanceOf(BOB);
        uint256 allowance = soap.allowance(BOB, address(box));
        vm.expectRevert(reason);
        vm.prank(BOB);
        box.tip(id, amount);
        assertEq(soap.balanceOf(ALICE), authorBalance);
        assertEq(soap.balanceOf(BOB), tipperBalance);
        assertEq(soap.allowance(BOB, address(box)), allowance);
        assertEq(soap.balanceOf(address(box)), 0);
    }
}
