/**
 * grant-role.js
 * Grant INSTITUTION_ROLE to a wallet address so it can issue certificates.
 *
 * Usage:
 *   npx hardhat run scripts/grant-role.js --network localhost
 *
 * Set TARGET_ADDRESS below to your MetaMask wallet address.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ── SET YOUR METAMASK WALLET ADDRESS HERE ─────────────────────────────
const TARGET_ADDRESS = process.env.GRANT_TO || "YOUR_METAMASK_ADDRESS_HERE";
// ─────────────────────────────────────────────────────────────────────

async function main() {
  if (TARGET_ADDRESS === "YOUR_METAMASK_ADDRESS_HERE") {
    console.error("❌ Set TARGET_ADDRESS in the script or pass GRANT_TO env var");
    console.error("   Example: GRANT_TO=0xYourAddress npx hardhat run scripts/grant-role.js --network localhost");
    process.exit(1);
  }

  const addressesPath = path.join(__dirname, "../deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("❌ deployed-addresses.json not found. Run deploy first.");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath));
  const [deployer] = await ethers.getSigners();

  console.log(`\nDeployer (superAdmin): ${deployer.address}`);
  console.log(`Granting INSTITUTION_ROLE to: ${TARGET_ADDRESS}\n`);

  const AccessControlABI = [
    "function INSTITUTION_ROLE() external view returns (bytes32)",
    "function SUPER_ADMIN_ROLE() external view returns (bytes32)",
    "function VALIDATOR_ROLE() external view returns (bytes32)",
    "function grantRoleWithReason(bytes32 role, address account, string reason) external",
    "function hasRole(bytes32 role, address account) external view returns (bool)",
    "function isInstitution(address addr) external view returns (bool)",
  ];

  const ReputationABI = [
    "function initializeScore(address institution) external",
    "function hasScore(address institution) external view returns (bool)",
  ];

  const ac = new ethers.Contract(addresses.CertChainAccessControl, AccessControlABI, deployer);
  const rep = new ethers.Contract(addresses.ReputationScore, ReputationABI, deployer);

  const INSTITUTION_ROLE = await ac.INSTITUTION_ROLE();
  const SUPER_ADMIN_ROLE = await ac.SUPER_ADMIN_ROLE();
  const VALIDATOR_ROLE   = await ac.VALIDATOR_ROLE();

  // 1. Grant SUPER_ADMIN_ROLE to InstitutionValidator contract (if not already)
  const ivHasAdmin = await ac.hasRole(SUPER_ADMIN_ROLE, addresses.InstitutionValidator);
  if (!ivHasAdmin) {
    console.log("Granting SUPER_ADMIN_ROLE to InstitutionValidator contract...");
    const tx = await ac.grantRoleWithReason(SUPER_ADMIN_ROLE, addresses.InstitutionValidator, "Allow InstitutionValidator to grant roles");
    await tx.wait();
    console.log("  ✅ Done");
  }

  // 2. Grant SUPER_ADMIN_ROLE to CertificateRegistry contract (if not already)
  const crHasAdmin = await ac.hasRole(SUPER_ADMIN_ROLE, addresses.CertificateRegistry);
  if (!crHasAdmin) {
    console.log("Granting SUPER_ADMIN_ROLE to CertificateRegistry contract...");
    const tx = await ac.grantRoleWithReason(SUPER_ADMIN_ROLE, addresses.CertificateRegistry, "Allow CertRegistry to call reputation hooks");
    await tx.wait();
    console.log("  ✅ Done");
  }

  // 3. Grant VALIDATOR_ROLE to deployer (if not already)
  const deployerIsValidator = await ac.hasRole(VALIDATOR_ROLE, deployer.address);
  if (!deployerIsValidator) {
    console.log("Granting VALIDATOR_ROLE to deployer...");
    const tx = await ac.grantRoleWithReason(VALIDATOR_ROLE, deployer.address, "Deployer as initial validator");
    await tx.wait();
    console.log("  ✅ Done");
  }

  // 4. Grant INSTITUTION_ROLE to target address
  const alreadyInst = await ac.isInstitution(TARGET_ADDRESS);
  if (alreadyInst) {
    console.log(`✅ ${TARGET_ADDRESS} already has INSTITUTION_ROLE`);
  } else {
    console.log(`Granting INSTITUTION_ROLE to ${TARGET_ADDRESS}...`);
    const tx = await ac.grantRoleWithReason(INSTITUTION_ROLE, TARGET_ADDRESS, "Approved institution via grant-role script");
    await tx.wait();
    console.log("  ✅ INSTITUTION_ROLE granted!");
  }

  // 5. Initialize reputation score for target address (if not already)
  const hasScore = await rep.hasScore(TARGET_ADDRESS);
  if (!hasScore) {
    console.log(`Initializing reputation score for ${TARGET_ADDRESS}...`);
    try {
      const tx = await rep.initializeScore(TARGET_ADDRESS);
      await tx.wait();
      console.log("  ✅ Reputation score initialized (starts at 100)");
    } catch (e) {
      console.log("  ⚠️  Could not initialize score (may need SUPER_ADMIN_ROLE on ReputationScore):", e.message);
    }
  } else {
    console.log(`✅ Reputation score already initialized`);
  }

  console.log(`\n🎉 Done! ${TARGET_ADDRESS} can now issue certificates.\n`);
  console.log("Next: Connect this wallet in MetaMask and go to Institution Panel.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
