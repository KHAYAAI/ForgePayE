// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title ForgeReputationRegistry
/// @notice Central registry mapping agent addresses to on-chain reputation scores (0-1000).
///         Forked from Qova/ReputationRegistry — patches applied:
///         P4a: zero-address guard in registerAgent()
///         P4b: freezeAgent() for FORGE compliance freeze (sanctions, KYC failure)
/// @dev Scores are written by authorized updaters (CRE consumer + FORGE settlement job).
///      Supports batch operations for gas efficiency (max 100 per batch).
contract ForgeReputationRegistry is AccessControl, Pausable {

    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    struct AgentDetails {
        uint16  score;        // 2 bytes  — 0-1000
        uint48  lastUpdated;  // 6 bytes  — unix timestamp
        uint32  updateCount;  // 4 bytes
        bool    registered;   // 1 byte
        bool    frozen;       // 1 byte   — compliance freeze (sanctions / KYC failure)
    }                         // 15 bytes total — fits in 1 storage slot

    mapping(address => AgentDetails) private _agents;

    uint256 public constant MAX_BATCH_SIZE = 100;

    // ── Errors ────────────────────────────────────────────────────────────────
    error AgentNotRegistered();
    error AgentAlreadyRegistered();
    error AgentFrozen(address agent);          // P4b
    error InvalidScore();
    error ArrayLengthMismatch();
    error BatchSizeTooLarge();
    error ZeroAddress();                        // P4a

    // ── Events ────────────────────────────────────────────────────────────────
    event AgentRegistered(address indexed agent, uint48 timestamp);
    event ScoreUpdated(
        address indexed agent,
        uint16  oldScore,
        uint16  newScore,
        bytes32 reason,
        uint48  timestamp
    );
    event AgentFreezeUpdated(address indexed agent, bool frozen, bytes32 reason); // P4b

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPDATER_ROLE, msg.sender);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── Registration ──────────────────────────────────────────────────────────

    /// @notice Register a new agent with an initial score of 0.
    function registerAgent(address agent) external onlyRole(UPDATER_ROLE) whenNotPaused {
        if (agent == address(0)) revert ZeroAddress();             // P4a
        if (_agents[agent].registered) revert AgentAlreadyRegistered();

        uint48 ts = uint48(block.timestamp);
        _agents[agent] = AgentDetails({
            score:       0,
            lastUpdated: ts,
            updateCount: 0,
            registered:  true,
            frozen:      false
        });

        emit AgentRegistered(agent, ts);
    }

    // ── Score updates ─────────────────────────────────────────────────────────

    /// @notice Update a single agent's reputation score.
    /// @dev Reverts if agent is frozen — frozen agents cannot receive score updates
    ///      until unfrozen by compliance admin.
    function updateScore(
        address agent,
        uint16  newScore,
        bytes32 reason
    ) external onlyRole(UPDATER_ROLE) whenNotPaused {
        if (newScore > 1000) revert InvalidScore();

        AgentDetails storage d = _agents[agent];
        if (!d.registered)  revert AgentNotRegistered();
        if (d.frozen)        revert AgentFrozen(agent);            // P4b

        uint16 oldScore = d.score;
        uint48 ts       = uint48(block.timestamp);

        d.score       = newScore;
        d.lastUpdated = ts;
        unchecked { d.updateCount += 1; }

        emit ScoreUpdated(agent, oldScore, newScore, reason, ts);
    }

    /// @notice Batch-update scores for up to 100 agents in a single transaction.
    function batchUpdateScores(
        address[] calldata agents,
        uint16[]  calldata scores,
        bytes32[] calldata reasons
    ) external onlyRole(UPDATER_ROLE) whenNotPaused {
        uint256 len = agents.length;
        if (len > MAX_BATCH_SIZE)                         revert BatchSizeTooLarge();
        if (len != scores.length || len != reasons.length) revert ArrayLengthMismatch();

        uint48 ts = uint48(block.timestamp);

        for (uint256 i; i < len;) {
            uint16 newScore = scores[i];
            if (newScore > 1000) revert InvalidScore();

            AgentDetails storage d = _agents[agents[i]];
            if (!d.registered) revert AgentNotRegistered();
            if (d.frozen)      revert AgentFrozen(agents[i]);      // P4b

            uint16 oldScore = d.score;
            d.score       = newScore;
            d.lastUpdated = ts;
            unchecked { d.updateCount += 1; }

            emit ScoreUpdated(agents[i], oldScore, newScore, reasons[i], ts);
            unchecked { ++i; }
        }
    }

    // ── Compliance freeze (P4b) ───────────────────────────────────────────────

    /// @notice Freeze or unfreeze an agent's score record.
    /// @dev Only DEFAULT_ADMIN_ROLE (compliance officer). Frozen agents:
    ///      - Cannot receive score updates
    ///      - Score reads still work (lenders see the last score + frozen flag)
    ///      - Used for: sanctions hits, KYC revocation, court orders
    /// @param reason keccak256 of a reason string (e.g. keccak256("OFAC_SANCTIONS"))
    function setFrozen(
        address agent,
        bool    freeze,
        bytes32 reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_agents[agent].registered) revert AgentNotRegistered();
        _agents[agent].frozen = freeze;
        emit AgentFreezeUpdated(agent, freeze, reason);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getScore(address agent) external view returns (uint16) {
        if (!_agents[agent].registered) revert AgentNotRegistered();
        return _agents[agent].score;
    }

    function getAgentDetails(address agent) external view returns (AgentDetails memory) {
        return _agents[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].registered;
    }

    function isFrozen(address agent) external view returns (bool) {
        return _agents[agent].frozen;
    }
}
