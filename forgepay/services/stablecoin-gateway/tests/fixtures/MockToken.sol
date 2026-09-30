// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20; // compiled with evmVersion paris (no PUSH0) so it runs on older dev chains

/// A minimal ERC-20 for testing settlement and payouts against a local chain.
/// Anyone can mint. Symbol and decimals are constructor arguments so the same
/// contract stands in for USDC (6), ZARP and OUSD (whatever they turn out to be).
contract MockToken {
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string memory s, uint8 d) { symbol = s; decimals = d; }

    function mint(address to, uint256 v) external { balanceOf[to] += v; emit Transfer(address(0), to, v); }

    function transfer(address to, uint256 v) external returns (bool) {
        require(balanceOf[msg.sender] >= v, "balance");
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }
}
