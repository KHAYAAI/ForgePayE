// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

/**
 * @title IEntryPoint
 * @notice EIP-4337 EntryPoint interface
 */
interface IEntryPoint {
  struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 preVerificationGas;
    uint256 maxPriorityFeePerGas;
    uint256 maxFeePerGas;
    bytes paymasterAndData;
    bytes signature;
  }

  /**
   * Execute a bundle of user operations
   */
  function handleOps(UserOperation[] calldata ops, address payable beneficiary) external;

  /**
   * Deposit ETH to this entry point
   */
  function depositTo(address account) external payable;

  /**
   * Withdraw ETH from this entry point
   */
  function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

  /**
   * Get balance of account
   */
  function balanceOf(address account) external view returns (uint256);
}
