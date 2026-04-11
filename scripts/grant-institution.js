const { ethers } = require("hardhat");
const fs = require("fs");

const TARGET = "0xf39a8ba960dcf32cd6af71dd5fea1b0835ac2266";

async function main() {
  const addresses = JSON.parse(fs.readFileSync("./deployed-addresses.json"));
  const [deployer] = await ethers.getSigners();

  const ac  = await ethers.getContractAt("CertChainAccessControl", addresses.CertChainAccessControl);
  const rep = await ethers.getContractAt("ReputationScore", addresses.ReputationScore);

  const INSTITUTION_ROLE = await ac.INSTITUTION_ROLE();

  console.log("Granting INSTITUTION_ROLE to:", TARGET);
  await (await ac.grantRoleWithReason(INSTITUTION_ROLE, TARGET, "Approved institution")).wait();
  console.log("✅ INSTITUTION_ROLE granted");

  const hasScore = (await rep.scores(TARGET)).initialized;
  if (!hasScore) {
    await (await rep.initializeScore(TARGET)).wait();
    console.log("✅ Reputation score initialized");
  }
}

main().catch(console.error);
