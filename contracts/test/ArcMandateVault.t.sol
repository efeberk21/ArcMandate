// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ArcMandateVault} from "../src/ArcMandateVault.sol";
import {ArcMandateDigest} from "../src/lib/ArcMandateDigest.sol";

interface VaultVm {
    function etch(address target, bytes calldata code) external;
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert() external;
}

contract MockArcUSDC is ERC20 {
    bool public failTransfers;
    bool public attemptReentry;
    bytes4 public reentrySelector;
    address public vaultTarget;
    uint256 public reentrySession;

    constructor() ERC20("Mock Arc USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function setReentry(address target, uint256 session) external {
        vaultTarget = target;
        reentrySession = session;
        attemptReentry = true;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (failTransfers) revert("MOCK_TRANSFER_FAILED");
        if (attemptReentry) {
            attemptReentry = false;
            (bool ok, bytes memory result) = vaultTarget.call(
                abi.encodeWithSelector(ArcMandateVault.agentPay.selector, reentrySession, bytes32(uint256(999)), to, 1)
            );
            require(!ok && result.length >= 4, "reentry unexpectedly succeeded");
            bytes4 selector;
            assembly { selector := mload(add(result, 32)) }
            reentrySelector = selector;
        }
        return super.transfer(to, value);
    }
}

contract MockArcPQ {
    bytes32 public expectedDigest;
    bytes32 public expectedKey;
    uint8 public mode;

    function configure(bytes32 digest, bytes32 key, uint8 newMode) external {
        expectedDigest = digest;
        expectedKey = key;
        mode = newMode;
    }

    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata)
        external
        view
        returns (bool)
    {
        if (mode == 2) revert("MOCK_PQ_REVERT");
        if (mode == 3) assembly { return(0, 0) }
        if (mode == 4) assembly { mstore(0, 2) return(0, 32) }
        if (mode == 1) return false;
        return keccak256(vk) == keccak256(abi.encodePacked(expectedKey))
            && keccak256(message) == keccak256(abi.encodePacked(expectedDigest));
    }
}

contract ArcMandateVaultTest {
    VaultVm internal constant VM = VaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;
    address internal constant PQ_ADDRESS = 0x1800000000000000000000000000000000000004;
    address internal constant OWNER = address(0xA11CE);
    address internal constant AGENT = address(0xA6E17);
    address internal constant RECIPIENT = address(0xB0B);
    address internal constant RECIPIENT_2 = address(0xC0C);
    bytes32 internal constant PQ_KEY = bytes32(uint256(123));

    ArcMandateVault internal vault;
    MockArcUSDC internal usdc;
    MockArcPQ internal pq;

    function setUp() public {
        VM.warp(1_800_000_000);
        VM.etch(USDC_ADDRESS, address(new MockArcUSDC()).code);
        VM.etch(PQ_ADDRESS, address(new MockArcPQ()).code);
        usdc = MockArcUSDC(USDC_ADDRESS);
        pq = MockArcPQ(PQ_ADDRESS);
        vault = new ArcMandateVault(OWNER, PQ_KEY);
        usdc.mint(address(vault), 1_000_000);
    }

    function _sig() internal pure returns (bytes memory) {
        return new bytes(7856);
    }

    function _policy() internal view returns (ArcMandateDigest.Policy memory policy) {
        address[] memory recipients = new address[](2);
        recipients[0] = RECIPIENT;
        recipients[1] = RECIPIENT_2;
        policy = ArcMandateDigest.Policy({
            agent: AGENT,
            totalBudget: 150_000,
            perTxCap: 50_000,
            expiresAt: block.timestamp + 900,
            recipients: recipients
        });
    }

    function _auth() internal view returns (ArcMandateDigest.Authorization memory) {
        return ArcMandateDigest.Authorization(vault.controlNonce(), vault.sessionId(), block.timestamp + 600);
    }

    function _authorizeStart(
        ArcMandateDigest.Policy memory policy,
        ArcMandateDigest.Authorization memory auth
    ) internal {
        pq.configure(vault.startSessionDigest(policy, auth), PQ_KEY, 0);
    }

    function _start() internal {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeStart(policy, auth);
        VM.prank(OWNER);
        vault.startSession(policy, auth, _sig());
    }

    function _pay(uint256 id, uint256 amount) internal {
        uint256 currentSession = vault.sessionId();
        VM.prank(AGENT);
        vault.agentPay(currentSession, bytes32(id), RECIPIENT, amount);
    }

    function _authorizeFreeze(ArcMandateDigest.Authorization memory auth) internal {
        pq.configure(vault.freezeDigest(auth), PQ_KEY, 0);
    }

    function _authorizeWithdraw(address to, uint256 amount, ArcMandateDigest.Authorization memory auth)
        internal
    {
        pq.configure(vault.withdrawDigest(to, amount, auth), PQ_KEY, 0);
    }

    function testT01ConstructorAndInitialState() public {
        require(vault.owner() == OWNER && vault.pqPublicKey() == PQ_KEY, "constructor values");
        require(vault.sessionId() == 0 && vault.controlNonce() == 0 && !vault.active(), "initial state");
        VM.expectRevert(ArcMandateVault.InvalidPolicy.selector);
        new ArcMandateVault(address(0), PQ_KEY);
        VM.expectRevert(ArcMandateVault.InvalidPolicy.selector);
        new ArcMandateVault(OWNER, bytes32(0));
    }

    function testT01PolicyValidation() public {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();

        policy.agent = address(0);
        _rejectPolicy(policy, auth);
        policy.agent = OWNER;
        _rejectPolicy(policy, auth);
        policy.agent = address(vault);
        _rejectPolicy(policy, auth);
        policy.agent = AGENT;
        policy.totalBudget = 0;
        _rejectPolicy(policy, auth);
        policy.totalBudget = 150_000;
        policy.perTxCap = 0;
        _rejectPolicy(policy, auth);
        policy.perTxCap = 150_001;
        _rejectPolicy(policy, auth);
        policy.perTxCap = 50_000;
        policy.expiresAt = block.timestamp;
        _rejectPolicy(policy, auth);
        policy.expiresAt = block.timestamp + 900;

        policy.recipients = new address[](0);
        _rejectPolicy(policy, auth);
        policy.recipients = new address[](6);
        for (uint256 i; i < 6; ++i) policy.recipients[i] = address(uint160(0xB00 + i));
        _rejectPolicy(policy, auth);
        policy.recipients = new address[](2);
        policy.recipients[0] = RECIPIENT;
        policy.recipients[1] = RECIPIENT;
        _rejectPolicy(policy, auth);
        policy.recipients[1] = address(0);
        _rejectPolicy(policy, auth);
        policy.recipients[1] = address(vault);
        _rejectPolicy(policy, auth);
        policy.recipients[0] = RECIPIENT_2;
        policy.recipients[1] = RECIPIENT;
        _rejectPolicy(policy, auth);
    }

    function _rejectPolicy(
        ArcMandateDigest.Policy memory policy,
        ArcMandateDigest.Authorization memory auth
    ) internal {
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPolicy.selector);
        vault.startSession(policy, auth, _sig());
    }

    function testT02OwnerAndPQBothRequired() public {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeStart(policy, auth);
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.Unauthorized.selector);
        vault.startSession(policy, auth, _sig());

        pq.configure(bytes32(0), PQ_KEY, 0);
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        vault.startSession(policy, auth, _sig());

        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.Unauthorized.selector);
        vault.withdraw(RECIPIENT, 10, auth, _sig());
        _authorizeWithdraw(RECIPIENT, 10, auth);
        VM.prank(OWNER);
        vault.withdraw(RECIPIENT, 10, auth, _sig());
        require(vault.controlNonce() == 1, "withdraw did not consume nonce");
    }

    function testT03LimitsAndFragmentedPayments() public {
        _start();
        uint256 currentSession = vault.sessionId();
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.PerPaymentLimitExceeded.selector);
        vault.agentPay(currentSession, bytes32(uint256(99)), RECIPIENT, 50_001);
        _pay(1, 50_000);
        _pay(2, 50_000);
        _pay(3, 50_000);
        require(vault.spent() == 150_000 && vault.remainingBudget() == 0, "budget boundary");
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.BudgetExceeded.selector);
        vault.agentPay(currentSession, bytes32(uint256(4)), RECIPIENT, 1);
        require(usdc.balanceOf(RECIPIENT) == 150_000, "recipient balance");
    }

    function testT04FundingAndDayChangeDoNotRenewBudget() public {
        ArcMandateDigest.Policy memory policy = _policy();
        policy.expiresAt = block.timestamp + 2 days;
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeStart(policy, auth);
        VM.prank(OWNER);
        vault.startSession(policy, auth, _sig());
        _pay(1, 50_000);
        usdc.mint(address(vault), 1_000_000);
        VM.warp(block.timestamp + 1 days);
        _pay(2, 50_000);
        _pay(3, 50_000);
        uint256 currentSession = vault.sessionId();
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.BudgetExceeded.selector);
        vault.agentPay(currentSession, bytes32(uint256(4)), RECIPIENT, 1);
    }

    function testT05ExpiryAndDeadlineBoundaries() public {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        auth.deadline = block.timestamp;
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.AuthorizationExpired.selector);
        vault.startSession(policy, auth, _sig());

        auth.deadline = block.timestamp + 1;
        _authorizeStart(policy, auth);
        VM.prank(OWNER);
        vault.startSession(policy, auth, _sig());
        VM.warp(policy.expiresAt - 1);
        _pay(1, 1);
        VM.warp(policy.expiresAt);
        uint256 currentSession = vault.sessionId();
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.SessionExpired.selector);
        vault.agentPay(currentSession, bytes32(uint256(2)), RECIPIENT, 1);
    }

    function testT06CallerAllowlistAndActiveChecks() public {
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.SessionInactive.selector);
        vault.agentPay(0, bytes32(uint256(1)), RECIPIENT, 1);
        _start();
        uint256 currentSession = vault.sessionId();
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.Unauthorized.selector);
        vault.agentPay(currentSession, bytes32(uint256(1)), RECIPIENT, 1);
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.RecipientNotAllowed.selector);
        vault.agentPay(currentSession, bytes32(uint256(1)), address(0xD0D), 1);
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.InvalidAmount.selector);
        vault.agentPay(currentSession, bytes32(uint256(1)), RECIPIENT, 0);
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.InvalidPaymentId.selector);
        vault.agentPay(currentSession, bytes32(0), RECIPIENT, 1);
    }

    function testT07PaymentIdRetryAndOldSessionAfterReplacement() public {
        _start();
        uint256 firstSession = vault.sessionId();
        _pay(11, 10);
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.PaymentAlreadyUsed.selector);
        vault.agentPay(firstSession, bytes32(uint256(11)), RECIPIENT, 10);
        require(usdc.balanceOf(RECIPIENT) == 10, "duplicate paid");

        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeStart(policy, auth);
        VM.prank(OWNER);
        vault.startSession(policy, auth, _sig());
        require(vault.sessionId() == firstSession + 1 && vault.controlNonce() == 2, "replace counters");
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.agentPay(firstSession, bytes32(uint256(12)), RECIPIENT, 10);
        _pay(11, 10); // IDs are scoped to the new session; the old call itself never carries over.
        require(usdc.balanceOf(RECIPIENT) == 20, "new session payment");
    }

    function testT08OwnerAndPQFreeze() public {
        _start();
        uint256 firstSession = vault.sessionId();
        VM.prank(OWNER);
        vault.freezeByOwner(firstSession);
        require(!vault.active() && vault.sessionId() == firstSession + 1 && vault.controlNonce() == 2, "owner freeze");
        require(vault.getRecipients().length == 0 && vault.remainingBudget() == 0, "policy not cleared");
        uint256 frozenSession = vault.sessionId();
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.SessionInactive.selector);
        vault.freezeByOwner(frozenSession);

        _start();
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeFreeze(auth);
        VM.prank(address(0xD0D)); // A distinct relay wallet may submit a PQ freeze.
        vault.freezeByPQ(auth, _sig());
        require(!vault.active() && vault.sessionId() == firstSession + 3 && vault.controlNonce() == 4, "PQ freeze");
        VM.expectRevert(ArcMandateVault.SessionInactive.selector);
        vault.freezeByPQ(auth, _sig());
    }

    function testT09StaleManagementAndAgentCallsStayInvalid() public {
        _start();
        uint256 oldSession = vault.sessionId();
        ArcMandateDigest.Authorization memory staleAuth = _auth();
        ArcMandateDigest.Policy memory policy = _policy();
        _authorizeStart(policy, staleAuth);
        VM.prank(OWNER);
        vault.freezeByOwner(oldSession);

        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidNonce.selector);
        vault.startSession(policy, staleAuth, _sig());
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.SessionInactive.selector);
        vault.agentPay(oldSession, bytes32(uint256(1)), RECIPIENT, 1);

        _start();
        VM.prank(AGENT);
        VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.agentPay(oldSession, bytes32(uint256(2)), RECIPIENT, 1);
    }

    function testT10DomainAndPolicyTamperCannotUseSignature() public {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        bytes32 expected = vault.startSessionDigest(policy, auth);
        pq.configure(expected, PQ_KEY, 0);

        ArcMandateDigest.Policy memory altered = _policy();
        altered.totalBudget++;
        _rejectSignature(altered, auth);
        altered = _policy();
        altered.perTxCap++;
        _rejectSignature(altered, auth);
        altered = _policy();
        altered.expiresAt++;
        _rejectSignature(altered, auth);
        altered = _policy();
        altered.agent = address(0xAAA);
        _rejectSignature(altered, auth);
        altered = _policy();
        altered.recipients[1] = address(0xDDD);
        _rejectSignature(altered, auth);
        pq.configure(expected, PQ_KEY, 0);
        _rejectSignature(policy, ArcMandateDigest.Authorization(auth.nonce, auth.sessionId, auth.deadline + 1));

        pq.configure(
            ArcMandateDigest.startSessionDigest(block.chainid + 1, address(vault), OWNER, policy, auth),
            PQ_KEY,
            0
        );
        _rejectSignature(policy, auth);
        pq.configure(
            ArcMandateDigest.startSessionDigest(block.chainid, address(0xBAD), OWNER, policy, auth),
            PQ_KEY,
            0
        );
        _rejectSignature(policy, auth);
        pq.configure(
            ArcMandateDigest.startSessionDigest(block.chainid, address(vault), AGENT, policy, auth),
            PQ_KEY,
            0
        );
        _rejectSignature(policy, auth);
        pq.configure(vault.freezeDigest(auth), PQ_KEY, 0);
        _rejectSignature(policy, auth);
        pq.configure(expected, bytes32(uint256(999)), 0);
        _rejectSignature(policy, auth);

        ArcMandateVault anotherVault = new ArcMandateVault(OWNER, PQ_KEY);
        pq.configure(expected, PQ_KEY, 0);
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        anotherVault.startSession(policy, auth, _sig());

        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidNonce.selector);
        vault.startSession(policy, ArcMandateDigest.Authorization(auth.nonce + 1, auth.sessionId, auth.deadline), _sig());
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.startSession(policy, ArcMandateDigest.Authorization(auth.nonce, auth.sessionId + 1, auth.deadline), _sig());
    }

    function _rejectSignature(
        ArcMandateDigest.Policy memory policy,
        ArcMandateDigest.Authorization memory auth
    ) internal {
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        vault.startSession(policy, auth, _sig());
    }

    function _rejectFreezeSignature(ArcMandateDigest.Authorization memory auth) internal {
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        vault.freezeByPQ(auth, _sig());
        require(vault.active(), "invalid freeze changed session");
    }

    function testT10FreezeFieldMatrix() public {
        _start();
        ArcMandateDigest.Authorization memory auth = _auth();
        bytes32 expected = vault.freezeDigest(auth);
        pq.configure(expected, PQ_KEY, 0);
        _rejectFreezeSignature(ArcMandateDigest.Authorization(auth.nonce, auth.sessionId, auth.deadline + 1));

        pq.configure(ArcMandateDigest.freezeDigest(block.chainid + 1, address(vault), OWNER, auth), PQ_KEY, 0);
        _rejectFreezeSignature(auth);
        pq.configure(ArcMandateDigest.freezeDigest(block.chainid, address(0xBAD), OWNER, auth), PQ_KEY, 0);
        _rejectFreezeSignature(auth);
        pq.configure(ArcMandateDigest.freezeDigest(block.chainid, address(vault), AGENT, auth), PQ_KEY, 0);
        _rejectFreezeSignature(auth);
        pq.configure(vault.startSessionDigest(_policy(), auth), PQ_KEY, 0);
        _rejectFreezeSignature(auth);
        pq.configure(expected, bytes32(uint256(999)), 0);
        _rejectFreezeSignature(auth);

        pq.configure(expected, PQ_KEY, 0);
        VM.expectRevert(ArcMandateVault.InvalidNonce.selector);
        vault.freezeByPQ(ArcMandateDigest.Authorization(auth.nonce + 1, auth.sessionId, auth.deadline), _sig());
        VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.freezeByPQ(ArcMandateDigest.Authorization(auth.nonce, auth.sessionId + 1, auth.deadline), _sig());
        vault.freezeByPQ(auth, _sig());
        require(!vault.active(), "valid freeze failed");
    }

    function _rejectWithdrawSignature(address to, uint256 amount, ArcMandateDigest.Authorization memory auth)
        internal
    {
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        vault.withdraw(to, amount, auth, _sig());
        require(usdc.balanceOf(to) == 0, "invalid withdrawal moved funds");
    }

    function testT10WithdrawFieldMatrix() public {
        ArcMandateDigest.Authorization memory auth = _auth();
        bytes32 expected = vault.withdrawDigest(RECIPIENT, 100, auth);
        pq.configure(expected, PQ_KEY, 0);
        _rejectWithdrawSignature(RECIPIENT_2, 100, auth);
        _rejectWithdrawSignature(RECIPIENT, 101, auth);
        _rejectWithdrawSignature(RECIPIENT, 100,
            ArcMandateDigest.Authorization(auth.nonce, auth.sessionId, auth.deadline + 1));

        pq.configure(ArcMandateDigest.withdrawDigest(block.chainid + 1, address(vault), OWNER, RECIPIENT, 100, auth), PQ_KEY, 0);
        _rejectWithdrawSignature(RECIPIENT, 100, auth);
        pq.configure(ArcMandateDigest.withdrawDigest(block.chainid, address(0xBAD), OWNER, RECIPIENT, 100, auth), PQ_KEY, 0);
        _rejectWithdrawSignature(RECIPIENT, 100, auth);
        pq.configure(ArcMandateDigest.withdrawDigest(block.chainid, address(vault), AGENT, RECIPIENT, 100, auth), PQ_KEY, 0);
        _rejectWithdrawSignature(RECIPIENT, 100, auth);
        pq.configure(vault.freezeDigest(auth), PQ_KEY, 0);
        _rejectWithdrawSignature(RECIPIENT, 100, auth);
        pq.configure(expected, bytes32(uint256(999)), 0);
        _rejectWithdrawSignature(RECIPIENT, 100, auth);

        pq.configure(expected, PQ_KEY, 0);
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidNonce.selector);
        vault.withdraw(RECIPIENT, 100, ArcMandateDigest.Authorization(auth.nonce + 1, auth.sessionId, auth.deadline), _sig());
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.withdraw(RECIPIENT, 100, ArcMandateDigest.Authorization(auth.nonce, auth.sessionId + 1, auth.deadline), _sig());
        VM.prank(OWNER);
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        require(usdc.balanceOf(RECIPIENT) == 100, "valid withdrawal failed");
    }

    function testT11VerifierFailuresFailClosed() public {
        ArcMandateDigest.Policy memory policy = _policy();
        ArcMandateDigest.Authorization memory auth = _auth();
        bytes32 digest = vault.startSessionDigest(policy, auth);
        for (uint8 mode = 1; mode <= 4; ++mode) {
            pq.configure(digest, PQ_KEY, mode);
            _rejectSignature(policy, auth);
        }
        pq.configure(digest, PQ_KEY, 0);
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.InvalidPQSignature.selector);
        vault.startSession(policy, auth, new bytes(7855));
    }

    function testT12FailedTransferRollsBackStateAndReentryIsBlocked() public {
        _start();
        usdc.setFailTransfers(true);
        uint256 currentSession = vault.sessionId();
        VM.prank(AGENT);
        VM.expectRevert();
        vault.agentPay(currentSession, bytes32(uint256(1)), RECIPIENT, 50);
        require(vault.spent() == 0 && !vault.usedPaymentIds(vault.sessionId(), bytes32(uint256(1))), "pay rollback");
        usdc.setFailTransfers(false);
        usdc.setReentry(address(vault), vault.sessionId());
        _pay(1, 50);
        require(
            usdc.reentrySelector() == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "reentry not stopped by guard"
        );
        require(vault.spent() == 50 && usdc.balanceOf(RECIPIENT) == 50, "unexpected transfer");
    }

    function testT13WithdrawWithoutSessionThenAfterFreeze() public {
        ArcMandateDigest.Authorization memory auth = _auth();
        _authorizeWithdraw(RECIPIENT, 100, auth);
        VM.prank(OWNER);
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        require(vault.controlNonce() == 1 && vault.sessionId() == 0, "initial withdrawal counters");

        _start();
        auth = _auth();
        _authorizeWithdraw(RECIPIENT, 100, auth);
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.SessionActive.selector);
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        VM.warp(block.timestamp + 901); // Expired still means active until an explicit freeze.
        VM.prank(OWNER);
        VM.expectRevert(ArcMandateVault.SessionActive.selector);
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        VM.prank(OWNER);
        vault.freezeByOwner(auth.sessionId);
        auth = _auth();
        _authorizeWithdraw(RECIPIENT, 100, auth);
        uint256 nonceBefore = vault.controlNonce();
        usdc.setFailTransfers(true);
        VM.prank(OWNER);
        VM.expectRevert();
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        require(vault.controlNonce() == nonceBefore, "withdraw nonce consumed on failure");
        usdc.setFailTransfers(false);
        VM.prank(OWNER);
        vault.withdraw(RECIPIENT, 100, auth, _sig());
        require(vault.controlNonce() == nonceBefore + 1, "withdraw nonce not consumed");
    }
}
