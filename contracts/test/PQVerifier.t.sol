// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PQVerifier} from "../src/lib/PQVerifier.sol";

interface Vm {
    function etch(address target, bytes calldata code) external;
}

contract PQVerifierHarness {
    function verify(bytes32 publicKey, bytes32 digest, bytes calldata signature) external view returns (bool) {
        return PQVerifier.verify(publicKey, digest, signature);
    }
}

contract MockTrueVerifier {
    function verifySlhDsaSha2128s(bytes calldata, bytes calldata, bytes calldata) external pure returns (bool) {
        return true;
    }
}

contract MockFalseVerifier {
    function verifySlhDsaSha2128s(bytes calldata, bytes calldata, bytes calldata) external pure returns (bool) {
        return false;
    }
}

contract MockMalformedVerifier {
    fallback() external {
        assembly {
            mstore(0, 2)
            return(0, 32)
        }
    }
}

contract MockEmptyVerifier {
    fallback() external {}
}
contract Mock31Verifier { fallback() external { assembly { mstore(0, 1) return(0, 31) } } }
contract Mock33Verifier { fallback() external { assembly { mstore(0, 1) return(0, 33) } } }

contract PQVerifierTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant PRECOMPILE = 0x1800000000000000000000000000000000000004;
    PQVerifierHarness internal harness;

    function setUp() public {
        harness = new PQVerifierHarness();
    }

    function testAcceptsOnlyExactTrueWord() public {
        bytes memory signature = new bytes(7856);
        vm.etch(PRECOMPILE, address(new MockTrueVerifier()).code);
        require(harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "true not accepted");

        vm.etch(PRECOMPILE, address(new MockFalseVerifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "false accepted");

        vm.etch(PRECOMPILE, address(new MockMalformedVerifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "noncanonical word accepted");

        vm.etch(PRECOMPILE, address(new MockEmptyVerifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "empty result accepted");
        vm.etch(PRECOMPILE, address(new Mock31Verifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "31-byte result accepted");
        vm.etch(PRECOMPILE, address(new Mock33Verifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), signature), "33-byte result accepted");
    }

    function testRejectsWrongSignatureLength() public {
        vm.etch(PRECOMPILE, address(new MockTrueVerifier()).code);
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), new bytes(7855)), "short sig accepted");
        require(!harness.verify(bytes32(uint256(1)), bytes32(uint256(2)), new bytes(7857)), "long sig accepted");
    }
}
