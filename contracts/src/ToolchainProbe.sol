// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Compiler smoke test only. This is not the ArcMandate vault.
contract ToolchainProbe {
    function ready() external pure returns (bool) {
        return true;
    }
}
