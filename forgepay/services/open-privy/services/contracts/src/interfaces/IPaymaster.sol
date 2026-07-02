// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "./IEntryPoint.sol";

/**
 * @title IPaymaster
 * @notice EIP-4337 Paymaster interface
 */
interface IPaymaster {
  enum PostOpMode {
    opSucceeded,
    opReverted
  }

  /**
   * Validate paymaster user operation
   */
  function validatePaymasterUserOp(
    IEntryPoint.UserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 maxCost
  ) external returns (bytes memory context, uint256 validationData);

  /**
   * Post operation hook
   */
  function postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost
  ) external;
}
