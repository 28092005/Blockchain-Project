/**
 * BloomFilter.js
 * O(1) probabilistic certificate existence check
 *
 * WHY: Checking if a cert exists on-chain costs gas.
 * The Bloom Filter sits off-chain and instantly says
 * "definitely NOT exists" or "probably exists" before
 * we hit the blockchain.
 *
 * PROPERTIES:
 * - Zero false negatives (if it says NO, cert 100% doesn't exist)
 * - Small false positive rate (~1% with our settings)
 * - Extremely fast: O(k) where k = number of hash functions
 * - Very memory efficient
 */

const crypto = require("crypto");

class BloomFilter {
  /**
   * @param {number} size       - Bit array size (larger = fewer false positives)
   * @param {number} hashCount  - Number of hash functions (3-7 recommended)
   */
  constructor(size = 100000, hashCount = 5) {
    this.size      = size;
    this.hashCount = hashCount;
    this.bitArray  = new Uint8Array(Math.ceil(size / 8)); // compact bit storage
    this.count     = 0; // number of items added
  }

  // ─────────────────────────────────────────────
  //  Core Operations
  // ─────────────────────────────────────────────

  /**
   * Add a certificate hash to the filter
   * @param {string} certHash - hex string e.g. "0xabc123..."
   */
  add(certHash) {
    const positions = this._getPositions(certHash);
    for (const pos of positions) {
      this._setBit(pos);
    }
    this.count++;
  }

  /**
   * Check if a certificate MIGHT exist
   * @returns {boolean} false = definitely NOT in set
   *                    true  = probably in set (check blockchain to confirm)
   */
  mightExist(certHash) {
    const positions = this._getPositions(certHash);
    for (const pos of positions) {
      if (!this._getBit(pos)) return false; // Definitely not present
    }
    return true; // Probably present
  }

  /**
   * Bulk add certificates (e.g., on startup from DB)
   * @param {string[]} certHashes
   */
  addBulk(certHashes) {
    for (const hash of certHashes) {
      this.add(hash);
    }
  }

  // ─────────────────────────────────────────────
  //  Serialization (persist to BoltDB / file)
  // ─────────────────────────────────────────────

  serialize() {
    return {
      size:      this.size,
      hashCount: this.hashCount,
      bitArray:  Buffer.from(this.bitArray).toString("base64"),
      count:     this.count,
      createdAt: new Date().toISOString(),
    };
  }

  static deserialize(data) {
    const bf       = new BloomFilter(data.size, data.hashCount);
    bf.bitArray    = new Uint8Array(Buffer.from(data.bitArray, "base64"));
    bf.count       = data.count;
    return bf;
  }

  // ─────────────────────────────────────────────
  //  Stats
  // ─────────────────────────────────────────────

  /**
   * Estimated false positive probability
   * Formula: (1 - e^(-k*n/m))^k
   */
  falsePositiveRate() {
    const k = this.hashCount;
    const n = this.count;
    const m = this.size;
    return Math.pow(1 - Math.exp((-k * n) / m), k);
  }

  stats() {
    return {
      itemCount:         this.count,
      bitArraySize:      this.size,
      hashFunctions:     this.hashCount,
      falsePositiveRate: (this.falsePositiveRate() * 100).toFixed(4) + "%",
      memoryUsageKB:     (this.bitArray.length / 1024).toFixed(2) + " KB",
    };
  }

  // ─────────────────────────────────────────────
  //  Internal Hash Functions
  // ─────────────────────────────────────────────

  /**
   * Generate k bit positions for a given certHash
   * Uses double-hashing technique: h(i) = h1 + i*h2
   */
  _getPositions(certHash) {
    const normalized = certHash.toLowerCase().replace("0x", "");
    const h1 = this._hash(normalized, "seed1");
    const h2 = this._hash(normalized, "seed2");

    const positions = [];
    for (let i = 0; i < this.hashCount; i++) {
      positions.push(((h1 + i * h2) >>> 0) % this.size);
    }
    return positions;
  }

  _hash(data, seed) {
    const hash = crypto
      .createHash("sha256")
      .update(seed + data)
      .digest("hex");
    // Take first 8 chars of hash and convert to integer
    return parseInt(hash.substring(0, 8), 16);
  }

  _setBit(position) {
    const byteIndex = Math.floor(position / 8);
    const bitIndex  = position % 8;
    this.bitArray[byteIndex] |= (1 << bitIndex);
  }

  _getBit(position) {
    const byteIndex = Math.floor(position / 8);
    const bitIndex  = position % 8;
    return (this.bitArray[byteIndex] & (1 << bitIndex)) !== 0;
  }
}

module.exports = BloomFilter;
