// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Arc native SLH-DSA-SHA2-128s verifier. Only the exact ABI word 1 is accepted.
library PQVerifier {
    address internal constant PRECOMPILE = 0x1800000000000000000000000000000000000004;
    bytes4 internal constant SELECTOR = bytes4(keccak256("verifySlhDsaSha2128s(bytes,bytes,bytes)"));
    uint256 internal constant SIGNATURE_LENGTH = 7856;

    function verify(bytes32 publicKey, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (signature.length != SIGNATURE_LENGTH) return false;

        (bool success, bytes memory result) = PRECOMPILE.staticcall(
            abi.encodeWithSelector(SELECTOR, abi.encodePacked(publicKey), abi.encodePacked(digest), signature)
        );
        return success && result.length == 32 && abi.decode(result, (uint256)) == 1;
    }
}
