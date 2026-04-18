// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CertChainAccessControl.sol";

/**
 * @title CreditTransferSystem
 * @dev NEP 2020 compliant credit banking system
 * Students can pause studies and resume later with accumulated credits
 */
contract CreditTransferSystem {
    
    CertChainAccessControl public accessControl;
    
    enum StudentStatus { ACTIVE, ON_LEAVE, GRADUATED }
    
    struct CreditBank {
        uint256 totalCredits;
        uint256 creditsUsed;
        uint256 creditsAvailable;
        uint256 lastUpdated;
        StudentStatus status;
        string  lastInstitution;
    }
    
    struct CreditEntry {
        address institution;
        string  courseName;
        uint256 credits;
        uint256 timestamp;
        bytes32 certificateHash;
    }
    
    struct LeaveRecord {
        string  reason;
        uint256 timestamp;
        uint256 creditsAtLeave;
        string  institution;
    }
    
    struct RejoinRecord {
        string  institution;
        uint256 timestamp;
        uint256 creditsRestored;
        uint256 yearsGap;
    }
    
    mapping(address => CreditBank) public creditBanks;
    mapping(address => CreditEntry[]) private creditHistory;
    mapping(address => LeaveRecord[]) private leaveHistory;
    mapping(address => RejoinRecord[]) private rejoinHistory;
    
    event CreditsAdded(address indexed student, address indexed institution, uint256 credits, string courseName);
    event StudentLeft(address indexed student, string reason, uint256 creditsStored);
    event StudentRejoined(address indexed student, string institution, uint256 creditsRestored, uint256 yearsGap);
    event CreditBankActivated(address indexed student);
    
    modifier onlyInstitution() {
        require(
            accessControl.hasRole(accessControl.INSTITUTION_ROLE(), msg.sender),
            "Not an approved institution"
        );
        _;
    }
    
    constructor(address _accessControl) {
        accessControl = CertChainAccessControl(_accessControl);
    }
    
    function addCredits(
        address student,
        uint256 credits,
        string calldata courseName,
        bytes32 certificateHash
    ) external onlyInstitution {
        if (creditBanks[student].lastUpdated == 0) {
            creditBanks[student].status = StudentStatus.ACTIVE;
            emit CreditBankActivated(student);
        }
        
        creditBanks[student].totalCredits += credits;
        creditBanks[student].creditsAvailable += credits;
        creditBanks[student].lastUpdated = block.timestamp;
        creditBanks[student].lastInstitution = courseName;
        
        creditHistory[student].push(CreditEntry({
            institution: msg.sender,
            courseName: courseName,
            credits: credits,
            timestamp: block.timestamp,
            certificateHash: certificateHash
        }));
        
        emit CreditsAdded(student, msg.sender, credits, courseName);
    }
    
    function requestLeave(string calldata reason) external {
        require(creditBanks[msg.sender].status == StudentStatus.ACTIVE, "Not currently active");
        
        creditBanks[msg.sender].status = StudentStatus.ON_LEAVE;
        creditBanks[msg.sender].lastUpdated = block.timestamp;
        
        leaveHistory[msg.sender].push(LeaveRecord({
            reason: reason,
            timestamp: block.timestamp,
            creditsAtLeave: creditBanks[msg.sender].totalCredits,
            institution: creditBanks[msg.sender].lastInstitution
        }));
        
        emit StudentLeft(msg.sender, reason, creditBanks[msg.sender].totalCredits);
    }
    
    function rejoinStudies(string calldata institution) external {
        require(creditBanks[msg.sender].status == StudentStatus.ON_LEAVE, "Not on leave");
        
        uint256 yearsGap = 0;
        if (leaveHistory[msg.sender].length > 0) {
            uint256 lastLeaveTime = leaveHistory[msg.sender][leaveHistory[msg.sender].length - 1].timestamp;
            yearsGap = (block.timestamp - lastLeaveTime) / 365 days;
        }
        
        creditBanks[msg.sender].status = StudentStatus.ACTIVE;
        creditBanks[msg.sender].lastUpdated = block.timestamp;
        creditBanks[msg.sender].lastInstitution = institution;
        
        rejoinHistory[msg.sender].push(RejoinRecord({
            institution: institution,
            timestamp: block.timestamp,
            creditsRestored: creditBanks[msg.sender].totalCredits,
            yearsGap: yearsGap
        }));
        
        emit StudentRejoined(msg.sender, institution, creditBanks[msg.sender].totalCredits, yearsGap);
    }
    
    function getCreditBank(address student) external view returns (CreditBank memory) {
        return creditBanks[student];
    }
    
    function getCreditHistory(address student) external view returns (CreditEntry[] memory) {
        return creditHistory[student];
    }
    
    function getLeaveHistory(address student) external view returns (LeaveRecord[] memory) {
        return leaveHistory[student];
    }
    
    function getRejoinHistory(address student) external view returns (RejoinRecord[] memory) {
        return rejoinHistory[student];
    }
    
    function getCreditCount(address student) external view returns (uint256) {
        return creditHistory[student].length;
    }
}
