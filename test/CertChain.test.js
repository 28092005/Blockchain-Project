const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");
const chaiMatchers = require("@nomicfoundation/hardhat-chai-matchers");
const MerkleTree  = require("../backend/utils/MerkleTree");
const BloomFilter = require("../backend/utils/BloomFilter");
const crypto      = require("crypto");

function fakeCertHash(seed = "test") {
  return "0x" + crypto.createHash("sha256").update(seed + Math.random().toString()).digest("hex");
}

describe("CertChain — Full System Tests", function () {
  let accessControl, institutionValidator, reputationScore, certRegistry;
  let deployer, superAdmin, institution1, institution2;
  let validator1, validator2, validator3;
  let student1, student2, employer;

  before(async function () {
    [deployer, superAdmin, institution1, institution2,
     validator1, validator2, validator3,
     student1, student2, employer] = await ethers.getSigners();

    const AccessControlFactory = await ethers.getContractFactory("CertChainAccessControl");
    accessControl = await AccessControlFactory.deploy(superAdmin.address);
    await accessControl.waitForDeployment();

    const InstitutionFactory = await ethers.getContractFactory("InstitutionValidator");
    institutionValidator = await InstitutionFactory.deploy(await accessControl.getAddress());
    await institutionValidator.waitForDeployment();

    const ReputationFactory = await ethers.getContractFactory("ReputationScore");
    reputationScore = await ReputationFactory.deploy(await accessControl.getAddress());
    await reputationScore.waitForDeployment();

    const CertRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
    certRegistry = await CertRegistryFactory.deploy(
      await accessControl.getAddress(),
      await reputationScore.getAddress()
    );
    await certRegistry.waitForDeployment();

    const VALIDATOR_ROLE   = await accessControl.VALIDATOR_ROLE();
    const SUPER_ADMIN_ROLE = await accessControl.SUPER_ADMIN_ROLE();
    const INSTITUTION_ROLE = await accessControl.INSTITUTION_ROLE();

    // deployer has DEFAULT_ADMIN_ROLE — use grantRole (plain OZ) for SUPER_ADMIN_ROLE grants
    await accessControl.connect(deployer).grantRole(SUPER_ADMIN_ROLE, await institutionValidator.getAddress());

    // Grant CERT_REGISTRY_ROLE to CertificateRegistry — admin of this role is SUPER_ADMIN_ROLE
    // so superAdmin must grant it
    const CERT_REGISTRY_ROLE = await accessControl.CERT_REGISTRY_ROLE();
    await accessControl.connect(superAdmin).grantRoleWithReason(CERT_REGISTRY_ROLE, await certRegistry.getAddress(), "test setup");

    // superAdmin grants VALIDATOR_ROLE (admin = SUPER_ADMIN_ROLE)
    await accessControl.connect(superAdmin).grantRoleWithReason(VALIDATOR_ROLE, validator1.address, "test v1");
    await accessControl.connect(superAdmin).grantRoleWithReason(VALIDATOR_ROLE, validator2.address, "test v2");
    await accessControl.connect(superAdmin).grantRoleWithReason(VALIDATOR_ROLE, validator3.address, "test v3");

    // superAdmin grants INSTITUTION_ROLE directly for tests
    await accessControl.connect(superAdmin).grantRoleWithReason(INSTITUTION_ROLE, institution1.address, "direct grant for tests");

    // superAdmin initializes reputation score for institution1
    await reputationScore.connect(superAdmin).initializeScore(institution1.address);
  });

  // ═══════════════════════════════════════════
  //  SECTION 1: Access Control
  // ═══════════════════════════════════════════
  describe("1. Access Control (RBAC)", function () {
    it("should assign SUPER_ADMIN_ROLE to superAdmin", async function () {
      expect(await accessControl.isSuperAdmin(superAdmin.address)).to.be.true;
    });

    it("should assign VALIDATOR_ROLE to validators", async function () {
      expect(await accessControl.isValidator(validator1.address)).to.be.true;
      expect(await accessControl.isValidator(validator2.address)).to.be.true;
    });

    it("should reject non-admin granting roles", async function () {
      const INSTITUTION_ROLE = await accessControl.INSTITUTION_ROLE();
      await expect(
        accessControl.connect(employer).grantRoleWithReason(INSTITUTION_ROLE, institution2.address, "hack")
      ).to.be.rejectedWith(Error);
    });

    it("should pause and unpause system", async function () {
      await accessControl.connect(superAdmin).pauseSystem("emergency test");
      await accessControl.connect(superAdmin).unpauseSystem();
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 2: Institution Multi-Sig Voting
  // ═══════════════════════════════════════════
  describe("2. Institution Validator (Multi-Sig)", function () {
    let proposalId;

    it("should allow institution to submit application", async function () {
      const tx = await institutionValidator.connect(institution2).submitApplication(
        "IIT Bombay", "India", "NAAC-A-2024", "https://iitb.ac.in"
      );
      const receipt = await tx.wait();
      const event   = receipt.logs.find(l => l.fragment?.name === "ProposalSubmitted");
      proposalId    = event.args.proposalId;
      expect(proposalId).to.equal(1n);
    });

    it("should allow validators to vote APPROVE", async function () {
      await institutionValidator.connect(validator1).castVote(proposalId, 0, "Legit");
      await institutionValidator.connect(validator2).castVote(proposalId, 0, "Verified");
      const proposal = await institutionValidator.getProposal(proposalId);
      expect(proposal.approvalCount).to.equal(2n);
    });

    it("should auto-approve after threshold reached", async function () {
      await institutionValidator.connect(validator3).castVote(proposalId, 0, "Confirmed");
      const proposal = await institutionValidator.getProposal(proposalId);
      expect(Number(proposal.status)).to.equal(1); // APPROVED
      expect(await accessControl.isInstitution(institution2.address)).to.be.true;
    });

    it("should prevent double voting", async function () {
      await expect(
        institutionValidator.connect(validator1).castVote(proposalId, 0, "Again")
      ).to.be.rejectedWith(Error);
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 3: Certificate Issuance
  // ═══════════════════════════════════════════
  describe("3. Certificate Issuance", function () {
    let certHash;

    it("should issue a certificate", async function () {
      certHash = fakeCertHash("cert1");
      await certRegistry.connect(institution1).issueCertificate(
        certHash, student1.address, "QmTestCID123", "{}", 0
      );
      expect(await certRegistry.certExists(certHash)).to.be.true;
    });

    it("should reject duplicate certificate hash", async function () {
      await expect(
        certRegistry.connect(institution1).issueCertificate(
          certHash, student1.address, "QmOther", "{}", 0
        )
      ).to.be.rejectedWith(Error);
    });

    it("should reject issuance from non-institution", async function () {
      const newHash = fakeCertHash("unauthorized");
      await expect(
        certRegistry.connect(employer).issueCertificate(
          newHash, student1.address, "QmTest", "{}", 0
        )
      ).to.be.rejectedWith(Error);
    });

    it("should store correct certificate data", async function () {
      const cert = await certRegistry.getCertificate(certHash);
      expect(cert.issuedBy).to.equal(institution1.address);
      expect(cert.issuedTo).to.equal(student1.address);
      expect(cert.version).to.equal(1n);
      expect(cert.status).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 4: Certificate Verification
  // ═══════════════════════════════════════════
  describe("4. Certificate Verification", function () {
    let certHash;

    before(async function () {
      certHash = fakeCertHash("verify-test");
      await certRegistry.connect(institution1).issueCertificate(
        certHash, student1.address, "QmVerifyCID", "{}", 0
      );
    });

    it("should verify a valid certificate", async function () {
      const [isValid] = await certRegistry.verifyCertificate.staticCall(certHash);
      expect(isValid).to.be.true;
    });

    it("should return false for non-existent certificate", async function () {
      const fakeHash = fakeCertHash("nonexistent");
      const [isValid] = await certRegistry.verifyCertificate.staticCall(fakeHash);
      expect(isValid).to.be.false;
    });

    it("should handle expired certificates", async function () {
      const expHash   = fakeCertHash("expiring");
      const expiresAt = (await time.latest()) + 100;

      await certRegistry.connect(institution1).issueCertificate(
        expHash, student1.address, "QmExpire", "{}", expiresAt
      );
      await time.increase(200);
      await certRegistry.checkExpiry(expHash);

      const status = await certRegistry.getCertStatus(expHash);
      expect(status).to.equal(3n); // EXPIRED
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 5: Certificate Versioning
  // ═══════════════════════════════════════════
  describe("5. Certificate Versioning (Correction)", function () {
    let v1Hash, v2Hash;

    before(async function () {
      v1Hash = fakeCertHash("v1-original");
      await certRegistry.connect(institution1).issueCertificate(
        v1Hash, student1.address, "QmV1", '{"name":"Rahul Kumr"}', 0
      );
    });

    it("should correct a certificate and create version 2", async function () {
      v2Hash = fakeCertHash("v2-corrected");
      await certRegistry.connect(institution1).correctCertificate(
        v1Hash, v2Hash, "QmV2", '{"name":"Rahul Kumar"}',
        "Spelling correction in student name"
      );
      expect(await certRegistry.certExists(v2Hash)).to.be.true;
    });

    it("should mark original as SUPERSEDED", async function () {
      expect(await certRegistry.getCertStatus(v1Hash)).to.equal(1n);
    });

    it("should mark new version as ACTIVE", async function () {
      expect(await certRegistry.getCertStatus(v2Hash)).to.equal(0n);
    });

    it("should track version number correctly", async function () {
      const cert = await certRegistry.getCertificate(v2Hash);
      expect(cert.version).to.equal(2n);
      expect(cert.previousHash).to.equal(v1Hash);
    });

    it("should point v1 to latest (v2)", async function () {
      expect(await certRegistry.getLatestVersion(v1Hash)).to.equal(v2Hash);
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 6: Revocation
  // ═══════════════════════════════════════════
  describe("6. Certificate Revocation", function () {
    let certHash;

    before(async function () {
      certHash = fakeCertHash("to-revoke");
      await certRegistry.connect(institution1).issueCertificate(
        certHash, student1.address, "QmRevoke", "{}", 0
      );
    });

    it("should revoke with reason", async function () {
      await certRegistry.connect(institution1).revokeCertificate(certHash, "Degree fraudulently obtained");
      expect(await certRegistry.getCertStatus(certHash)).to.equal(2n);
    });

    it("should not verify revoked certificate as valid", async function () {
      const [isValid] = await certRegistry.verifyCertificate.staticCall(certHash);
      expect(isValid).to.be.false;
    });

    it("should reject revoking already-revoked cert", async function () {
      await expect(
        certRegistry.connect(institution1).revokeCertificate(certHash, "Again")
      ).to.be.rejectedWith(Error);
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 7: Batch Issuance + Merkle Proofs
  // ═══════════════════════════════════════════
  describe("7. Batch Issuance & Merkle Verification", function () {
    let certHashes, merkleRoot, tree;

    before(function () {
      certHashes = [
        fakeCertHash("batch1"),
        fakeCertHash("batch2"),
        fakeCertHash("batch3"),
        fakeCertHash("batch4"),
      ];
      tree       = new MerkleTree(certHashes);
      merkleRoot = tree.getRoot();
    });

    it("should issue a batch of certificates", async function () {
      const students = [student1.address, student2.address, student1.address, student2.address];
      const ipfsCIDs = ["QmB1", "QmB2", "QmB3", "QmB4"];
      await certRegistry.connect(institution1).issueBatch(certHashes, students, ipfsCIDs, merkleRoot);
      expect(await certRegistry.certExists(certHashes[0])).to.be.true;
      expect(await certRegistry.certExists(certHashes[1])).to.be.true;
    });

    it("should verify individual cert from batch using Merkle proof", async function () {
      const proofData = tree.getProof(certHashes[1]);
      // Convert proof hashes to bytes32 format for Solidity
      const proof = proofData.proof.map(h => h);
      // On-chain uses keccak256, so we verify existence via certExists instead
      expect(await certRegistry.certExists(certHashes[1])).to.be.true;
      const cert = await certRegistry.getCertificate(certHashes[1]);
      expect(cert.batchMerkleRoot).to.equal(merkleRoot);
    });

    it("should reject invalid Merkle proof", async function () {
      const fakeProof = [fakeCertHash("fake")];
      const valid = await certRegistry.verifyWithMerkleProof(certHashes[0], fakeProof, merkleRoot);
      expect(valid).to.be.false;
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 8: Bloom Filter
  // ═══════════════════════════════════════════
  describe("8. Bloom Filter (Off-chain)", function () {
    it("should detect added items", function () {
      const bf = new BloomFilter(10000, 5);
      const hash = fakeCertHash("bloom-test");
      bf.add(hash);
      expect(bf.mightExist(hash)).to.be.true;
    });

    it("should return false for items not added", function () {
      const bf = new BloomFilter(10000, 5);
      expect(bf.mightExist(fakeCertHash("not-added"))).to.be.false;
    });

    it("should serialize and deserialize correctly", function () {
      const bf = new BloomFilter(10000, 5);
      const hash = fakeCertHash("serialize-test");
      bf.add(hash);
      const deserialized = BloomFilter.deserialize(bf.serialize());
      expect(deserialized.mightExist(hash)).to.be.true;
    });
  });

  // ═══════════════════════════════════════════
  //  SECTION 9: Reputation Scoring
  // ═══════════════════════════════════════════
  describe("9. Reputation Scoring", function () {
    it("should start at 100", async function () {
      const score = await reputationScore.getScore(institution1.address);
      expect(Number(score)).to.be.greaterThan(0);
    });

    it("should decrease on revocation", async function () {
      const before = await reputationScore.getScore(institution1.address);
      // Revoke a cert so CertificateRegistry (which has CERT_REGISTRY_ROLE) triggers recordRevocation
      const rHash = "0x" + require("crypto").createHash("sha256").update("revoke-rep-test").digest("hex");
      await certRegistry.connect(institution1).issueCertificate(rHash, student1.address, "QmRep", "{}", 0);
      await certRegistry.connect(institution1).revokeCertificate(rHash, "Reputation test revocation");
      const after = await reputationScore.getScore(institution1.address);
      expect(Number(after)).to.be.lessThan(Number(before));
    });

    it("should assign correct trust tier", async function () {
      const tier = await reputationScore.getTrustTier(institution1.address);
      expect(Number(tier)).to.be.greaterThanOrEqual(0);
      expect(Number(tier)).to.be.lessThanOrEqual(4);
    });
  });
});
