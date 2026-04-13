const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const addresses = JSON.parse(fs.readFileSync("deployed-addresses.json"));
  const accessControlAddress = addresses.CertChainAccessControl;
  const reputationScAddress = addresses.ReputationScore;

  const accessControl = await ethers.getContractAt("CertChainAccessControl", accessControlAddress);
  const reputation = await ethers.getContractAt("ReputationScore", reputationScAddress);

  const INSTITUTION_ROLE = await accessControl.INSTITUTION_ROLE();
  const userAddress = "0xdfcf12e7ebf193f0fea24f3a5700a30188a3bda1";
  
  console.log(`Granting INSTITUTION_ROLE to ${userAddress}...`);
  // We use grantRoleWithReason since the contract likely requires it for the audit trail
  await accessControl.grantRoleWithReason(INSTITUTION_ROLE, userAddress, "Authorized user address for testing");
  console.log("Role granted successfully!");

  console.log(`Initializing Reputation for ${userAddress}...`);
  await reputation.initializeScore(userAddress);
  console.log("Reputation initialized successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
