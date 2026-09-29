// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Shared authorization encoding; it does not validate policy or authorization state.
library ArcMandateDigest {
    struct Policy {
        address agent;
        uint256 totalBudget;
        uint256 perTxCap;
        uint256 expiresAt;
        address[] recipients;
    }

    struct Authorization {
        uint256 nonce;
        uint256 sessionId;
        uint256 deadline;
    }

    bytes32 internal constant DOMAIN = keccak256("ArcMandate");
    bytes32 internal constant VERSION = keccak256("1");
    bytes32 internal constant START = keccak256("START_SESSION");
    bytes32 internal constant FREEZE = keccak256("FREEZE");
    bytes32 internal constant WITHDRAW = keccak256("WITHDRAW");

    function recipientsHash(address[] memory recipients) internal pure returns (bytes32) {
        return keccak256(abi.encode(recipients));
    }

    function startParamsHash(Policy memory policy) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                policy.agent,
                policy.totalBudget,
                policy.perTxCap,
                policy.expiresAt,
                recipientsHash(policy.recipients)
            )
        );
    }

    function withdrawParamsHash(address to, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(to, amount));
    }

    function authorizationDigest(
        uint256 chainId,
        address vault,
        address owner,
        bytes32 action,
        Authorization memory auth,
        bytes32 paramsHash
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN,
                VERSION,
                chainId,
                vault,
                owner,
                action,
                auth.nonce,
                auth.sessionId,
                auth.deadline,
                paramsHash
            )
        );
    }

    function startSessionDigest(
        uint256 chainId,
        address vault,
        address owner,
        Policy memory policy,
        Authorization memory auth
    ) internal pure returns (bytes32) {
        return authorizationDigest(chainId, vault, owner, START, auth, startParamsHash(policy));
    }

    function freezeDigest(uint256 chainId, address vault, address owner, Authorization memory auth)
        internal
        pure
        returns (bytes32)
    {
        return authorizationDigest(chainId, vault, owner, FREEZE, auth, bytes32(0));
    }

    function withdrawDigest(
        uint256 chainId,
        address vault,
        address owner,
        address to,
        uint256 amount,
        Authorization memory auth
    ) internal pure returns (bytes32) {
        return authorizationDigest(chainId, vault, owner, WITHDRAW, auth, withdrawParamsHash(to, amount));
    }
}
