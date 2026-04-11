// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CertChainAccessControl.sol";

/**
 * @title ReputationScore
 * @dev Automatic on-chain reputation scoring for institutions
 *
 * SCORING LOGIC:
 * - Start score: 100
 * - Issue certificate:        +1  (active participation)
 * - Certificate verified:     +0  (neutral, just tracking)
 * - Certificate disputed:     -5  (quality issue)
 * - Certificate revoked:      -3  (revocation can be legitimate)
 * - Fraudulent cert detected: -20 (severe penalty)
 * - Min score: 0, Max score: 1000
 *
 * TRUST TIERS:
 * - PLATINUM : 800–1000
 * - GOLD     : 600–799
 * - SILVER   : 400–599
 * - BRONZE   : 200–399
 * - PROBATION: 0–199  (flagged for review)
 */
contract ReputationScore {

    CertChainAccessControl public accessControl;

    // ─────────────────────────────────────────────
    //  Constants
    // ─────────────────────────────────────────────
    uint256 public constant INITIAL_SCORE      = 100;
    uint256 public constant MAX_SCORE          = 1000;

    int256  public constant ISSUE_BONUS        =  1;
    int256  public constant DISPUTE_PENALTY    = -5;
    int256  public constant REVOKE_PENALTY     = -3;
    int256  public constant FRAUD_PENALTY      = -20;
    int256  public constant VERIFICATION_BONUS =  0;

    // ─────────────────────────────────────────────
    //  Data Structures
    // ─────────────────────────────────────────────
    enum TrustTier { PROBATION, BRONZE, SILVER, GOLD, PLATINUM }

    struct InstitutionScore {
        uint256 score;
        uint256 totalIssued;
        uint256 totalRevoked;
        uint256 totalDisputed;
        uint256 totalVerifications;
        uint256 lastUpdated;
        bool    initialized;
    }

    // institution address => score data
    mapping(address => InstitutionScore) public scores;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────
    event ScoreInitialized(address indexed institution, uint256 initialScore, uint256 timestamp);
    event ScoreUpdated(address indexed institution, uint256 oldScore, uint256 newScore, string reason, uint256 timestamp);
    event TierChanged(address indexed institution, TrustTier oldTier, TrustTier newTier, uint256 timestamp);

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────
    modifier onlyCertRegistry() {
        require(
            accessControl.isCertRegistry(msg.sender),
            "Not authorized: caller is not CertificateRegistry"
        );
        _;
    }

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────
    constructor(address _accessControl) {
        accessControl = CertChainAccessControl(_accessControl);
    }

    // ─────────────────────────────────────────────
    //  Score Management
    // ─────────────────────────────────────────────

    /**
     * @dev Initialize score when institution is first approved
     */
    function initializeScore(address institution) external {
        require(accessControl.isSuperAdmin(msg.sender), "Not authorized");
        require(!scores[institution].initialized, "Already initialized");

        scores[institution] = InstitutionScore({
            score:              INITIAL_SCORE,
            totalIssued:        0,
            totalRevoked:       0,
            totalDisputed:      0,
            totalVerifications: 0,
            lastUpdated:        block.timestamp,
            initialized:        true
        });

        emit ScoreInitialized(institution, INITIAL_SCORE, block.timestamp);
    }

    /**
     * @dev Called when institution issues a certificate
     */
    function recordIssuance(address institution) external onlyCertRegistry {
        _updateScore(institution, ISSUE_BONUS, "Certificate issued");
        scores[institution].totalIssued++;
    }

    /**
     * @dev Called when a certificate is disputed
     */
    function recordDispute(address institution) external {
        require(accessControl.isSuperAdmin(msg.sender), "Not authorized");
        _updateScore(institution, DISPUTE_PENALTY, "Certificate disputed");
        scores[institution].totalDisputed++;
    }

    /**
     * @dev Called when a certificate is revoked
     */
    function recordRevocation(address institution) external onlyCertRegistry {
        _updateScore(institution, REVOKE_PENALTY, "Certificate revoked");
        scores[institution].totalRevoked++;
    }

    /**
     * @dev Called when fraud is confirmed
     */
    function recordFraud(address institution) external {
        require(accessControl.isSuperAdmin(msg.sender), "Not authorized");
        _updateScore(institution, FRAUD_PENALTY, "Fraudulent certificate detected");
    }

    /**
     * @dev Record a verification (tracking metric)
     */
    function recordVerification(address institution) external {
        if (scores[institution].initialized) {
            scores[institution].totalVerifications++;
            scores[institution].lastUpdated = block.timestamp;
        }
    }

    // ─────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────

    function _updateScore(address institution, int256 delta, string memory reason) internal {
        require(scores[institution].initialized, "Institution not initialized");

        TrustTier oldTier = getTrustTier(institution);
        uint256 oldScore  = scores[institution].score;

        // Safe math with floor at 0 and ceiling at MAX_SCORE
        if (delta < 0) {
            uint256 penalty = uint256(-delta);
            scores[institution].score = oldScore > penalty ? oldScore - penalty : 0;
        } else {
            uint256 bonus = uint256(delta);
            uint256 newScore = oldScore + bonus;
            scores[institution].score = newScore > MAX_SCORE ? MAX_SCORE : newScore;
        }

        scores[institution].lastUpdated = block.timestamp;

        emit ScoreUpdated(institution, oldScore, scores[institution].score, reason, block.timestamp);

        TrustTier newTier = getTrustTier(institution);
        if (newTier != oldTier) {
            emit TierChanged(institution, oldTier, newTier, block.timestamp);
        }
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    function getScore(address institution) external view returns (uint256) {
        return scores[institution].score;
    }

    function getTrustTier(address institution) public view returns (TrustTier) {
        uint256 s = scores[institution].score;
        if (s >= 800) return TrustTier.PLATINUM;
        if (s >= 600) return TrustTier.GOLD;
        if (s >= 400) return TrustTier.SILVER;
        if (s >= 200) return TrustTier.BRONZE;
        return TrustTier.PROBATION;
    }

    function getFullStats(address institution) external view returns (InstitutionScore memory) {
        return scores[institution];
    }
}
