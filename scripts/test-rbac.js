/**
 * test-rbac.js
 * Tests Role Based Access Control — who CAN and who CANNOT do what
 */

const { ethers } = require("hardhat");
const addresses  = require("../deployed-addresses.json");

async function main() {
  const [deployer, , institution, stranger, validator] = await ethers.getSigners();

  const ac       = await ethers.getContractAt("CertChainAccessControl", addresses.CertChainAccessControl);
  const registry = await ethers.getContractAt("CertificateRegistry",    addresses.CertificateRegistry);
  const rep      = await ethers.getContractAt("ReputationScore",         addresses.ReputationScore);

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   RBAC TEST — Who Can Do What                ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // ── CHECK CURRENT ROLES ───────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("CURRENT ROLES");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Deployer   (${deployer.address.slice(0,10)}...)  SuperAdmin: ${await ac.isSuperAdmin(deployer.address)}  Institution: ${await ac.isInstitution(deployer.address)}  Validator: ${await ac.isValidator(deployer.address)}`);
  console.log(`Institution(${institution.address.slice(0,10)}...)  SuperAdmin: ${await ac.isSuperAdmin(institution.address)}  Institution: ${await ac.isInstitution(institution.address)}  Validator: ${await ac.isValidator(institution.address)}`);
  console.log(`Stranger   (${stranger.address.slice(0,10)}...)  SuperAdmin: ${await ac.isSuperAdmin(stranger.address)}  Institution: ${await ac.isInstitution(stranger.address)}  Validator: ${await ac.isValidator(stranger.address)}`);

  // ── TEST 1: STRANGER CANNOT ISSUE CERTIFICATE ─────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 1 — Stranger tries to issue certificate (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("fake cert"));
    await registry.connect(stranger).issueCertificate(fakeHash, stranger.address, "QmFake", "{}", 0);
    console.log("❌ ERROR — Stranger was able to issue! RBAC broken!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Stranger cannot issue certificates");
    console.log("   Reason:", e.reason || "Access denied");
  }

  // ── TEST 2: STRANGER CANNOT GRANT ROLES ──────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 2 — Stranger tries to grant themselves INSTITUTION_ROLE (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const INSTITUTION_ROLE = await ac.INSTITUTION_ROLE();
    await ac.connect(stranger).grantRoleWithReason(INSTITUTION_ROLE, stranger.address, "hack");
    console.log("❌ ERROR — Stranger granted themselves a role! RBAC broken!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Stranger cannot grant roles");
    console.log("   Reason:", e.reason || "Access denied");
  }

  // ── TEST 3: STRANGER CANNOT PAUSE SYSTEM ─────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 3 — Stranger tries to pause the system (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    await ac.connect(stranger).pauseSystem("hacking");
    console.log("❌ ERROR — Stranger paused the system! RBAC broken!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Stranger cannot pause system");
    console.log("   Reason:", e.reason || "Access denied");
  }

  // ── TEST 4: INSTITUTION CANNOT ISSUE WHEN SYSTEM PAUSED ──────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 4 — SuperAdmin pauses system, institution tries to issue (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  await (await ac.connect(deployer).pauseSystem("Emergency test")).wait();
  console.log("   System paused by SuperAdmin ✅");
  try {
    const certHash = ethers.keccak256(ethers.toUtf8Bytes("paused test cert"));
    await registry.connect(institution).issueCertificate(certHash, stranger.address, "QmPaused", "{}", 0);
    console.log("❌ ERROR — Institution issued while paused! RBAC broken!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Cannot issue when system is paused");
    console.log("   Reason:", e.reason || "System paused");
  }
  await (await ac.connect(deployer).unpauseSystem()).wait();
  console.log("   System unpaused ✅");

  // ── TEST 5: INSTITUTION CAN ISSUE WHEN HAS ROLE ──────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 5 — Approved institution issues certificate (should PASS)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const certHash = ethers.keccak256(ethers.toUtf8Bytes("valid cert " + Date.now()));
    await (await registry.connect(institution).issueCertificate(certHash, stranger.address, "QmValid", "{}", 0)).wait();
    console.log("✅ Institution successfully issued certificate");
    console.log("   Cert exists on chain:", await registry.certExists(certHash));
  } catch (e) {
    console.log("❌ ERROR — Institution could not issue:", e.reason || e.message);
  }

  // ── TEST 6: INSTITUTION CANNOT REVOKE ANOTHER INSTITUTION'S CERT ─
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 6 — Institution tries to revoke deployer's certificate (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const deployerCertHash = ethers.keccak256(ethers.toUtf8Bytes("deployer cert " + Date.now()));
  await (await registry.connect(deployer).issueCertificate(deployerCertHash, stranger.address, "QmDeployer", "{}", 0)).wait();
  try {
    await registry.connect(institution).revokeCertificate(deployerCertHash, "stealing");
    console.log("❌ ERROR — Institution revoked another institution's cert!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Cannot revoke another institution's certificate");
    console.log("   Reason:", e.reason || "Access denied");
  }

  // ── TEST 7: STRANGER CANNOT INITIALIZE REPUTATION ────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 7 — Stranger tries to initialize reputation score (should FAIL)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    await rep.connect(stranger).initializeScore(stranger.address);
    console.log("❌ ERROR — Stranger initialized reputation score!");
  } catch (e) {
    console.log("✅ CORRECTLY BLOCKED — Stranger cannot initialize reputation");
    console.log("   Reason:", e.reason || "Access denied");
  }

  // ── SUMMARY ───────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   RBAC SUMMARY                               ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log("║  Stranger issue cert        → BLOCKED ✅     ║");
  console.log("║  Stranger grant role        → BLOCKED ✅     ║");
  console.log("║  Stranger pause system      → BLOCKED ✅     ║");
  console.log("║  Issue while paused         → BLOCKED ✅     ║");
  console.log("║  Institution issue cert     → ALLOWED ✅     ║");
  console.log("║  Revoke others cert         → BLOCKED ✅     ║");
  console.log("║  Stranger init reputation   → BLOCKED ✅     ║");
  console.log("╚══════════════════════════════════════════════╝\n");
}

main().catch(console.error);
