// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./IEntryPoint.sol";

/**
 * @title IAccount
 * @notice ERC-4337 account interface
 */
interface IAccount {
  /**
   * Validate user operation
   */
  function validateUserOp(
    IEntryPoint.UserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 missingAccountFunds
  ) external returns (uint256 validationData);
}
