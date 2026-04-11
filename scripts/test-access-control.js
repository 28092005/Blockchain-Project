const { ethers } = require("hardhat");
const addresses  = require("../deployed-addresses.json");

async function main() {
  const [deployer, account1] = await ethers.getSigners();

  const ac = await ethers.getContractAt("CertChainAccessControl", addresses.CertChainAccessControl);

  console.log("\n==============================");
  console.log(" ROLE BASED ACCESS CONTROL");
  console.log("==============================\n");

  console.log("Contract address :", addresses.CertChainAccessControl);
  console.log("Deployer address :", deployer.address);
  console.log("Random address   :", account1.address);

  console.log("\n--- SUPER ADMIN CHECK ---");
  const deployerIsAdmin = await ac.isSuperAdmin(deployer.address);
  const randomIsAdmin   = await ac.isSuperAdmin(account1.address);
  console.log("Is deployer a super admin?", deployerIsAdmin);   // true
  console.log("Is random addr super admin?", randomIsAdmin);    // false

  console.log("\n--- VALIDATOR CHECK ---");
  const deployerIsValidator = await ac.isValidator(deployer.address);
  console.log("Is deployer a validator?", deployerIsValidator); // true (granted in deploy.js)

  console.log("\n--- INSTITUTION CHECK ---");
  const deployerIsInstitution = await ac.isInstitution(deployer.address);
  console.log("Is deployer an institution?", deployerIsInstitution); // true (granted in deploy.js)

  console.log("\n--- SYSTEM PAUSE STATUS ---");
  const isPaused = await ac.paused();
  console.log("Is system paused?", isPaused); // false

  console.log("\n--- PAUSE THE SYSTEM ---");
  await (await ac.pauseSystem("Testing pause")).wait();
  console.log("System paused!");
  console.log("Is system paused now?", await ac.paused()); // true

  console.log("\n--- UNPAUSE THE SYSTEM ---");
  await (await ac.unpauseSystem()).wait();
  console.log("System unpaused!");
  console.log("Is system paused now?", await ac.paused()); // false

  console.log("\n--- UNAUTHORIZED ROLE GRANT (should FAIL) ---");
  try {
    const INSTITUTION_ROLE = await ac.INSTITUTION_ROLE();
    await ac.connect(account1).grantRoleWithReason(INSTITUTION_ROLE, account1.address, "hack attempt");
    console.log("ERROR: This should have failed!");
  } catch (e) {
    console.log("Correctly REJECTED unauthorized role grant ✅");
  }

  console.log("\n==============================");
  console.log(" ALL ACCESS CONTROL TESTS DONE");
  console.log("==============================\n");
}

main().catch(console.error);
