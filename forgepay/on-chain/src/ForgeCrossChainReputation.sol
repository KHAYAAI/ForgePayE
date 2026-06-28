// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {CCIPReceiver} from "@chainlink/contracts-ccip/src/v0.8/ccip/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";
import {IRouterClient} from "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";

/// @title ForgeCrossChainReputation
/// @notice Propagates FORGE agent reputation scores across chains via Chainlink CCIP.
///         Forked from Qova/QovaCrossChainReputation — patches applied:
///         P2: sender allowlist check in _ccipReceive() — was missing in Qova
///         P3: messageId replay protection — was missing in Qova
/// @dev Sends Mode 2 (on-chain operational) scores to destination chains.
///      Maintains per-agent cross-chain score history for CRE composite scoring.
contract ForgeCrossChainReputation is CCIPReceiver, AccessControl {

    bytes32 public constant SENDER_ROLE = keccak256("SENDER_ROLE");

    struct CrossChainScore {
        address agent;
        uint16  score;       // P2 fix: uint16 not uint256, consistent with registry
        uint64  sourceChain;
        uint48  timestamp;   // Tightened from uint256 — safe until year 8921
    }

    address public reputationRegistry;

    mapping(address => CrossChainScore[]) private _crossChainScores;
    mapping(address => uint256)  public   crossChainScoreCount;

    // P2: sender allowlist — chain selector → trusted sender address on that chain
    mapping(uint64 => address)   public   allowlistedSenders;
    mapping(uint64 => address)   public   allowlistedDestinations;
    mapping(uint64 => bool)      public   allowlistedSourceChains;

    // P3: replay protection — tracks processed CCIP messageIds
    mapping(bytes32 => bool)     private  _processedMessages;

    uint256 public constant MAX_SCORES_PER_AGENT = 1000;
    uint256 public ccipGasLimit = 200_000;
    uint256 public totalMessagesSent;
    uint256 public totalMessagesReceived;

    // ── Errors ────────────────────────────────────────────────────────────────
    error InsufficientFee(uint256 required, uint256 provided);
    error ZeroAddress();
    error SourceChainNotAllowlisted(uint64 sourceChainSelector);
    error SenderNotAllowlisted(uint64 sourceChainSelector, address sender);    // P2
    error MessageAlreadyProcessed(bytes32 messageId);                          // P3
    error DestinationNotConfigured(uint64 destinationChainSelector);
    error InvalidScore(uint256 score);
    error TooManyScores(address agent);
    error InvalidGasLimit();

    // ── Events ────────────────────────────────────────────────────────────────
    event ScoreSent(address indexed agent, uint64 indexed destinationChain, bytes32 messageId, uint16 score);
    event ScoreReceived(address indexed agent, uint64 indexed sourceChain, uint16 score);
    event RefundFailed(address indexed recipient, uint256 amount);
    event DestinationAllowlisted(uint64 indexed chainSelector, address destination);
    event SenderAllowlisted(uint64 indexed chainSelector, address sender);     // P2
    event SourceChainAllowlisted(uint64 indexed chainSelector, bool allowed);

    constructor(
        address _router,
        address _reputationRegistry
    ) CCIPReceiver(_router) {
        if (_reputationRegistry == address(0)) revert ZeroAddress();
        reputationRegistry = _reputationRegistry;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SENDER_ROLE, msg.sender);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setAllowlistedDestination(uint64 chainSelector, address destination)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (destination == address(0)) revert ZeroAddress();
        allowlistedDestinations[chainSelector] = destination;
        emit DestinationAllowlisted(chainSelector, destination);
    }

    /// @notice P2: Allowlist the trusted sender contract on a source chain.
    ///         Must be set before any messages from that chain are accepted.
    function setAllowlistedSender(uint64 chainSelector, address sender)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (sender == address(0)) revert ZeroAddress();
        allowlistedSenders[chainSelector] = sender;
        emit SenderAllowlisted(chainSelector, sender);
    }

    function setAllowlistedSourceChain(uint64 chainSelector, bool allowed)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        allowlistedSourceChains[chainSelector] = allowed;
        emit SourceChainAllowlisted(chainSelector, allowed);
    }

    function setReputationRegistry(address _registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_registry == address(0)) revert ZeroAddress();
        reputationRegistry = _registry;
    }

    function setCcipGasLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newLimit == 0 || newLimit > 1_000_000) revert InvalidGasLimit();
        ccipGasLimit = newLimit;
    }

    // ── Send ──────────────────────────────────────────────────────────────────

    function sendScore(
        uint64  destinationChainSelector,
        address agent,
        uint16  score
    ) external payable onlyRole(SENDER_ROLE) returns (bytes32 messageId) {
        if (agent == address(0))    revert ZeroAddress();
        if (score > 1000)           revert InvalidScore(score);

        address destination = allowlistedDestinations[destinationChainSelector];
        if (destination == address(0)) revert DestinationNotConfigured(destinationChainSelector);

        bytes memory data = abi.encode(agent, score, uint48(block.timestamp));

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver:   abi.encode(destination),
            data:       data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs:  Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: ccipGasLimit})),
            feeToken:   address(0)
        });

        IRouterClient router = IRouterClient(getRouter());
        uint256 fee = router.getFee(destinationChainSelector, message);
        if (msg.value < fee) revert InsufficientFee(fee, msg.value);

        unchecked { totalMessagesSent += 1; }

        messageId = router.ccipSend{value: fee}(destinationChainSelector, message);

        if (msg.value > fee) {
            (bool sent,) = msg.sender.call{value: msg.value - fee}("");
            if (!sent) emit RefundFailed(msg.sender, msg.value - fee);
        }

        emit ScoreSent(agent, destinationChainSelector, messageId, score);
    }

    function estimateSendFee(
        uint64  destinationChainSelector,
        address agent,
        uint16  score
    ) external view returns (uint256 fee) {
        address destination = allowlistedDestinations[destinationChainSelector];
        if (destination == address(0)) revert DestinationNotConfigured(destinationChainSelector);

        bytes memory data = abi.encode(agent, score, uint48(block.timestamp));
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver:   abi.encode(destination),
            data:       data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs:  Client._argsToBytes(Client.EVMExtraArgsV1({gasLimit: ccipGasLimit})),
            feeToken:   address(0)
        });
        fee = IRouterClient(getRouter()).getFee(destinationChainSelector, message);
    }

    // ── Receive (CCIP) ────────────────────────────────────────────────────────

    function _ccipReceive(
        Client.Any2EVMMessage memory message
    ) internal override {
        // Check 1: source chain allowlist
        if (!allowlistedSourceChains[message.sourceChainSelector]) {
            revert SourceChainNotAllowlisted(message.sourceChainSelector);
        }

        // P2: Check 2 — validate the specific sender contract on the source chain.
        // Qova was missing this: any contract on an allowlisted chain could inject scores.
        address messageSender = abi.decode(message.sender, (address));
        address expectedSender = allowlistedSenders[message.sourceChainSelector];
        if (messageSender != expectedSender) {
            revert SenderNotAllowlisted(message.sourceChainSelector, messageSender);
        }

        // P3: Check 3 — replay protection via messageId.
        // Qova was missing this: the same CCIP message could be replayed.
        if (_processedMessages[message.messageId]) {
            revert MessageAlreadyProcessed(message.messageId);
        }
        _processedMessages[message.messageId] = true;

        // Decode payload
        (address agent, uint16 score, uint48 timestamp) = abi.decode(
            message.data,
            (address, uint16, uint48)
        );

        if (score > 1000) revert InvalidScore(score);

        if (_crossChainScores[agent].length >= MAX_SCORES_PER_AGENT) {
            revert TooManyScores(agent);
        }

        _crossChainScores[agent].push(CrossChainScore({
            agent:       agent,
            score:       score,
            sourceChain: message.sourceChainSelector,
            timestamp:   timestamp
        }));

        unchecked {
            crossChainScoreCount[agent] += 1;
            totalMessagesReceived       += 1;
        }

        emit ScoreReceived(agent, message.sourceChainSelector, score);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getCrossChainScores(address agent) external view returns (CrossChainScore[] memory) {
        return _crossChainScores[agent];
    }

    function getLatestScoreFromChain(
        address agent,
        uint64  sourceChain
    ) external view returns (uint16 score, bool found) {
        CrossChainScore[] storage scores = _crossChainScores[agent];
        uint256 len = scores.length;
        for (uint256 i = len; i > 0;) {
            unchecked { --i; }
            if (scores[i].sourceChain == sourceChain) {
                return (scores[i].score, true);
            }
        }
        return (0, false);
    }

    function hasCrossChainData(address agent) external view returns (bool) {
        return _crossChainScores[agent].length > 0;
    }

    function isMessageProcessed(bytes32 messageId) external view returns (bool) {
        return _processedMessages[messageId];
    }

    function supportsInterface(bytes4 interfaceId)
        public view virtual override(CCIPReceiver, AccessControl) returns (bool)
    {
        return CCIPReceiver.supportsInterface(interfaceId)
            || AccessControl.supportsInterface(interfaceId);
    }

    receive() external payable {}
}
