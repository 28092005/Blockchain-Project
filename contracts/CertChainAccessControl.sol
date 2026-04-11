// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CertChainAccessControl
 * @dev Role-Based Access Control for the CertChain system
 *
 * ROLES:
 * - DEFAULT_ADMIN_ROLE : Can grant/revoke all roles. Deployer gets this.
 * - SUPER_ADMIN_ROLE   : Can pause/unpause system, manage institutions
 * - INSTITUTION_ROLE   : Approved institutions that can issue certificates
 * - VALIDATOR_ROLE     : Can vote on institution onboarding (multi-sig)
 * - AUDITOR_ROLE       : Read-only access, can view all logs
 */
contract CertChainAccessControl is AccessControl, Pausable {

    // ─────────────────────────────────────────────
    //  Role Definitions
    // ─────────────────────────────────────────────
    bytes32 public constant SUPER_ADMIN_ROLE    = keccak256("SUPER_ADMIN_ROLE");
    bytes32 public constant INSTITUTION_ROLE   = keccak256("INSTITUTION_ROLE");
    bytes32 public constant VALIDATOR_ROLE     = keccak256("VALIDATOR_ROLE");
    bytes32 public constant AUDITOR_ROLE       = keccak256("AUDITOR_ROLE");
    bytes32 public constant CERT_REGISTRY_ROLE = keccak256("CERT_REGISTRY_ROLE");

    // ─────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────
    event RoleGrantedWithReason(bytes32 indexed role, address indexed account, string reason, uint256 timestamp);
    event RoleRevokedWithReason(bytes32 indexed role, address indexed account, string reason, uint256 timestamp);
    event SystemPaused(address by, string reason, uint256 timestamp);
    event SystemUnpaused(address by, uint256 timestamp);

    // ─────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────
    constructor(address superAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SUPER_ADMIN_ROLE,   superAdmin);

        // SUPER_ADMIN_ROLE manages INSTITUTION_ROLE and VALIDATOR_ROLE
        _setRoleAdmin(INSTITUTION_ROLE,   SUPER_ADMIN_ROLE);
        _setRoleAdmin(VALIDATOR_ROLE,     SUPER_ADMIN_ROLE);
        _setRoleAdmin(AUDITOR_ROLE,       SUPER_ADMIN_ROLE);
        _setRoleAdmin(CERT_REGISTRY_ROLE, SUPER_ADMIN_ROLE);
    }

    // ─────────────────────────────────────────────
    //  Role Management with Reason Logging
    // ─────────────────────────────────────────────

    /**
     * @dev Grant a role with an audit reason
     */
    function grantRoleWithReason(
        bytes32 role,
        address account,
        string calldata reason
    ) external onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
        emit RoleGrantedWithReason(role, account, reason, block.timestamp);
    }

    /**
     * @dev Revoke a role with an audit reason
     */
    function revokeRoleWithReason(
        bytes32 role,
        address account,
        string calldata reason
    ) external onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
        emit RoleRevokedWithReason(role, account, reason, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  Pause / Unpause
    // ─────────────────────────────────────────────

    function pauseSystem(string calldata reason) external onlyRole(SUPER_ADMIN_ROLE) {
        _pause();
        emit SystemPaused(msg.sender, reason, block.timestamp);
    }

    function unpauseSystem() external onlyRole(SUPER_ADMIN_ROLE) {
        _unpause();
        emit SystemUnpaused(msg.sender, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  View Helpers
    // ─────────────────────────────────────────────

    function isInstitution(address addr) external view returns (bool) {
        return hasRole(INSTITUTION_ROLE, addr);
    }

    function isValidator(address addr) external view returns (bool) {
        return hasRole(VALIDATOR_ROLE, addr);
    }

    function isSuperAdmin(address addr) external view returns (bool) {
        return hasRole(SUPER_ADMIN_ROLE, addr);
    }

    function isCertRegistry(address addr) external view returns (bool) {
        return hasRole(CERT_REGISTRY_ROLE, addr);
    }
}
