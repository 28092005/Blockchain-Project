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
    
    struct CreditBank {
        uint256 totalCredits;        // Total credits earned
        uint256 creditsUsed;         // Credits used for degrees
        uint256 creditsAvailable;    // Available for future use
        uint256 lastUpdated;
        bool    isActive;
        string  lastInstitution;     // Last institution attended
    }
    
    struct CreditEntry {
        address institution;
        string  courseName;
        uint256 credits;
        uint256 timestamp;
        bytes32 certificateHash;     // Link to certificate
    }
    
    // student => credit bank
    mapping(address => CreditBank) public creditBanks;
    
    // student => array of credit entries
    mapping(address => CreditEntry[]) public creditHistory;
    
    event CreditsAdded(address indexed student, address indexed institution, uint256 credits, string courseName);
    event CreditsTransferred(address indexed student, address fromInstitution, address toInstitution, uint256 credits);
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
        if (!creditBanks[student].isActive) {
            creditBanks[student].isActive = true;
            emit CreditBankActivated(student);
        }
        
        creditBanks[student].totalCredits += credits;
        creditBanks[student].creditsAvailable += credits;
        creditBanks[student].lastUpdated = block.timestamp;
        creditBanks[student].lastInstitution = getInstitutionName(msg.sender);
        
        creditHistory[student].push(CreditEntry({
            institution: msg.sender,
            courseName: courseName,
            credits: credits,
            timestamp: block.timestamp,
            certificateHash: certificateHash
        }));
        
        emit CreditsAdded(student, msg.sender, credits, courseName);
    }
    
    function getCreditBank(address student) external view returns (CreditBank memory) {
        return creditBanks[student];
    }
    
    function getCreditHistory(address student) external view returns (CreditEntry[] memory) {
        return creditHistory[student];
    }
    
    function getInstitutionName(address institution) internal pure returns (string memory) {
        // In production, this would query a registry
        return "Approved Institution";
    }
}
