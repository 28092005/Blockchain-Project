/**
 * deploy.js — Deploy all CertChain contracts in the correct order
 *
 * ORDER MATTERS:
 * 1. CertChainAccessControl  (no dependencies)
 * 2. InstitutionValidator    (needs AccessControl)
 * 3. ReputationScore         (needs AccessControl)
 * 4. CertificateRegistry     (needs AccessControl + ReputationScore)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   CertChain Deployment Script        ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`Deployer:  ${deployer.address}`);
  console.log(`Network:   ${(await ethers.provider.getNetwork()).name}\n`);

  // ── 1. Deploy Access Control ──────────────────────────────────────
  console.log("1️⃣  Deploying CertChainAccessControl...");
  const accessControl = await (await ethers.getContractFactory("CertChainAccessControl"))
    .deploy(deployer.address);
  await accessControl.waitForDeployment();
  const acAddr = await accessControl.getAddress();
  console.log(`   ✅ CertChainAccessControl: ${acAddr}`);

  // ── 2. Deploy Institution Validator ───────────────────────────────
  console.log("2️⃣  Deploying InstitutionValidator...");
  const institutionValidator = await (await ethers.getContractFactory("InstitutionValidator"))
    .deploy(acAddr);
  await institutionValidator.waitForDeployment();
  const ivAddr = await institutionValidator.getAddress();
  console.log(`   ✅ InstitutionValidator: ${ivAddr}`);

  // ── 3. Deploy Reputation Score ────────────────────────────────────
  console.log("3️⃣  Deploying ReputationScore...");
  const reputationScore = await (await ethers.getContractFactory("ReputationScore"))
    .deploy(acAddr);
  await reputationScore.waitForDeployment();
  const rsAddr = await reputationScore.getAddress();
  console.log(`   ✅ ReputationScore: ${rsAddr}`);

  // ── 4. Deploy Certificate Registry ───────────────────────────────
  console.log("4️⃣  Deploying CertificateRegistry...");
  const certRegistry = await (await ethers.getContractFactory("CertificateRegistry"))
    .deploy(acAddr, rsAddr);
  await certRegistry.waitForDeployment();
  const crAddr = await certRegistry.getAddress();
  console.log(`   ✅ CertificateRegistry: ${crAddr}`);

  // ── 5. Setup Roles ────────────────────────────────────────────────
  console.log("\n5️⃣  Setting up roles...");

  const SUPER_ADMIN_ROLE    = await accessControl.SUPER_ADMIN_ROLE();
  const INSTITUTION_ROLE    = await accessControl.INSTITUTION_ROLE();
  const VALIDATOR_ROLE      = await accessControl.VALIDATOR_ROLE();
  const CERT_REGISTRY_ROLE  = await accessControl.CERT_REGISTRY_ROLE();

  // Verify deployer has DEFAULT_ADMIN_ROLE before proceeding
  const DEFAULT_ADMIN_ROLE = await accessControl.DEFAULT_ADMIN_ROLE();
  const isAdmin = await accessControl.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  if (!isAdmin) throw new Error("Deployer does not have DEFAULT_ADMIN_ROLE — aborting.");

  // Grant SUPER_ADMIN_ROLE to InstitutionValidator (needs to call grantRoleWithReason for INSTITUTION_ROLE)
  await (await accessControl.grantRoleWithReason(
    SUPER_ADMIN_ROLE, ivAddr, "InstitutionValidator needs to grant INSTITUTION_ROLE"
  )).wait();
  console.log(`   ✅ SUPER_ADMIN_ROLE  → InstitutionValidator`);

  // Grant CERT_REGISTRY_ROLE to CertificateRegistry (scoped access to ReputationScore hooks only)
  await (await accessControl.grantRoleWithReason(
    CERT_REGISTRY_ROLE, crAddr, "CertificateRegistry needs reputation hooks"
  )).wait();
  console.log(`   ✅ CERT_REGISTRY_ROLE → CertificateRegistry`);

  // Grant VALIDATOR_ROLE to deployer
  await (await accessControl.grantRoleWithReason(
    VALIDATOR_ROLE, deployer.address, "Initial validator"
  )).wait();
  console.log(`   ✅ VALIDATOR_ROLE    → deployer`);

  // Grant INSTITUTION_ROLE to deployer
  await (await accessControl.grantRoleWithReason(
    INSTITUTION_ROLE, deployer.address, "Deployer as initial institution"
  )).wait();
  console.log(`   ✅ INSTITUTION_ROLE  → deployer`);

  // Initialize reputation score for deployer (deployer has SUPER_ADMIN_ROLE — satisfies initializeScore check)
  await (await reputationScore.initializeScore(deployer.address)).wait();
  console.log(`   ✅ Reputation score initialized for deployer`);

  // ── 6. Save Deployed Addresses ────────────────────────────────────
  const addresses = {
    CertChainAccessControl: acAddr,
    InstitutionValidator:   ivAddr,
    ReputationScore:        rsAddr,
    CertificateRegistry:    crAddr,
    deployer:               deployer.address,
    deployedAt:             new Date().toISOString(),
    network:                (await ethers.provider.getNetwork()).name,
  };

  const json = JSON.stringify(addresses, null, 2);
  const targets = [
    path.join(__dirname, "../deployed-addresses.json"),
    path.join(__dirname, "../frontend/src/deployed-addresses.json"),
    path.join(__dirname, "../backend/deployed-addresses.json"),
  ];
  targets.forEach(p => fs.writeFileSync(p, json));
  console.log(`\n📄 deployed-addresses.json written to root, frontend/src, and backend`);

  // ── 7. Summary ────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   DEPLOYMENT SUMMARY                                 ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  AccessControl      : ${acAddr} ║`);
  console.log(`║  InstitutionValidator: ${ivAddr} ║`);
  console.log(`║  ReputationScore    : ${rsAddr} ║`);
  console.log(`║  CertificateRegistry: ${crAddr} ║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log("🎉 All contracts deployed successfully!\n");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
