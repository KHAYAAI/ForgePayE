// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IAccount.sol";
import "./interfaces/IEntryPoint.sol";

/**
 * @title SimpleAccount
 * @notice ERC-4337 compliant smart contract wallet with gas-less execution
 * @dev Supports account abstraction for OpenPrivy embedded wallets
 */
contract SimpleAccount is IAccount, Initializable, UUPSUpgradeable {
  using ECDSA for bytes32;

  IEntryPoint public entryPoint;
  address public owner;
  uint256 public nonce;

  event SimpleAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);
  event Executed(address indexed target, uint256 value, bytes data);
  event NonceIncremented(uint256 indexed newNonce);

  modifier onlyOwner() {
    require(msg.sender == owner, "Only owner");
    _;
  }

  modifier onlyEntryPoint() {
    require(msg.sender == address(entryPoint), "Only entry point");
    _;
  }

  constructor(IEntryPoint _entryPoint) {
    entryPoint = _entryPoint;
  }

  function initialize(address _owner) public initializer {
    owner = _owner;
    emit SimpleAccountInitialized(entryPoint, _owner);
  }

  /**
   * @notice Execute a transaction
   * @param target Contract to call
   * @param value ETH amount to send
   * @param data Call data
   */
  function execute(
    address target,
    uint256 value,
    bytes calldata data
  ) public onlyEntryPoint returns (bytes memory) {
    return _call(target, value, data);
  }

  /**
   * @notice Execute batch transactions
   * @param targets Contracts to call
   * @param values ETH amounts to send
   * @param datas Call datas
   */
  function executeBatch(
    address[] calldata targets,
    uint256[] calldata values,
    bytes[] calldata datas
  ) public onlyEntryPoint {
    require(targets.length == values.length && targets.length == datas.length, "Array length mismatch");

    for (uint256 i = 0; i < targets.length; i++) {
      _call(targets[i], values[i], datas[i]);
    }
  }

  /**
   * @notice Validate user operation
   * @param userOp User operation
   * @param userOpHash User operation hash
   * @param missingAccountFunds Missing funds to pay for operation
   * @return validationData Validation result (0 = valid, 1 = invalid)
   */
  function validateUserOp(
    IEntryPoint.UserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 missingAccountFunds
  ) external onlyEntryPoint returns (uint256 validationData) {
    // Validate nonce to prevent replay attacks
    if (userOp.nonce != nonce) {
      return 1; // Invalid nonce
    }

    // Verify signature
    address signer = userOpHash.toEthSignedMessageHash().recover(userOp.signature);
    if (signer != owner) {
      return 1; // Invalid signature
    }

    // Increment nonce after validation
    nonce++;
    emit NonceIncremented(nonce);

    // Pay entry point for gas costs
    if (missingAccountFunds > 0) {
      (bool success, ) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
      require(success, "Failed to pay entry point");
    }

    return 0; // Valid
  }

  /**
   * @notice Update owner
   * @param newOwner New owner address
   */
  function updateOwner(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Invalid owner");
    owner = newOwner;
  }

  /**
   * @notice Receive ETH
   */
  receive() external payable {}

  /**
   * @notice Internal function to call contracts
   */
  function _call(
    address target,
    uint256 value,
    bytes calldata data
  ) internal returns (bytes memory) {
    (bool success, bytes memory result) = target.call{value: value}(data);
    require(success, string(result));
    emit Executed(target, value, data);
    return result;
  }

  /**
   * @notice Authorization for upgrades
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  /**
   * @notice Get implementation address
   */
  function getImplementation() external view returns (address) {
    return _getImplementation();
  }
}
