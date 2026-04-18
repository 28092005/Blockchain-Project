// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CertChainAccessControl.sol";

/**
 * @title GovernmentRegistry
 * @dev Government-approved institution verification
 * Only government-verified institutions can issue certificates
 */
contract GovernmentRegistry {
    
    CertChainAccessControl public accessControl;
    
    struct InstitutionProfile {
        string  name;
        string  registrationNumber;  // UGC/AICTE registration
        string  accreditation;       // NAAC/NBA grade
        address govVerifier;         // Government official who verified
        uint256 verifiedAt;
        bool    isVerified;
        bool    isActive;
    }
    
    mapping(address => InstitutionProfile) public institutions;
    mapping(string => address) public registrationToAddress;
    
    event InstitutionVerified(address indexed institution, string name, string registrationNumber, address verifier);
    event InstitutionSuspended(address indexed institution, string reason);
    event InstitutionReactivated(address indexed institution);
    
    modifier onlyGovernment() {
        require(
            accessControl.isSuperAdmin(msg.sender),
            "Only government officials can verify"
        );
        _;
    }
    
    constructor(address _accessControl) {
        accessControl = CertChainAccessControl(_accessControl);
    }
    
    function verifyInstitution(
        address institution,
        string calldata name,
        string calldata registrationNumber,
        string calldata accreditation
    ) external onlyGovernment {
        require(!institutions[institution].isVerified, "Already verified");
        require(registrationToAddress[registrationNumber] == address(0), "Registration number already used");
        
        institutions[institution] = InstitutionProfile({
            name: name,
            registrationNumber: registrationNumber,
            accreditation: accreditation,
            govVerifier: msg.sender,
            verifiedAt: block.timestamp,
            isVerified: true,
            isActive: true
        });
        
        registrationToAddress[registrationNumber] = institution;
        
        emit InstitutionVerified(institution, name, registrationNumber, msg.sender);
    }
    
    function suspendInstitution(address institution, string calldata reason) external onlyGovernment {
        require(institutions[institution].isVerified, "Not verified");
        institutions[institution].isActive = false;
        emit InstitutionSuspended(institution, reason);
    }
    
    function reactivateInstitution(address institution) external onlyGovernment {
        require(institutions[institution].isVerified, "Not verified");
        institutions[institution].isActive = true;
        emit InstitutionReactivated(institution);
    }
    
    function isVerifiedInstitution(address institution) external view returns (bool) {
        return institutions[institution].isVerified && institutions[institution].isActive;
    }
    
    function getInstitutionProfile(address institution) external view returns (InstitutionProfile memory) {
        return institutions[institution];
    }
}
