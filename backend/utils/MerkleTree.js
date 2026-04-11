/**
 * MerkleTree.js
 * Batch certificate verification using Merkle Trees
 *
 * WHY: Instead of verifying 1000 certificates with 1000 on-chain
 * calls, we store ONE Merkle root on-chain and verify any
 * individual certificate with just a short "proof path".
 *
 * HOW IT WORKS:
 *
 *         ROOT
 *        /    \
 *      H(AB)  H(CD)
 *      /  \   /  \
 *     A    B C    D
 *
 * To prove C is in the batch:
 * - Provide: [D, H(AB)]
 * - Verifier recomputes: H(H(CD), H(AB)) and checks == ROOT
 *
 * This is the same technique used by Bitcoin for transaction inclusion!
 */

const crypto = require("crypto");

class MerkleTree {
  /**
   * @param {string[]} leaves - Array of certificate hashes (hex strings)
   */
  constructor(leaves = []) {
    this.leaves = leaves.map(l => this._normalize(l));
    this.tree   = [];
    if (leaves.length > 0) {
      this._build();
    }
  }

  // ─────────────────────────────────────────────
  //  Build the Tree
  // ─────────────────────────────────────────────

  _build() {
    // Layer 0: the leaf hashes themselves
    let layer = [...this.leaves];
    this.tree = [layer];

    while (layer.length > 1) {
      layer = this._buildLayer(layer);
      this.tree.push(layer);
    }
  }

  _buildLayer(nodes) {
    const result = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left  = nodes[i];
      const right = i + 1 < nodes.length ? nodes[i + 1] : left; // duplicate last if odd
      result.push(this._hashPair(left, right));
    }
    return result;
  }

  // ─────────────────────────────────────────────
  //  Get Root
  // ─────────────────────────────────────────────

  /**
   * @returns {string} The Merkle root hash (store this on-chain)
   */
  getRoot() {
    if (this.tree.length === 0) return null;
    const topLayer = this.tree[this.tree.length - 1];
    return topLayer[0];
  }

  // ─────────────────────────────────────────────
  //  Generate Proof
  // ─────────────────────────────────────────────

  /**
   * Generate proof for a specific certificate
   * @param {string} certHash - The certificate to generate proof for
   * @returns {object} { proof: string[], root: string, index: number }
   */
  getProof(certHash) {
    const normalized = this._normalize(certHash);
    const leafIndex  = this.leaves.indexOf(normalized);

    if (leafIndex === -1) {
      return { valid: false, message: "Certificate not in this batch" };
    }

    const proof = [];
    let   index = leafIndex;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const layer     = this.tree[level];
      const isLeft    = index % 2 === 0;
      const siblingIdx = isLeft ? index + 1 : index - 1;

      if (siblingIdx < layer.length) {
        proof.push({
          hash:     layer[siblingIdx],
          position: isLeft ? "right" : "left",
        });
      }

      index = Math.floor(index / 2);
    }

    return {
      valid:     true,
      certHash:  normalized,
      proof:     proof.map(p => p.hash), // Just hashes for Solidity
      proofFull: proof,                  // Full data for debugging
      root:      this.getRoot(),
      index:     leafIndex,
    };
  }

  // ─────────────────────────────────────────────
  //  Verify Proof (off-chain)
  // ─────────────────────────────────────────────

  /**
   * Verify a certificate is in the tree using its proof
   * This mirrors the on-chain Solidity verification logic
   *
   * @param {string}   certHash - Certificate hash to verify
   * @param {string[]} proof    - Proof array from getProof()
   * @param {string}   root     - Expected Merkle root
   * @returns {boolean}
   */
  static verify(certHash, proof, root) {
    const tree = new MerkleTree(); // empty instance for utility methods
    let computed = tree._normalize(certHash);

    for (const proofElement of proof) {
      const normalized = tree._normalize(proofElement);
      if (computed <= normalized) {
        computed = tree._hashPair(computed, normalized);
      } else {
        computed = tree._hashPair(normalized, computed);
      }
    }

    return computed === tree._normalize(root);
  }

  // ─────────────────────────────────────────────
  //  Batch Operations
  // ─────────────────────────────────────────────

  /**
   * Add new leaves and rebuild tree
   * (Use for incremental batch additions)
   */
  addLeaves(newHashes) {
    this.leaves = [...this.leaves, ...newHashes.map(h => this._normalize(h))];
    this._build();
  }

  /**
   * Get all leaves (certificate hashes)
   */
  getLeaves() {
    return this.leaves;
  }

  /**
   * Get full tree structure (for debugging)
   */
  getTree() {
    return this.tree;
  }

  // ─────────────────────────────────────────────
  //  Utilities
  // ─────────────────────────────────────────────

  _hashPair(a, b) {
    // Sort to ensure deterministic ordering (same as Solidity)
    const [left, right] = a <= b ? [a, b] : [b, a];
    return "0x" + crypto
      .createHash("sha256")
      .update(Buffer.from(left.replace("0x", "") + right.replace("0x", ""), "hex"))
      .digest("hex");
  }

  _normalize(hash) {
    if (!hash) return hash;
    return hash.toLowerCase().startsWith("0x") ? hash.toLowerCase() : "0x" + hash.toLowerCase();
  }

  /**
   * Display tree visually (for debugging)
   */
  toString() {
    let output = "\n=== MERKLE TREE ===\n";
    for (let i = this.tree.length - 1; i >= 0; i--) {
      const level  = this.tree.length - 1 - i;
      const indent = " ".repeat(level * 2);
      output += `Layer ${i} (${this.tree[i].length} nodes):\n`;
      for (const node of this.tree[i]) {
        output += `${indent}  ${node.substring(0, 18)}...\n`;
      }
    }
    output += `ROOT: ${this.getRoot()}\n`;
    return output;
  }
}

module.exports = MerkleTree;
