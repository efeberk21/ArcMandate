// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ArcMandateDigest} from "./lib/ArcMandateDigest.sol";
import {PQVerifier} from "./lib/PQVerifier.sol";

/// @notice One owner, one PQ key, one active agent session, and Arc USDC only.
/// @dev Immutable prototype. Do not fund before its real Arc integration tests pass.
contract ArcMandateVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant USDC_ADDRESS = 0x3600000000000000000000000000000000000000;
    address public constant PQ_VERIFIER_ADDRESS = 0x1800000000000000000000000000000000000004;
    IERC20 private constant USDC = IERC20(USDC_ADDRESS);

    address public immutable owner;
    bytes32 public immutable pqPublicKey;

    uint256 public controlNonce;
    uint256 public sessionId;
    bool public active;
    address public agent;
    uint256 public totalBudget;
    uint256 public spent;
    uint256 public perTxCap;
    uint256 public expiresAt;
    address[] private _recipients;
    mapping(uint256 => mapping(address => bool)) public allowed;
    mapping(uint256 => mapping(bytes32 => bool)) public usedPaymentIds;

    enum RevocationReason { OWNER, PQ, REPLACED }

    event SessionStarted(
        uint256 indexed sessionId,
        address indexed agent,
        uint256 totalBudget,
        uint256 perTxCap,
        uint256 expiresAt,
        address[] recipients,
        uint256 controlNonce
    );
    event AgentPaid(
        uint256 indexed sessionId,
        bytes32 indexed paymentId,
        address indexed to,
        uint256 amount,
        uint256 spent
    );
    event SessionRevoked(
        uint256 indexed oldSessionId,
        uint256 indexed newSessionId,
        RevocationReason reason,
        address indexed caller,
        uint256 controlNonce
    );
    event Withdrawn(address indexed to, uint256 amount, uint256 controlNonce);

    error Unauthorized();
    error SessionInactive();
    error SessionActive();
    error SessionMismatch();
    error SessionExpired();
    error InvalidPolicy();
    error InvalidAmount();
    error InvalidPaymentId();
    error RecipientNotAllowed();
    error PerPaymentLimitExceeded();
    error BudgetExceeded();
    error PaymentAlreadyUsed();
    error InvalidNonce();
    error AuthorizationExpired();
    error InvalidPQSignature();
    error InsufficientBalance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address owner_, bytes32 pqPublicKey_) {
        if (owner_ == address(0) || owner_ == address(this) || pqPublicKey_ == bytes32(0)) {
            revert InvalidPolicy();
        }
        owner = owner_;
        pqPublicKey = pqPublicKey_;
    }

    function startSession(
        ArcMandateDigest.Policy calldata policy,
        ArcMandateDigest.Authorization calldata auth,
        bytes calldata pqSig
    ) external onlyOwner nonReentrant {
        _checkAuthorization(auth);
        _validatePolicy(policy);
        if (!PQVerifier.verify(pqPublicKey, startSessionDigest(policy, auth), pqSig)) {
            revert InvalidPQSignature();
        }

        uint256 oldSessionId = sessionId;
        bool replacing = active;
        _clearPolicy();
        ++sessionId;
        ++controlNonce;
        active = true;
        agent = policy.agent;
        totalBudget = policy.totalBudget;
        perTxCap = policy.perTxCap;
        expiresAt = policy.expiresAt;
        for (uint256 i; i < policy.recipients.length; ++i) {
            address recipient = policy.recipients[i];
            _recipients.push(recipient);
            allowed[sessionId][recipient] = true;
        }
        if (replacing) {
            emit SessionRevoked(oldSessionId, sessionId, RevocationReason.REPLACED, msg.sender, controlNonce);
        }
        emit SessionStarted(sessionId, agent, totalBudget, perTxCap, expiresAt, _recipients, controlNonce);
    }

    function agentPay(uint256 expectedSessionId, bytes32 paymentId, address to, uint256 amount)
        external
        nonReentrant
    {
        if (!active) revert SessionInactive();
        if (expectedSessionId != sessionId) revert SessionMismatch();
        if (msg.sender != agent) revert Unauthorized();
        if (block.timestamp >= expiresAt) revert SessionExpired();
        if (amount == 0) revert InvalidAmount();
        if (!allowed[sessionId][to]) revert RecipientNotAllowed();
        if (amount > perTxCap) revert PerPaymentLimitExceeded();
        if (amount > totalBudget - spent) revert BudgetExceeded();
        if (paymentId == bytes32(0)) revert InvalidPaymentId();
        if (usedPaymentIds[sessionId][paymentId]) revert PaymentAlreadyUsed();
        if (USDC.balanceOf(address(this)) < amount) revert InsufficientBalance();

        usedPaymentIds[sessionId][paymentId] = true;
        spent += amount;
        USDC.safeTransfer(to, amount);
        emit AgentPaid(sessionId, paymentId, to, amount, spent);
    }

    function freezeByOwner(uint256 expectedSessionId) external onlyOwner nonReentrant {
        if (!active) revert SessionInactive();
        if (expectedSessionId != sessionId) revert SessionMismatch();
        _freeze(RevocationReason.OWNER);
    }

    function freezeByPQ(ArcMandateDigest.Authorization calldata auth, bytes calldata pqSig)
        external
        nonReentrant
    {
        if (!active) revert SessionInactive();
        _checkAuthorization(auth);
        if (!PQVerifier.verify(pqPublicKey, freezeDigest(auth), pqSig)) revert InvalidPQSignature();
        _freeze(RevocationReason.PQ);
    }

    function withdraw(
        address to,
        uint256 amount,
        ArcMandateDigest.Authorization calldata auth,
        bytes calldata pqSig
    ) external onlyOwner nonReentrant {
        if (active) revert SessionActive();
        _checkAuthorization(auth);
        if (to == address(0) || to == address(this)) revert InvalidPolicy();
        if (amount == 0) revert InvalidAmount();
        if (USDC.balanceOf(address(this)) < amount) revert InsufficientBalance();
        if (!PQVerifier.verify(pqPublicKey, withdrawDigest(to, amount, auth), pqSig)) {
            revert InvalidPQSignature();
        }

        ++controlNonce;
        USDC.safeTransfer(to, amount);
        emit Withdrawn(to, amount, controlNonce);
    }

    function startSessionDigest(
        ArcMandateDigest.Policy calldata policy,
        ArcMandateDigest.Authorization calldata auth
    ) public view returns (bytes32) {
        return ArcMandateDigest.startSessionDigest(block.chainid, address(this), owner, policy, auth);
    }

    function freezeDigest(ArcMandateDigest.Authorization calldata auth) public view returns (bytes32) {
        return ArcMandateDigest.freezeDigest(block.chainid, address(this), owner, auth);
    }

    function withdrawDigest(address to, uint256 amount, ArcMandateDigest.Authorization calldata auth)
        public
        view
        returns (bytes32)
    {
        return ArcMandateDigest.withdrawDigest(block.chainid, address(this), owner, to, amount, auth);
    }

    function currentPolicy() external view returns (ArcMandateDigest.Policy memory) {
        return ArcMandateDigest.Policy(agent, totalBudget, perTxCap, expiresAt, _recipients);
    }

    function getRecipients() external view returns (address[] memory) {
        return _recipients;
    }

    function remainingBudget() external view returns (uint256) {
        return totalBudget - spent;
    }

    function _checkAuthorization(ArcMandateDigest.Authorization calldata auth) private view {
        if (auth.nonce != controlNonce) revert InvalidNonce();
        if (auth.sessionId != sessionId) revert SessionMismatch();
        if (block.timestamp >= auth.deadline) revert AuthorizationExpired();
    }

    function _validatePolicy(ArcMandateDigest.Policy calldata policy) private view {
        if (
            policy.agent == address(0) || policy.agent == owner || policy.agent == address(this)
                || policy.totalBudget == 0 || policy.perTxCap == 0 || policy.perTxCap > policy.totalBudget
                || policy.expiresAt <= block.timestamp || policy.recipients.length == 0
                || policy.recipients.length > 5
        ) revert InvalidPolicy();

        address previous;
        for (uint256 i; i < policy.recipients.length; ++i) {
            address recipient = policy.recipients[i];
            if (recipient == address(this) || uint160(recipient) <= uint160(previous)) {
                revert InvalidPolicy();
            }
            previous = recipient;
        }
    }

    function _freeze(RevocationReason reason) private {
        uint256 oldSessionId = sessionId;
        _clearPolicy();
        ++sessionId;
        ++controlNonce;
        emit SessionRevoked(oldSessionId, sessionId, reason, msg.sender, controlNonce);
    }

    function _clearPolicy() private {
        active = false;
        agent = address(0);
        totalBudget = 0;
        spent = 0;
        perTxCap = 0;
        expiresAt = 0;
        delete _recipients;
    }
}
