// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./CertChainAccessControl.sol";
import "./ReputationScore.sol";

/**
 * @title CertificateRegistry
 * @dev Core smart contract for issuing, verifying, revoking,
 *      and versioning academic certificates on-chain.
 *
 * KEY INNOVATIONS:
 * 1. Certificate Versioning  — corrections tracked immutably
 * 2. Lifecycle Management    — ACTIVE / SUPERSEDED / REVOKED / EXPIRED
 * 3. Merkle Root Support     — batch verification with single root hash
 * 4. IPFS Integration        — off-chain PDF, on-chain hash
 * 5. Reputation Hooks        — auto-updates institution score on actions
 * 6. Gas-Optimized Events    — full audit trail via events (not storage)
 */
contract CertificateRegistry is ReentrancyGuard, Pausable {

    // ─────────────────────────────────────────────
    //  Dependencies
    // ─────────────────────────────────────────────
    CertChainAccessControl public accessControl;
    ReputationScore        public reputationContract;

    // ─────────────────────────────────────────────
    //  Enums
    // ─────────────────────────────────────────────
    enum CertStatus {
        ACTIVE,       // Valid, current version
        SUPERSEDED,   // Old version (correction was made)
        REVOKED,      // Permanently cancelled
        EXPIRED       // Past expiry date, no longer valid
    }

    // ─────────────────────────────────────────────
    //  Data Structures
    // ─────────────────────────────────────────────
    struct Certificate {
        bytes32    certHash;         // SHA-256 hash of certificate PDF
        address    issuedBy;         // Institution wallet address
        address    issuedTo;         // Student wallet address
        uint256    issuedAt;         // Timestamp of issuance
        uint256    expiresAt;        // 0 = never expires
        CertStatus status;           // Current lifecycle state
        uint8      version;          // Version number (starts at 1)
        bytes32    previousHash;     // Previous version's hash (0 if v1)
        bytes32    latestHash;       // Points to newest version
        string     ipfsCID;          // IPFS content identifier for PDF
        string     metadataURI;      // JSON metadata (name, degree, grade)
        string     revocationReason; // Only set when REVOKED
        bytes32    batchMerkleRoot;  // Merkle root of batch (if batch issued)
    }

    // ─────────────────────────────────────────────
    //  Storage
    // ─────────────────────────────────────────────

    // certHash => Certificate
    mapping(bytes32 => Certificate) private _certificates;

    // certHash => exists (for quick checks)
    mapping(bytes32 => bool) public certExists;

    // student address => array of their cert hashes
    mapping(address => bytes32[]) private _studentCerts;

    // institution => total certs issued
    mapping(address => uint256) public institutionCertCount;

    // batchId => array of cert hashes (for batch operations)
    mapping(bytes32 => bytes32[]) private _batches;

    uint256 public totalCertificates;

    // ─────────────────────────────────────────────
    //  Events  (full audit trail)
    // ─────────────────────────────────────────────
    event CertificateIssued(
        bytes32 indexed certHash,
        address indexed issuedBy,
        address indexed issuedTo,
        string  ipfsCID,
        uint8   version,
        uint256 timestamp
    );

    event CertificateRevoked(
        bytes32 indexed certHash,
        address indexed revokedBy,
        string  reason,
        uint256 timestamp
    );

    event CertificateCorrected(
        bytes32 indexed oldHash,
        bytes32 indexed newHash,
        address indexed issuedBy,
        uint8   newVersion,
        string  correctionNote,
        uint256 timestamp
    );

    event CertificateExpired(
        bytes32 indexed certHash,
        uint256 timestamp
    );

    event CertificateVerified(
        bytes32 indexed certHash,
        address indexed verifiedBy,
        bool    isValid,
        uint256 timestamp
    );

    event BatchIssued(
        bytes32 indexed batchId,
        bytes32         merkleRoot,
        address indexed issuedBy,
        uint256         count,
        uint256         timestamp
    );

    // ─────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────
    modifier onlyInstitution() {
        require(
            accessControl.hasRole(accessControl.INSTITUTION_ROLE(), msg.sender),
            "CertRegistry: caller is not an approved institution"
        );
        _;
    }

    modifier certMustExist(bytes32 certHash) {
        require(certExists[certHash], "CertRegistry: certificate not found");
        _;
    }

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────
    constructor(address _accessControl, address _reputation) {
        accessControl      = CertChainAccessControl(_accessControl);
        reputationContract = ReputationScore(_reputation);
    }

    // ─────────────────────────────────────────────
    //  ISSUE — Single Certificate
    // ─────────────────────────────────────────────

    /**
     * @dev Issue a new certificate
     * @param certHash    SHA-256 hash of the certificate PDF
     * @param student     Student's wallet address
     * @param ipfsCID     IPFS content ID of the certificate PDF
     * @param metadataURI URI pointing to certificate JSON metadata
     * @param expiresAt   Expiry timestamp (0 for permanent)
     */
    function issueCertificate(
        bytes32       certHash,
        address       student,
        string calldata ipfsCID,
        string calldata metadataURI,
        uint256       expiresAt
    ) external onlyInstitution whenNotPaused nonReentrant {
        require(certHash != bytes32(0),         "Invalid cert hash");
        require(student  != address(0),         "Invalid student address");
        require(!certExists[certHash],           "Certificate already exists");
        require(bytes(ipfsCID).length > 0,      "IPFS CID required");

        _certificates[certHash] = Certificate({
            certHash:         certHash,
            issuedBy:         msg.sender,
            issuedTo:         student,
            issuedAt:         block.timestamp,
            expiresAt:        expiresAt,
            status:           CertStatus.ACTIVE,
            version:          1,
            previousHash:     bytes32(0),
            latestHash:       certHash,
            ipfsCID:          ipfsCID,
            metadataURI:      metadataURI,
            revocationReason: "",
            batchMerkleRoot:  bytes32(0)
        });

        certExists[certHash] = true;
        _studentCerts[student].push(certHash);
        institutionCertCount[msg.sender]++;
        totalCertificates++;

        // Update reputation
        reputationContract.recordIssuance(msg.sender);

        emit CertificateIssued(certHash, msg.sender, student, ipfsCID, 1, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  BATCH ISSUE — Multiple Certificates
    // ─────────────────────────────────────────────

    /**
     * @dev Issue a batch of certificates with a shared Merkle root
     * @param certHashes   Array of certificate hashes
     * @param students     Array of student addresses
     * @param ipfsCIDs     Array of IPFS CIDs
     * @param merkleRoot   Merkle root of the entire batch
     */
    function issueBatch(
        bytes32[] calldata certHashes,
        address[] calldata students,
        string[]  calldata ipfsCIDs,
        bytes32            merkleRoot
    ) external onlyInstitution whenNotPaused nonReentrant {
        require(certHashes.length == students.length, "Arrays length mismatch");
        require(certHashes.length == ipfsCIDs.length, "Arrays length mismatch");
        require(certHashes.length > 0,                "Empty batch");
        require(certHashes.length <= 100,             "Batch too large (max 100)");

        bytes32 batchId = keccak256(abi.encodePacked(msg.sender, block.timestamp, merkleRoot));

        for (uint256 i = 0; i < certHashes.length; i++) {
            require(!certExists[certHashes[i]], "Duplicate in batch");

            _certificates[certHashes[i]] = Certificate({
                certHash:         certHashes[i],
                issuedBy:         msg.sender,
                issuedTo:         students[i],
                issuedAt:         block.timestamp,
                expiresAt:        0,
                status:           CertStatus.ACTIVE,
                version:          1,
                previousHash:     bytes32(0),
                latestHash:       certHashes[i],
                ipfsCID:          ipfsCIDs[i],
                metadataURI:      "",
                revocationReason: "",
                batchMerkleRoot:  merkleRoot
            });

            certExists[certHashes[i]] = true;
            _studentCerts[students[i]].push(certHashes[i]);
            _batches[batchId].push(certHashes[i]);
        }

        institutionCertCount[msg.sender] += certHashes.length;
        totalCertificates += certHashes.length;

        reputationContract.recordIssuance(msg.sender);

        emit BatchIssued(batchId, merkleRoot, msg.sender, certHashes.length, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  REVOKE
    // ─────────────────────────────────────────────

    /**
     * @dev Permanently revoke a certificate (no replacement)
     */
    function revokeCertificate(
        bytes32        certHash,
        string calldata reason
    ) external onlyInstitution certMustExist(certHash) nonReentrant {
        Certificate storage cert = _certificates[certHash];

        require(cert.issuedBy == msg.sender,         "Not the issuing institution");
        require(cert.status   == CertStatus.ACTIVE,  "Can only revoke active certificates");
        require(bytes(reason).length > 0,             "Revocation reason required");

        cert.status           = CertStatus.REVOKED;
        cert.revocationReason = reason;

        reputationContract.recordRevocation(msg.sender);

        emit CertificateRevoked(certHash, msg.sender, reason, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  CORRECT — Issue New Version
    // ─────────────────────────────────────────────

    /**
     * @dev Correct a certificate by issuing a new version
     *      Old certificate is marked SUPERSEDED (not deleted!)
     *      Full audit trail preserved on-chain
     *
     * @param oldCertHash    Hash of certificate to correct
     * @param newCertHash    Hash of the corrected certificate
     * @param newIpfsCID     IPFS CID of the corrected PDF
     * @param correctionNote Explanation of what was corrected
     */
    function correctCertificate(
        bytes32        oldCertHash,
        bytes32        newCertHash,
        string calldata newIpfsCID,
        string calldata newMetadataURI,
        string calldata correctionNote
    ) external onlyInstitution certMustExist(oldCertHash) nonReentrant {
        Certificate storage oldCert = _certificates[oldCertHash];

        require(oldCert.issuedBy == msg.sender,          "Not the issuing institution");
        require(oldCert.status   == CertStatus.ACTIVE,   "Certificate not active");
        require(!certExists[newCertHash],                  "New hash already exists");
        require(bytes(correctionNote).length > 0,          "Correction note required");

        uint8 newVersion = oldCert.version + 1;

        // Mark old as SUPERSEDED
        oldCert.status     = CertStatus.SUPERSEDED;
        oldCert.latestHash = newCertHash;

        // Create corrected version
        _certificates[newCertHash] = Certificate({
            certHash:         newCertHash,
            issuedBy:         msg.sender,
            issuedTo:         oldCert.issuedTo,
            issuedAt:         block.timestamp,
            expiresAt:        oldCert.expiresAt,
            status:           CertStatus.ACTIVE,
            version:          newVersion,
            previousHash:     oldCertHash,
            latestHash:       newCertHash,
            ipfsCID:          newIpfsCID,
            metadataURI:      newMetadataURI,
            revocationReason: "",
            batchMerkleRoot:  bytes32(0)
        });

        certExists[newCertHash] = true;
        _studentCerts[oldCert.issuedTo].push(newCertHash);
        totalCertificates++;

        emit CertificateCorrected(oldCertHash, newCertHash, msg.sender, newVersion, correctionNote, block.timestamp);
        emit CertificateIssued(newCertHash, msg.sender, oldCert.issuedTo, newIpfsCID, newVersion, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  EXPIRE — Mark certificates past their date
    // ─────────────────────────────────────────────

    /**
     * @dev Trigger expiry check (callable by anyone)
     */
    function checkExpiry(bytes32 certHash) external certMustExist(certHash) {
        Certificate storage cert = _certificates[certHash];
        if (
            cert.expiresAt  != 0 &&
            block.timestamp >  cert.expiresAt &&
            cert.status     == CertStatus.ACTIVE
        ) {
            cert.status = CertStatus.EXPIRED;
            emit CertificateExpired(certHash, block.timestamp);
        }
    }

    // ─────────────────────────────────────────────
    //  VERIFY
    // ─────────────────────────────────────────────

    /**
     * @dev Verify a certificate and log the verification attempt
     * @return isValid   True if certificate is ACTIVE and not expired
     * @return cert      Full certificate data
     */
    function verifyCertificate(bytes32 certHash)
        external
        returns (bool isValid, Certificate memory cert)
    {
        if (!certExists[certHash]) {
            emit CertificateVerified(certHash, msg.sender, false, block.timestamp);
            return (false, cert);
        }

        cert    = _certificates[certHash];
        isValid = (cert.status == CertStatus.ACTIVE) &&
                  (cert.expiresAt == 0 || block.timestamp <= cert.expiresAt);

        // Log verification for reputation tracking
        reputationContract.recordVerification(cert.issuedBy);

        emit CertificateVerified(certHash, msg.sender, isValid, block.timestamp);
        return (isValid, cert);
    }

    /**
     * @dev Verify using Merkle proof (for batch-issued certificates)
     * @param certHash     The certificate hash to verify
     * @param proof        Merkle proof path
     * @param merkleRoot   Expected Merkle root
     */
    function verifyWithMerkleProof(
        bytes32          certHash,
        bytes32[] calldata proof,
        bytes32          merkleRoot
    ) external view returns (bool) {
        if (!certExists[certHash]) return false;
        if (_certificates[certHash].batchMerkleRoot != merkleRoot) return false;

        // Verify Merkle proof
        bytes32 computedHash = certHash;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == merkleRoot;
    }

    // ─────────────────────────────────────────────
    //  View Functions
    // ─────────────────────────────────────────────

    function getCertificate(bytes32 certHash)
        external view certMustExist(certHash)
        returns (Certificate memory)
    {
        return _certificates[certHash];
    }

    function getStudentCertificates(address student)
        external view returns (bytes32[] memory)
    {
        return _studentCerts[student];
    }

    function getCertStatus(bytes32 certHash)
        external view certMustExist(certHash)
        returns (CertStatus)
    {
        return _certificates[certHash].status;
    }

    function getLatestVersion(bytes32 certHash)
        external view certMustExist(certHash)
        returns (bytes32)
    {
        return _certificates[certHash].latestHash;
    }
}
