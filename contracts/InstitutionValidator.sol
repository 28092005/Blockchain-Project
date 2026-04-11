// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CertChainAccessControl.sol";

/**
 * @title InstitutionValidator
 * @dev Multi-signature voting system for onboarding institutions
 *
 * HOW IT WORKS:
 * 1. Institution submits an application (name, country, accreditation ID)
 * 2. Validators vote APPROVE or REJECT
 * 3. If APPROVAL_THRESHOLD votes reached → institution is approved
 * 4. If REJECTION_THRESHOLD votes reached → institution is rejected
 * 5. Approved institution gets INSTITUTION_ROLE automatically
 *
 * INNOVATION: Threshold-based multi-sig (not just 1 admin deciding)
 */
contract InstitutionValidator is ReentrancyGuard {

    // ─────────────────────────────────────────────
    //  State Variables
    // ─────────────────────────────────────────────
    CertChainAccessControl public accessControl;

    uint256 public constant APPROVAL_THRESHOLD  = 3; // 3 of N validators must approve
    uint256 public constant REJECTION_THRESHOLD = 3; // 3 rejections = auto-reject
    uint256 public constant VOTING_PERIOD       = 7 days;

    uint256 private _proposalCounter;

    // ─────────────────────────────────────────────
    //  Data Structures
    // ─────────────────────────────────────────────
    enum ProposalStatus { PENDING, APPROVED, REJECTED, EXPIRED }
    enum VoteType { APPROVE, REJECT }

    struct InstitutionInfo {
        string  name;               // "IIT Bombay"
        string  country;            // "India"
        string  accreditationId;    // Official accreditation number
        string  website;            // Institution website
        address walletAddress;      // Institution's Ethereum address
        uint256 proposedAt;         // Timestamp of proposal
    }

    struct Proposal {
        uint256         proposalId;
        InstitutionInfo info;
        ProposalStatus  status;
        uint256         approvalCount;
        uint256         rejectionCount;
        uint256         deadline;
        address         proposedBy;   // Who submitted the application
        string          rejectionReason;
    }

    // proposalId => Proposal
    mapping(uint256 => Proposal) public proposals;

    // proposalId => validator address => has voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // proposalId => validator => their vote
    mapping(uint256 => mapping(address => VoteType)) public votes;

    // institution wallet => approved proposalId (0 if not approved)
    mapping(address => uint256) public approvedInstitutions;

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────
    event ProposalSubmitted(uint256 indexed proposalId, address indexed institution, string name, uint256 deadline);
    event VoteCast(uint256 indexed proposalId, address indexed validator, VoteType vote, uint256 approvals, uint256 rejections);
    event InstitutionApproved(uint256 indexed proposalId, address indexed institution, string name, uint256 timestamp);
    event InstitutionRejected(uint256 indexed proposalId, address indexed institution, string reason, uint256 timestamp);
    event ProposalExpired(uint256 indexed proposalId, uint256 timestamp);

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────
    modifier onlyValidator() {
        require(accessControl.isValidator(msg.sender), "Not a validator");
        _;
    }

    modifier onlySuperAdmin() {
        require(accessControl.isSuperAdmin(msg.sender), "Not super admin");
        _;
    }

    modifier proposalExists(uint256 proposalId) {
        require(proposalId > 0 && proposalId <= _proposalCounter, "Proposal does not exist");
        _;
    }

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────
    constructor(address _accessControl) {
        accessControl = CertChainAccessControl(_accessControl);
    }

    // ─────────────────────────────────────────────
    //  Core Functions
    // ─────────────────────────────────────────────

    /**
     * @dev Institution submits application to join the network
     */
    function submitApplication(
        string calldata name,
        string calldata country,
        string calldata accreditationId,
        string calldata website
    ) external nonReentrant returns (uint256 proposalId) {
        require(bytes(name).length > 0,             "Name required");
        require(bytes(accreditationId).length > 0,  "Accreditation ID required");
        require(approvedInstitutions[msg.sender] == 0, "Already approved");

        _proposalCounter++;
        proposalId = _proposalCounter;

        proposals[proposalId] = Proposal({
            proposalId:       proposalId,
            info: InstitutionInfo({
                name:             name,
                country:          country,
                accreditationId:  accreditationId,
                website:          website,
                walletAddress:    msg.sender,
                proposedAt:       block.timestamp
            }),
            status:           ProposalStatus.PENDING,
            approvalCount:    0,
            rejectionCount:   0,
            deadline:         block.timestamp + VOTING_PERIOD,
            proposedBy:       msg.sender,
            rejectionReason:  ""
        });

        emit ProposalSubmitted(proposalId, msg.sender, name, block.timestamp + VOTING_PERIOD);
    }

    /**
     * @dev Validator casts a vote on a pending proposal
     */
    function castVote(
        uint256 proposalId,
        VoteType vote,
        string calldata reason
    ) external onlyValidator proposalExists(proposalId) nonReentrant {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.status == ProposalStatus.PENDING,       "Not pending");
        require(block.timestamp <= proposal.deadline,             "Voting period ended");
        require(!hasVoted[proposalId][msg.sender],                "Already voted");

        hasVoted[proposalId][msg.sender] = true;
        votes[proposalId][msg.sender]    = vote;

        if (vote == VoteType.APPROVE) {
            proposal.approvalCount++;
        } else {
            proposal.rejectionCount++;
            if (bytes(reason).length > 0) {
                proposal.rejectionReason = reason;
            }
        }

        emit VoteCast(proposalId, msg.sender, vote, proposal.approvalCount, proposal.rejectionCount);

        // Check if thresholds reached
        if (proposal.approvalCount >= APPROVAL_THRESHOLD) {
            _approveInstitution(proposalId);
        } else if (proposal.rejectionCount >= REJECTION_THRESHOLD) {
            _rejectInstitution(proposalId);
        }
    }

    /**
     * @dev Mark expired proposals (callable by anyone)
     */
    function markExpired(uint256 proposalId) external proposalExists(proposalId) {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.status == ProposalStatus.PENDING, "Not pending");
        require(block.timestamp > proposal.deadline,        "Not expired yet");

        proposal.status = ProposalStatus.EXPIRED;
        emit ProposalExpired(proposalId, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  Internal Functions
    // ─────────────────────────────────────────────

    function _approveInstitution(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        proposal.status = ProposalStatus.APPROVED;
        approvedInstitutions[proposal.info.walletAddress] = proposalId;

        // Grant INSTITUTION_ROLE via AccessControl contract
        accessControl.grantRoleWithReason(
            accessControl.INSTITUTION_ROLE(),
            proposal.info.walletAddress,
            string(abi.encodePacked("Approved via proposal #", _toString(proposalId)))
        );

        emit InstitutionApproved(proposalId, proposal.info.walletAddress, proposal.info.name, block.timestamp);
    }

    function _rejectInstitution(uint256 proposalId) internal {
        Proposal storage proposal = proposals[proposalId];
        proposal.status = ProposalStatus.REJECTED;
        emit InstitutionRejected(proposalId, proposal.info.walletAddress, proposal.rejectionReason, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getTotalProposals() external view returns (uint256) {
        return _proposalCounter;
    }

    function isApproved(address institution) external view returns (bool) {
        return approvedInstitutions[institution] != 0;
    }

    // ─────────────────────────────────────────────
    //  Utility
    // ─────────────────────────────────────────────
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
