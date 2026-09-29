// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcMandateDigest} from "../src/lib/ArcMandateDigest.sol";

contract DigestHarness {
    address internal constant VAULT = 0x1111111111111111111111111111111111111111;
    address internal constant OWNER = 0x2222222222222222222222222222222222222222;
    uint256 internal constant CHAIN_ID = 5042002;

    function recipientsHash(address[] memory recipients) external pure returns (bytes32) {
        return ArcMandateDigest.recipientsHash(recipients);
    }

    function startParamsHash(ArcMandateDigest.Policy memory policy) external pure returns (bytes32) {
        return ArcMandateDigest.startParamsHash(policy);
    }

    function startSessionDigest(
        ArcMandateDigest.Policy memory policy,
        ArcMandateDigest.Authorization memory auth
    ) external pure returns (bytes32) {
        return ArcMandateDigest.startSessionDigest(CHAIN_ID, VAULT, OWNER, policy, auth);
    }

    function freezeDigest(ArcMandateDigest.Authorization memory auth) external pure returns (bytes32) {
        return ArcMandateDigest.freezeDigest(CHAIN_ID, VAULT, OWNER, auth);
    }

    function withdrawParamsHash(address to, uint256 amount) external pure returns (bytes32) {
        return ArcMandateDigest.withdrawParamsHash(to, amount);
    }

    function withdrawDigest(address to, uint256 amount, ArcMandateDigest.Authorization memory auth)
        external
        pure
        returns (bytes32)
    {
        return ArcMandateDigest.withdrawDigest(CHAIN_ID, VAULT, OWNER, to, amount, auth);
    }
}

contract ArcMandateDigestTest {
    DigestHarness internal harness;

    function setUp() public {
        harness = new DigestHarness();
    }

    function _policy() internal pure returns (ArcMandateDigest.Policy memory policy) {
        address[] memory recipients = new address[](2);
        recipients[0] = 0x4444444444444444444444444444444444444444;
        recipients[1] = 0x5555555555555555555555555555555555555555;
        policy = ArcMandateDigest.Policy({
            agent: 0x3333333333333333333333333333333333333333,
            totalBudget: 150000,
            perTxCap: 50000,
            expiresAt: 1900000000,
            recipients: recipients
        });
    }

    function _auth() internal pure returns (ArcMandateDigest.Authorization memory) {
        return ArcMandateDigest.Authorization({nonce: 7, sessionId: 3, deadline: 1899999000});
    }

    function testFixtureHashesMatchTypeScript() public view {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        address to = 0x6666666666666666666666666666666666666666;

        require(
            harness.recipientsHash(policy.recipients)
                == 0x3297ea34cc6cfd21bc63dcfe8260887dee1f15d2357475e8ea4e49d86bcc7af1,
            "recipients hash mismatch"
        );
        require(
            harness.startParamsHash(policy)
                == 0xdcb3c5dbf64e33660d7ef57a6f54ca9265361c6f15f5247cb65f144579327a1d,
            "start params mismatch"
        );
        require(
            harness.startSessionDigest(policy, auth)
                == 0x4477ad6fef783669b043225eb023c17df92d67f718b562f4600f0275c998b377,
            "start digest mismatch"
        );
        require(
            harness.freezeDigest(auth)
                == 0x75bd59c8cbf50220bf0652fdbe81d56a430517a1fc1355eb94fd2a84b2758a9f,
            "freeze digest mismatch"
        );
        require(
            harness.withdrawParamsHash(to, 77777)
                == 0xdcf40b2e11aed3282010a41b710af5fedf5407d05c3ec6f70915c4ed6e064107,
            "withdraw params mismatch"
        );
        require(
            harness.withdrawDigest(to, 77777, auth)
                == 0x1e907c88981e0cb1dd694ad3f4fe29aa32f62eb15362991cb42eb2790de18499,
            "withdraw digest mismatch"
        );
    }

    function testNonceChangeInvalidatesStartDigest() public view {
        ArcMandateDigest.Authorization memory auth = _auth();
        bytes32 original = harness.startSessionDigest(_policy(), auth);
        auth.nonce++;
        require(harness.startSessionDigest(_policy(), auth) != original, "nonce did not change digest");
    }
}
