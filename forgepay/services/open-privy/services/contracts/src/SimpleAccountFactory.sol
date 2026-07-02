// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./SimpleAccount.sol";
import "./interfaces/IEntryPoint.sol";

/**
 * @title SimpleAccountFactory
 * @notice Factory for creating SimpleAccount instances
 * @dev Supports batch creation for efficient deployments
 */
contract SimpleAccountFactory {
  SimpleAccount public immutable accountImplementation;
  IEntryPoint public immutable entryPoint;

  event AccountCreated(address indexed account, address indexed owner, uint256 salt);

  constructor(IEntryPoint _entryPoint) {
    entryPoint = _entryPoint;
    accountImplementation = new SimpleAccount(_entryPoint);
  }

  /**
   * @notice Create account for owner
   * @param owner Account owner address
   * @param salt Unique salt for deterministic address
   * @return account The created account address
   */
  function createAccount(
    address owner,
    uint256 salt
  ) public returns (address account) {
    address addr = getAddress(owner, salt);

    uint256 codeSize = addr.code.length;
    if (codeSize > 0) {
      return addr;
    }

    account = address(
      new ERC1967Proxy{salt: bytes32(salt)}(
        address(accountImplementation),
        abi.encodeCall(SimpleAccount.initialize, (owner))
      )
    );

    emit AccountCreated(account, owner, salt);
  }

  /**
   * @notice Get deterministic account address
   * @param owner Account owner
   * @param salt Unique salt
   * @return The account address
   */
  function getAddress(address owner, uint256 salt) public view returns (address) {
    return
      address(
        uint160(
          uint256(
            keccak256(
              abi.encodePacked(
                bytes1(0xff),
                address(this),
                bytes32(salt),
                keccak256(
                  abi.encodePacked(
                    type(ERC1967Proxy).creationCode,
                    abi.encode(
                      address(accountImplementation),
                      abi.encodeCall(SimpleAccount.initialize, (owner))
                    )
                  )
                )
              )
            )
          )
        )
      );
  }
}
