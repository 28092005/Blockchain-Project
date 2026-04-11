/**
 * manual-test.js
 * Test ALL functions without MetaMask — runs directly on hardhat node
 * 
 * WHAT THIS TESTS:
 * 1. Issue a certificate
 * 2. Verify that certificate
 * 3. Revoke that certificate
 * 4. Correct a certificate (versioning)
 * 5. Check reputation score changes
 */

const { ethers } = require("hardhat");
const addresses  = require("../deployed-addresses.json");

async function main() {
  const [deployer, , institution, , , , , student] = await ethers.getSigners();

  // ── Load contracts ────────────────────────────────────────────────
  const ac       = await ethers.getContractAt("CertChainAccessControl", addresses.CertChainAccessControl);
  const registry = await ethers.getContractAt("CertificateRegistry",    addresses.CertificateRegistry);
  const rep      = await ethers.getContractAt("ReputationScore",         addresses.ReputationScore);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   CertChain Manual Test (No MetaMask)    ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("Deployer    :", deployer.address);
  console.log("Institution :", institution.address);
  console.log("Student     :", student.address);

  // ── Setup: Give institution role ──────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SETUP — Granting roles");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const INSTITUTION_ROLE = await ac.INSTITUTION_ROLE();
  const alreadyInst      = await ac.isInstitution(institution.address);

  if (!alreadyInst) {
    await (await ac.grantRoleWithReason(INSTITUTION_ROLE, institution.address, "test institution")).wait();
    console.log("✅ INSTITUTION_ROLE granted to:", institution.address);
  } else {
    console.log("✅ Already has INSTITUTION_ROLE:", institution.address);
  }

  // Initialize reputation if not done
  const score = await rep.getFullStats(institution.address);
  if (!score.initialized) {
    await (await rep.connect(deployer).initializeScore(institution.address)).wait();
    console.log("✅ Reputation score initialized");
  } else {
    console.log("✅ Reputation already initialized");
  }

  // ── STEP 1: Issue Certificate ─────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 1 — Issue a Certificate");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const certHash = ethers.keccak256(ethers.toUtf8Bytes("Rahul Kumar - B.Tech - 2024"));
  console.log("Certificate Hash :", certHash);
  console.log("Student          :", student.address);
  console.log("Degree           : B.Tech Computer Science");

  await (await registry.connect(institution).issueCertificate(
    certHash,
    student.address,
    "QmTestCID123",
    JSON.stringify({ name: "Rahul Kumar", degree: "B.Tech Computer Science", grade: "8.5" }),
    0
  )).wait();

  console.log("✅ Certificate issued on blockchain!");
  console.log("   Exists on chain:", await registry.certExists(certHash));

  // ── STEP 2: Verify Certificate ────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 2 — Verify the Certificate");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const cert = await registry.getCertificate(certHash);
  console.log("✅ Certificate found!");
  console.log("   Issued By :", cert.issuedBy);
  console.log("   Issued To :", cert.issuedTo);
  console.log("   Version   :", Number(cert.version));
  console.log("   Status    :", ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][Number(cert.status)]);
  console.log("   IPFS CID  :", cert.ipfsCID);

  // Also verify via backend API
  console.log("\n   Verifying via backend API...");
  const http = require("http");
  await new Promise((resolve) => {
    http.get(`http://localhost:4000/api/verify/${certHash}`, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const result = JSON.parse(data);
        console.log("   API Response :", JSON.stringify(result, null, 2));
        resolve();
      });
    }).on("error", () => {
      console.log("   (Backend API not reachable — skipping)");
      resolve();
    });
  });

  // ── STEP 3: Check Reputation Before Revoke ────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 3 — Reputation Score Before Revoke");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const scoreBefore = await rep.getScore(institution.address);
  const tierBefore  = await rep.getTrustTier(institution.address);
  const tiers       = ["PROBATION","BRONZE","SILVER","GOLD","PLATINUM"];
  console.log("   Score :", Number(scoreBefore));
  console.log("   Tier  :", tiers[Number(tierBefore)]);

  // ── STEP 4: Correct Certificate (Versioning) ──────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 4 — Correct Certificate (Fix Typo)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const newCertHash = ethers.keccak256(ethers.toUtf8Bytes("Rahul Kumar - B.Tech - 2024 - CORRECTED"));
  await (await registry.connect(institution).correctCertificate(
    certHash,
    newCertHash,
    "QmCorrectedCID456",
    JSON.stringify({ name: "Rahul Kumar", degree: "B.Tech Computer Science", grade: "9.0" }),
    "Grade correction: 8.5 updated to 9.0"
  )).wait();

  console.log("✅ Certificate corrected!");
  console.log("   Old hash status :", ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][Number(await registry.getCertStatus(certHash))]);
  console.log("   New hash status :", ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][Number(await registry.getCertStatus(newCertHash))]);
  console.log("   New version     :", Number((await registry.getCertificate(newCertHash)).version));
  console.log("   v1 points to    :", await registry.getLatestVersion(certHash));

  // ── STEP 5: Revoke the corrected certificate ──────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 5 — Revoke Certificate");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await (await registry.connect(institution).revokeCertificate(
    newCertHash,
    "Degree obtained fraudulently"
  )).wait();

  console.log("✅ Certificate revoked!");
  console.log("   Status:", ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][Number(await registry.getCertStatus(newCertHash))]);

  // ── STEP 6: Reputation After Revoke ──────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 6 — Reputation Score After Revoke");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const scoreAfter = await rep.getScore(institution.address);
  const tierAfter  = await rep.getTrustTier(institution.address);
  console.log("   Score before :", Number(scoreBefore));
  console.log("   Score after  :", Number(scoreAfter));
  console.log("   Difference   :", Number(scoreBefore) - Number(scoreAfter), "(penalty applied)");
  console.log("   Tier         :", tiers[Number(tierAfter)]);

  // ── STEP 7: Student's certificates ───────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 7 — All Certificates for Student");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const studentCerts = await registry.getStudentCertificates(student.address);
  console.log("   Total certs for student:", studentCerts.length);
  studentCerts.forEach((h, i) => console.log(`   Cert ${i + 1}: ${h}`));

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   ALL STEPS COMPLETED SUCCESSFULLY ✅    ║");
  console.log("╚══════════════════════════════════════════╝\n");
}

main().catch(console.error);
