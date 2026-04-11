const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const addresses = JSON.parse(fs.readFileSync("./deployed-addresses.json"));
  const [deployer] = await ethers.getSigners();

  const ac = await ethers.getContractAt("CertChainAccessControl", addresses.CertChainAccessControl);
  const cr = await ethers.getContractAt("CertificateRegistry", addresses.CertificateRegistry);

  const isInst = await ac.isInstitution(deployer.address);
  console.log("Is institution:", isInst);

  if (!isInst) { console.log("❌ No INSTITUTION_ROLE"); return; }

  const certHash = ethers.keccak256(ethers.toUtf8Bytes("test-cert-" + Date.now()));
  const tx = await cr.issueCertificate(certHash, deployer.address, "QmTestCID", "{}", 0);
  await tx.wait();
  console.log("✅ Certificate issued! Hash:", certHash);
  console.log("✅ TX:", tx.hash);

  const exists = await cr.certExists(certHash);
  console.log("✅ Cert exists on chain:", exists);
}

main().catch(console.error);
