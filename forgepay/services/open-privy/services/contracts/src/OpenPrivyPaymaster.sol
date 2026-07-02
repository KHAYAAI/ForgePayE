// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IPaymaster.sol";
import "./interfaces/IEntryPoint.sol";

/**
 * @title OpenPrivyPaymaster
 * @notice Gas sponsorship contract enabling $0 transaction fees
 * @dev Sponsors gas costs for OpenPrivy users
 */
contract OpenPrivyPaymaster is IPaymaster, Ownable {
  using ECDSA for bytes32;

  IEntryPoint public immutable entryPoint;
  address public paymasterSigner;

  uint256 public constant VALID_TIMESTAMP_OFFSET = 21;
  uint256 public constant SIGNATURE_OFFSET = 169;

  mapping(address => bool) public sponsoredAccounts;
  mapping(address => uint256) public gasSponsored;

  event GasSponsored(address indexed account, address indexed sender, uint256 amount);
  event PaymasterSignerUpdated(address indexed newSigner);
  event AccountSponsorship(address indexed account, bool enabled);

  constructor(IEntryPoint _entryPoint, address _signer) {
    entryPoint = _entryPoint;
    paymasterSigner = _signer;
  }

  /**
   * @notice Update paymaster signer (for signature verification)
   */
  function setPaymasterSigner(address _signer) external onlyOwner {
    paymasterSigner = _signer;
    emit PaymasterSignerUpdated(_signer);
  }

  /**
   * @notice Enable or disable sponsorship for an account
   */
  function setSponsorshipStatus(address account, bool enabled) external onlyOwner {
    sponsoredAccounts[account] = enabled;
    emit AccountSponsorship(account, enabled);
  }

  /**
   * @notice Validate paymaster user operation
   * @param userOp User operation
   * @param userOpHash User operation hash
   * @param maxCost Maximum gas cost
   * @return context Context data for postOp
   * @return validationData Validation result
   */
  function validatePaymasterUserOp(
    IEntryPoint.UserOperation calldata userOp,
    bytes32 userOpHash,
    uint256 maxCost
  ) external view returns (bytes memory context, uint256 validationData) {
    // Check if account is sponsored
    if (!sponsoredAccounts[userOp.sender]) {
      return ("", 1); // Not sponsored
    }

    // Verify signature from paymaster signer
    bytes calldata sig = userOp.paymasterAndData[20:];
    bytes32 hash = keccak256(abi.encodePacked(userOpHash, maxCost));
    address signer = hash.toEthSignedMessageHash().recover(sig);

    if (signer != paymasterSigner) {
      return ("", 1); // Invalid signature
    }

    // Return context for postOp
    return (abi.encodePacked(userOp.sender, maxCost), 0);
  }

  /**
   * @notice Post-operation hook (called after user op execution)
   * @param mode Operation mode
   * @param context Context from validatePaymasterUserOp
   * @param actualGasCost Actual gas cost
   */
  function postOp(
    PostOpMode mode,
    bytes calldata context,
    uint256 actualGasCost
  ) external {
    require(msg.sender == address(entryPoint), "Only entry point");

    if (context.length == 0) {
      return;
    }

    // Decode context (checks)
    (address account, uint256 maxCost) = abi.decode(context, (address, uint256));

    // Cap sponsored amount to maxCost (effects first - checks-effects-interactions pattern)
    uint256 sponsoredAmount = actualGasCost > maxCost ? maxCost : actualGasCost;

    // Update state before external calls (effects)
    gasSponsored[account] += sponsoredAmount;

    // External interactions last
    emit GasSponsored(account, tx.origin, sponsoredAmount);
  }

  /**
   * @notice Get total gas sponsored for account
   */
  function getGasSponsored(address account) external view returns (uint256) {
    return gasSponsored[account];
  }

  /**
   * @notice Deposit ETH to paymaster
   */
  function deposit() public payable {
    entryPoint.depositTo{value: msg.value}(address(this));
  }

  /**
   * @notice Withdraw balance
   */
  function withdraw(address payable to, uint256 amount) external onlyOwner {
    entryPoint.withdrawTo(to, amount);
  }

  /**
   * @notice Get paymaster balance
   */
  function getBalance() external view returns (uint256) {
    return entryPoint.balanceOf(address(this));
  }

  /**
   * @notice Receive ETH
   */
  receive() external payable {}
}
