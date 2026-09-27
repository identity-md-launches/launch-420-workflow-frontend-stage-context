// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {Soapbox} from "../src/Soapbox.sol";

/// @dev Local constructor probe only, not a replacement for the service-owned ProjectFactory.
contract LocalDeploymentProbe {
    function deploy(bytes memory code, bytes32 salt) external returns (address result) {
        assembly ("memory-safe") {
            result := create2(0, add(code, 32), mload(code), salt)
        }
        require(result != address(0), "deployment failed");
    }

    function tryDeployWithValue(bytes memory code) external payable returns (address result) {
        assembly ("memory-safe") {
            result := create(callvalue(), add(code, 32), mload(code))
        }
    }
}

contract DeploymentTest is Test {
    function test_factoryStyleConstructorsPreserveSupplyAndConfigureApp() public {
        vm.chainId(11155111);
        LocalDeploymentProbe factory = new LocalDeploymentProbe();
        LaunchToken token = LaunchToken(factory.deploy(type(LaunchToken).creationCode, bytes32(uint256(1))));
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(factory)), 1e27);
        bytes memory code = abi.encodePacked(type(Soapbox).creationCode, abi.encode(address(token)));
        Soapbox box = Soapbox(factory.deploy(code, bytes32(uint256(2))));
        assertEq(address(box.token()), address(token));
        assertEq(box.postCount(), 0);
        assertEq(token.balanceOf(address(box)), 0);
        assertEq(token.balanceOf(address(factory)), 1e27);
        assertEq(token.totalSupply(), 1e27);
        _assertRuntime(address(token));
        _assertRuntime(address(box));
    }

    function test_constructorsRejectEth() public {
        LocalDeploymentProbe factory = new LocalDeploymentProbe();
        LaunchToken token = new LaunchToken();
        vm.deal(address(this), 2);
        assertEq(factory.tryDeployWithValue{value: 1}(type(LaunchToken).creationCode), address(0));
        bytes memory code = abi.encodePacked(type(Soapbox).creationCode, abi.encode(address(token)));
        assertEq(factory.tryDeployWithValue{value: 1}(code), address(0));
    }

    function _assertRuntime(address target) private view {
        bytes memory code = target.code;
        assertGt(code.length, 0);
        assertLe(code.length, 24_576);
        for (uint256 i; i < code.length; ++i) {
            uint8 opcode = uint8(code[i]);
            if (opcode >= 0x60 && opcode <= 0x7f) {
                i += opcode - 0x5f;
                continue;
            }
            assertTrue(opcode != 0xf4 && opcode != 0xf2 && opcode != 0xff, "forbidden runtime opcode");
        }
    }
}
