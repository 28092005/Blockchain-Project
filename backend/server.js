require("dotenv").config();
const crypto     = require("crypto");
const path       = require("path");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const { ethers } = require("ethers");
const multer     = require("multer");

const BloomFilter = require("./utils/BloomFilter");
const MerkleTree  = require("./utils/MerkleTree");
const addresses   = require("./deployed-addresses.json");

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",")
  : ["http://localhost:3000"];
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.some(o => origin.startsWith(o))) }));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const issueLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 50 });

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
let bloomFilter = new BloomFilter(500000, 7);

// ── ABI fragments ──────────────────────────────────────────────────
const CERT_REGISTRY_ABI = [
  "function certExists(bytes32) external view returns (bool)",
  "function verifyCertificate(bytes32) external returns (bool, tuple(bytes32,address,address,uint256,uint256,uint8,uint8,bytes32,bytes32,string,string,string,bytes32))",
  "function verifyWithMerkleProof(bytes32, bytes32[], bytes32) external view returns (bool)",
  "event CertificateIssued(bytes32 indexed certHash, address indexed issuedBy, address indexed issuedTo, string ipfsCID, uint8 version, uint256 timestamp)",
];

const REPUTATION_ABI = [
  "function getScore(address) external view returns (uint256)",
  "function getTrustTier(address) external view returns (uint8)",
  "function getFullStats(address) external view returns (tuple(uint256,uint256,uint256,uint256,uint256,uint256,bool))",
];

const TIERS = ["PROBATION", "BRONZE", "SILVER", "GOLD", "PLATINUM"];

const certRegistry  = new ethers.Contract(addresses.CertificateRegistry,    CERT_REGISTRY_ABI, provider);
const reputationSC  = new ethers.Contract(addresses.ReputationScore,         REPUTATION_ABI,    provider);

function hashCertificate(buffer) {
  return "0x" + crypto.createHash("sha256").update(buffer).digest("hex");
}

async function syncBloomFilter() {
  try {
    const filter = certRegistry.filters.CertificateIssued();
    const events = await certRegistry.queryFilter(filter, 0, "latest");
    events.forEach(e => bloomFilter.add(e.args.certHash));
    console.log(`Bloom filter synced: ${events.length} certificates loaded`);

    // Watch for new certificates in real-time
    certRegistry.on("CertificateIssued", (certHash) => {
      bloomFilter.add(certHash);
      console.log(`Bloom filter updated: added ${certHash}`);
    });
  } catch (e) {
    console.log("Bloom filter sync skipped:", e.message);
  }
}

// ── Health ─────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Verify by file upload ──────────────────────────────────────────
app.post("/api/verify", verifyLimiter, upload.single("certificate"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No certificate file provided" });
    const certHash = hashCertificate(req.file.buffer);

    if (!bloomFilter.mightExist(certHash)) {
      return res.json({ valid: false, certHash, message: "Not found in bloom filter" });
    }

    const exists = await certRegistry.certExists(certHash);
    if (!exists) return res.json({ valid: false, certHash, message: "Not found on-chain" });

    const [isValid, cert] = await certRegistry.verifyCertificate.staticCall(certHash);
    res.json({ valid: isValid, certHash, status: ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][cert[5]] });
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── Verify by hash ─────────────────────────────────────────────────
app.get("/api/verify/:certHash", verifyLimiter, async (req, res) => {
  const { certHash } = req.params;
  if (!certHash.match(/^0x[0-9a-fA-F]{64}$/)) {
    return res.status(400).json({ error: "Invalid certificate hash format" });
  }
  try {
    const exists = await certRegistry.certExists(certHash);
    if (!exists) return res.json({ valid: false, certHash });

    const [isValid, cert] = await certRegistry.verifyCertificate.staticCall(certHash);
    res.json({
      valid:    isValid,
      certHash,
      status:   ["ACTIVE","SUPERSEDED","REVOKED","EXPIRED"][cert[5]],
      issuedBy: cert[1],
      issuedTo: cert[2],
      issuedAt: new Date(Number(cert[3]) * 1000).toISOString(),
      version:  Number(cert[6]),
    });
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── Institution reputation ─────────────────────────────────────────
app.get("/api/institution/:address", async (req, res) => {
  try {
    const addr = ethers.getAddress(req.params.address);
    const stats = await reputationSC.getFullStats(addr);
    if (!stats[6]) return res.status(404).json({ error: "Institution not found" });

    const tierIndex = await reputationSC.getTrustTier(addr);
    res.json({
      score:              Number(stats[0]),
      totalIssued:        Number(stats[1]),
      totalRevoked:       Number(stats[2]),
      totalDisputed:      Number(stats[3]),
      totalVerifications: Number(stats[4]),
      lastUpdated:        new Date(Number(stats[5]) * 1000).toISOString(),
      tier:               TIERS[Number(tierIndex)],
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Merkle verify ──────────────────────────────────────────────────
app.post("/api/merkle/verify", issueLimiter, (req, res) => {
  try {
    const { certHash, proof, merkleRoot } = req.body;
    if (!certHash || !Array.isArray(proof) || !merkleRoot) {
      return res.status(400).json({ error: "certHash, proof array, and merkleRoot required" });
    }
    const valid = MerkleTree.verify(certHash, proof, merkleRoot);
    res.json({ certHash, valid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Merkle generate ────────────────────────────────────────────────
app.post("/api/merkle/generate", issueLimiter, (req, res) => {
  try {
    const { certHashes } = req.body;
    if (!Array.isArray(certHashes) || certHashes.length === 0 || certHashes.length > 100) {
      return res.status(400).json({ error: "certHashes must be an array of 1-100 items" });
    }
    const tree   = new MerkleTree(certHashes);
    const root   = tree.getRoot();
    const proofs = {};
    for (const hash of certHashes) proofs[hash] = tree.getProof(hash);
    res.json({ root, proofs, leafCount: certHashes.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── REMOVED CENTRALIZED ENDPOINTS ──────────────────────────────────────
// The endpoints /api/issue-file, /api/issue, /api/revoke, and /api/correct 
// have been securely migrated to the decentralized frontend.
// Institutions must now sign transactions directly using their MetaMask wallet.
// This improves security, guarantees non-repudiation, and removes gas burdens from the backend.

// ── Bloom stats ────────────────────────────────────────────────────
app.get("/api/bloom/stats", (req, res) => {
  res.json(bloomFilter.stats());
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`CertChain Backend running on port ${PORT}`);
  await syncBloomFilter();
});

module.exports = app;
