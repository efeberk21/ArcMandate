// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ArcMandateVault} from "../src/ArcMandateVault.sol";
import {ArcMandateDigest} from "../src/lib/ArcMandateDigest.sol";
import {MockArcUSDC, MockArcPQ, VaultVm} from "./ArcMandateVault.t.sol";

contract VaultHandler {
    VaultVm internal constant VM = VaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant OWNER = address(0xA11CE);
    address internal constant AGENT = address(0xA6E17);
    address internal constant RECIPIENT = address(0xB0B);
    bytes32 internal constant PQ_KEY = bytes32(uint256(123));

    ArcMandateVault public immutable vault;
    MockArcUSDC public immutable usdc;
    MockArcPQ public immutable pq;
    uint256 public currentSessionPaid;
    uint256 public cumulativePaid;
    uint256 public lastRevokedSession;
    uint256 public successfulStarts;
    uint256 public successfulPayments;
    uint256 public successfulFreezes;
    uint256 public failedTransferChecks;
    uint256 public staleRejections;
    uint256 public successfulWithdrawals;
    uint256 public cumulativeWithdrawn;
    uint256 public funded;
    uint256 public insufficientBalanceChecks;
    uint256 public adversarialChecks;
    uint256 public invalidAuthChecks;
    uint256 public withdrawalRollbackChecks;
    uint256 public immutable initialBalance;
    uint256 private paymentCounter;

    constructor(ArcMandateVault vault_, MockArcUSDC usdc_, MockArcPQ pq_) {
        vault = vault_;
        usdc = usdc_;
        pq = pq_;
        initialBalance = usdc_.balanceOf(address(vault_));
    }

    function _signature() private pure returns (bytes memory) { return new bytes(7856); }

    function start(uint256 budgetSeed, uint256 capSeed, uint256 durationSeed) public {
        uint256 budget = 1 + budgetSeed % 1_000_000;
        uint256 cap = 1 + capSeed % budget;
        address[] memory recipients = new address[](1);
        recipients[0] = RECIPIENT;
        ArcMandateDigest.Policy memory policy = ArcMandateDigest.Policy({
            agent: AGENT, totalBudget: budget, perTxCap: cap,
            expiresAt: block.timestamp + 1 + durationSeed % 3_600, recipients: recipients
        });
        ArcMandateDigest.Authorization memory auth = ArcMandateDigest.Authorization(
            vault.controlNonce(), vault.sessionId(), block.timestamp + 600
        );
        uint256 oldSession = vault.sessionId();
        bool replacing = vault.active();
        pq.configure(vault.startSessionDigest(policy, auth), PQ_KEY, 0);
        VM.prank(OWNER);
        vault.startSession(policy, auth, _signature());
        if (replacing) lastRevokedSession = oldSession;
        currentSessionPaid = 0;
        ++successfulStarts;
    }

    function _ensureSpendable() private {
        if (!vault.active() || block.timestamp >= vault.expiresAt() || vault.spent() == vault.totalBudget()) {
            start(150_000, 49_999, 899);
        }
    }

    function pay(uint256 amountSeed) external {
        _ensureSpendable();
        uint256 limit = vault.perTxCap();
        uint256 remaining = vault.totalBudget() - vault.spent();
        if (remaining < limit) limit = remaining;
        uint256 amount = 1 + amountSeed % limit;
        if (usdc.balanceOf(address(vault)) < amount) {
            _rejectPay(AGENT, vault.sessionId(), bytes32(++paymentCounter), RECIPIENT, amount, ArcMandateVault.InsufficientBalance.selector);
            ++insufficientBalanceChecks;
            return;
        }
        bytes32 id = bytes32(++paymentCounter);
        uint256 session = vault.sessionId();
        VM.prank(AGENT);
        vault.agentPay(session, id, RECIPIENT, amount);
        currentSessionPaid += amount;
        cumulativePaid += amount;
        ++successfulPayments;
    }

    function failTransfer(uint256 idSeed) external {
        _ensureSpendable();
        if (usdc.balanceOf(address(vault)) == 0) fund(0);
        bytes32 id = bytes32(uint256(keccak256(abi.encode(idSeed, paymentCounter, vault.sessionId()))));
        if (id == bytes32(0) || vault.usedPaymentIds(vault.sessionId(), id)) id = bytes32(++paymentCounter);
        uint256 beforeSpent = vault.spent();
        uint256 beforeNonce = vault.controlNonce();
        uint256 beforeRecipient = usdc.balanceOf(RECIPIENT);
        uint256 session = vault.sessionId();
        usdc.setFailTransfers(true);
        VM.prank(AGENT);
        try vault.agentPay(session, id, RECIPIENT, 1) {
            revert("failed transfer succeeded");
        } catch {}
        usdc.setFailTransfers(false);
        require(vault.spent() == beforeSpent && vault.controlNonce() == beforeNonce, "failed transfer changed counters");
        require(!vault.usedPaymentIds(vault.sessionId(), id) && usdc.balanceOf(RECIPIENT) == beforeRecipient,
            "failed transfer consumed ID or moved funds");
        ++failedTransferChecks;
    }

    function fund(uint256 amountSeed) public {
        uint256 amount = 1 + amountSeed % 1_000_000;
        usdc.mint(address(this), amount);
        require(usdc.transfer(address(vault), amount), "fund transfer failed");
        funded += amount;
    }

    function freezeOwner() public {
        if (!vault.active()) start(150_000, 49_999, 899);
        uint256 oldSession = vault.sessionId();
        VM.prank(OWNER);
        vault.freezeByOwner(oldSession);
        lastRevokedSession = oldSession;
        currentSessionPaid = 0;
        ++successfulFreezes;
    }

    function freezePQ() external {
        if (!vault.active()) start(150_000, 49_999, 899);
        uint256 oldSession = vault.sessionId();
        ArcMandateDigest.Authorization memory auth = ArcMandateDigest.Authorization(
            vault.controlNonce(), oldSession, block.timestamp + 600
        );
        pq.configure(vault.freezeDigest(auth), PQ_KEY, 0);
        vault.freezeByPQ(auth, _signature());
        lastRevokedSession = oldSession;
        currentSessionPaid = 0;
        ++successfulFreezes;
    }

    function withdraw(uint256 amountSeed) external {
        if (vault.active()) freezeOwner();
        uint256 balance = usdc.balanceOf(address(vault));
        if (balance == 0) { fund(0); balance = 1; }
        uint256 amount = 1 + amountSeed % balance;
        ArcMandateDigest.Authorization memory auth = ArcMandateDigest.Authorization(
            vault.controlNonce(), vault.sessionId(), block.timestamp + 600
        );
        pq.configure(vault.withdrawDigest(OWNER, amount, auth), PQ_KEY, 0);
        VM.prank(OWNER);
        vault.withdraw(OWNER, amount, auth, _signature());
        cumulativeWithdrawn += amount;
        ++successfulWithdrawals;
    }

    function stalePay() external {
        if (lastRevokedSession == 0) freezeOwner();
        uint256 beforeRecipient = usdc.balanceOf(RECIPIENT);
        VM.prank(AGENT);
        try vault.agentPay(lastRevokedSession, bytes32(++paymentCounter), RECIPIENT, 1) {
            revert("revoked session paid");
        } catch {}
        require(usdc.balanceOf(RECIPIENT) == beforeRecipient, "revoked session moved funds");
        ++staleRejections;
    }

    function advanceTime(uint256 secondsSeed) external {
        VM.warp(block.timestamp + 1 + secondsSeed % 7_200);
    }
    function _rejectPay(address caller, uint256 session, bytes32 id, address to, uint256 amount, bytes4 selector) private {
        uint256 spentBefore = vault.spent();
        uint256 nonceBefore = vault.controlNonce();
        uint256 balanceBefore = usdc.balanceOf(address(vault));
        bool usedBefore = vault.usedPaymentIds(session, id);
        VM.prank(caller);
        VM.expectRevert(selector);
        vault.agentPay(session, id, to, amount);
        require(vault.spent() == spentBefore && vault.controlNonce() == nonceBefore && usdc.balanceOf(address(vault)) == balanceBefore && vault.usedPaymentIds(session, id) == usedBefore, "invalid payment changed state");
    }
    function adversarialPayments(uint256 seed) external {
        _ensureSpendable();
        uint256 id = vault.sessionId();
        bytes32 paymentId = bytes32(++paymentCounter);
        _rejectPay(OWNER, id, paymentId, RECIPIENT, 1, ArcMandateVault.Unauthorized.selector);
        _rejectPay(AGENT, id, paymentId, address(uint160(0xD00 + seed % 100)), 1, ArcMandateVault.RecipientNotAllowed.selector);
        _rejectPay(AGENT, id, paymentId, RECIPIENT, 0, ArcMandateVault.InvalidAmount.selector);
        _rejectPay(AGENT, id, paymentId, RECIPIENT, vault.perTxCap() + 1 + seed % 100, ArcMandateVault.PerPaymentLimitExceeded.selector);
        _rejectPay(AGENT, id, bytes32(0), RECIPIENT, 1, ArcMandateVault.InvalidPaymentId.selector);
        // Deliberately narrow remaining budget without changing the payment cap.
        start(9, 9, seed);
        fund(10);
        id = vault.sessionId();
        VM.prank(AGENT);
        vault.agentPay(id, paymentId, RECIPIENT, 9);
        currentSessionPaid += 9; cumulativePaid += 9; ++successfulPayments;
        _rejectPay(AGENT, id, bytes32(++paymentCounter), RECIPIENT, 2, ArcMandateVault.BudgetExceeded.selector);
        // Duplicate check occurs only when budget remains; start a fresh funded session.
        start(99, 49, seed);
        id = vault.sessionId(); paymentId = bytes32(++paymentCounter);
        VM.prank(AGENT);
        vault.agentPay(id, paymentId, RECIPIENT, 1);
        currentSessionPaid += 1; cumulativePaid += 1; ++successfulPayments;
        _rejectPay(AGENT, id, paymentId, RECIPIENT, 1, ArcMandateVault.PaymentAlreadyUsed.selector);
        // Drain via an authorized withdrawal, then probe absent balance without auto-mint.
        freezeOwner();
        uint256 amount = usdc.balanceOf(address(vault));
        ArcMandateDigest.Authorization memory auth = ArcMandateDigest.Authorization(vault.controlNonce(), vault.sessionId(), block.timestamp + 600);
        pq.configure(vault.withdrawDigest(OWNER, amount, auth), PQ_KEY, 0);
        VM.prank(OWNER); vault.withdraw(OWNER, amount, auth, _signature());
        cumulativeWithdrawn += amount; ++successfulWithdrawals;
        start(99, 49, seed);
        _rejectPay(AGENT, vault.sessionId(), bytes32(++paymentCounter), RECIPIENT, 1, ArcMandateVault.InsufficientBalance.selector);
        ++insufficientBalanceChecks; ++adversarialChecks;
    }
    function invalidAuthorizationAndWithdrawalRollback(uint256 seed) external {
        if (vault.active()) freezeOwner();
        fund(seed);
        ArcMandateDigest.Authorization memory auth = ArcMandateDigest.Authorization(vault.controlNonce(), vault.sessionId(), block.timestamp + 600);
        uint256 nonce = auth.nonce;
        pq.configure(vault.withdrawDigest(OWNER, 1, auth), PQ_KEY, 0);
        auth.nonce++;
        VM.prank(OWNER); VM.expectRevert(ArcMandateVault.InvalidNonce.selector);
        vault.withdraw(OWNER, 1, auth, _signature());
        auth.nonce = nonce; auth.sessionId++;
        VM.prank(OWNER); VM.expectRevert(ArcMandateVault.SessionMismatch.selector);
        vault.withdraw(OWNER, 1, auth, _signature());
        auth.sessionId--; auth.deadline = block.timestamp;
        VM.prank(OWNER); VM.expectRevert(ArcMandateVault.AuthorizationExpired.selector);
        vault.withdraw(OWNER, 1, auth, _signature());
        auth.deadline = block.timestamp + 600;
        uint256 beforeBalance = usdc.balanceOf(address(vault));
        usdc.setFailTransfers(true);
        VM.prank(OWNER); VM.expectRevert();
        vault.withdraw(OWNER, 1, auth, _signature());
        usdc.setFailTransfers(false);
        require(vault.controlNonce() == nonce && usdc.balanceOf(address(vault)) == beforeBalance, "withdraw rollback accounting");
        ++invalidAuthChecks; ++withdrawalRollbackChecks;
    }
}

contract ArcMandateInvariantTest {
    struct FuzzSelector { address addr; bytes4[] selectors; }
    struct FuzzArtifactSelector { string artifact; bytes4[] selectors; }
    struct FuzzInterface { address addr; string[] artifacts; }
    VaultVm internal constant VM = VaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address internal constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;
    address internal constant PQ_ADDRESS = 0x1800000000000000000000000000000000000004;
    address internal constant OWNER = address(0xA11CE);
    address internal constant RECIPIENT = address(0xB0B);
    bytes32 internal constant PQ_KEY = bytes32(uint256(123));

    ArcMandateVault internal vault;
    MockArcUSDC internal usdc;
    VaultHandler internal handler;

    function setUp() public {
        VM.warp(1_800_000_000);
        VM.etch(USDC_ADDRESS, address(new MockArcUSDC()).code);
        VM.etch(PQ_ADDRESS, address(new MockArcPQ()).code);
        usdc = MockArcUSDC(USDC_ADDRESS);
        vault = new ArcMandateVault(OWNER, PQ_KEY);
        usdc.mint(address(vault), 1_000_000);
        handler = new VaultHandler(vault, usdc, MockArcPQ(PQ_ADDRESS));
    }

    // Forge reads this StdInvariant-compatible hook and targets only the stateful handler.
    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    // Forge's invariant target discovery calls the complete StdInvariant hook set.
    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }
    function targetArtifacts() public pure returns (string[] memory) { return new string[](0); }
    function excludeArtifacts() public pure returns (string[] memory) { return new string[](0); }
    function targetSenders() public pure returns (address[] memory) { return new address[](0); }
    function excludeSenders() public pure returns (address[] memory) { return new address[](0); }
    function excludeContracts() public pure returns (address[] memory) { return new address[](0); }
    function targetInterfaces() public pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }
    function targetSelectors() public pure returns (FuzzSelector[] memory) { return new FuzzSelector[](0); }
    function excludeSelectors() public pure returns (FuzzSelector[] memory) { return new FuzzSelector[](0); }

    function invariant_SessionBudgetAndTransferAccounting() public view {
        require(vault.controlNonce() == handler.successfulStarts() + handler.successfulFreezes() + handler.successfulWithdrawals(), "control nonce accounting");
        require(vault.sessionId() == handler.successfulStarts() + handler.successfulFreezes(), "session accounting");
        require(usdc.balanceOf(address(vault)) == handler.initialBalance() + handler.funded() - handler.cumulativePaid() - handler.cumulativeWithdrawn(), "vault conservation");
        require(usdc.balanceOf(OWNER) == handler.cumulativeWithdrawn(), "withdrawal conservation");
        require(usdc.balanceOf(RECIPIENT) == handler.cumulativePaid(), "recipient and successful payments diverged");
        if (vault.active()) {
            require(vault.spent() <= vault.totalBudget(), "session budget exceeded");
            require(vault.spent() == handler.currentSessionPaid(), "session spent and paid diverged");
        } else {
            require(vault.spent() == 0 && vault.totalBudget() == 0 && vault.perTxCap() == 0,
                "inactive session retained policy budget");
        }
        if (handler.lastRevokedSession() != 0) {
            require(vault.sessionId() > handler.lastRevokedSession(), "revoked session resumed");
        }
    }

    function afterInvariant() public view {
        require(handler.successfulStarts() > 0 && handler.successfulPayments() > 0,
            "campaign missed successful start/payment");
        require(handler.successfulFreezes() > 0 && handler.failedTransferChecks() > 0
            && handler.staleRejections() > 0, "campaign missed freeze/rollback/stale paths");
        require(handler.successfulWithdrawals() > 0 && handler.adversarialChecks() > 0 && handler.insufficientBalanceChecks() > 0 && handler.invalidAuthChecks() > 0 && handler.withdrawalRollbackChecks() > 0, "campaign missed adversarial/withdrawal paths");
    }
}
