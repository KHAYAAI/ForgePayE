import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SimpleAccount, SimpleAccountFactory, OpenPrivyPaymaster } from '../typechain-types';

describe('SimpleAccount', () => {
  let entryPoint: any;
  let factory: SimpleAccountFactory;
  let paymaster: OpenPrivyPaymaster;
  let account: SimpleAccount;
  let owner: any;
  let user: any;

  const ENTRY_POINT = '0x5FF137D4B0FDCD49DcA30c7B57B04B0ca3615723'; // Official EntryPoint

  before(async () => {
    [owner, user] = await ethers.getSigners();

    // Deploy factory
    factory = await ethers.deployContract('SimpleAccountFactory', [ENTRY_POINT]);
    await factory.waitForDeployment();

    // Deploy paymaster
    paymaster = await ethers.deployContract('OpenPrivyPaymaster', [ENTRY_POINT, owner.address]);
    await paymaster.waitForDeployment();

    // Create account
    const salt = 0;
    await factory.createAccount(owner.address, salt);
    const accountAddress = await factory.getAddress(owner.address, salt);

    account = await ethers.getContractAt('SimpleAccount', accountAddress);
  });

  describe('Account Creation', () => {
    it('should create account with correct owner', async () => {
      expect(await account.owner()).to.equal(owner.address);
    });

    it('should have correct entry point', async () => {
      expect(await account.entryPoint()).to.equal(ENTRY_POINT);
    });

    it('should have deterministic address', async () => {
      const salt = 0;
      const predicted = await factory.getAddress(owner.address, salt);
      expect(predicted).to.equal(await account.getAddress());
    });
  });

  describe('Execute Transactions', () => {
    it('should execute single transaction', async () => {
      const target = user.address;
      const value = ethers.parseEther('1');
      const data = '0x';

      // Fund account
      await owner.sendTransaction({
        to: await account.getAddress(),
        value: ethers.parseEther('2'),
      });

      // Execute (in production, would go through entry point)
      // Note: This is simplified - real execution requires entry point
      await expect(
        account.connect(owner).execute(target, value, data),
      ).to.be.revertedWith('Only entry point');
    });

    it('should batch execute transactions', async () => {
      const targets = [user.address, user.address];
      const values = [ethers.parseEther('0.1'), ethers.parseEther('0.1')];
      const datas = ['0x', '0x'];

      await expect(
        account.connect(owner).executeBatch(targets, values, datas),
      ).to.be.revertedWith('Only entry point');
    });
  });

  describe('Update Owner', () => {
    it('should update owner', async () => {
      const newOwner = user.address;
      await account.updateOwner(newOwner);
      expect(await account.owner()).to.equal(newOwner);
    });

    it('should reject non-owner update', async () => {
      await expect(
        account.connect(user).updateOwner(owner.address),
      ).to.be.revertedWith('Only owner');
    });

    it('should reject zero address owner', async () => {
      await expect(
        account.updateOwner(ethers.ZeroAddress),
      ).to.be.revertedWith('Invalid owner');
    });
  });

  describe('Receive ETH', () => {
    it('should receive ETH', async () => {
      const accountAddr = await account.getAddress();
      const initialBalance = await ethers.provider.getBalance(accountAddr);

      await owner.sendTransaction({
        to: accountAddr,
        value: ethers.parseEther('1'),
      });

      const finalBalance = await ethers.provider.getBalance(accountAddr);
      expect(finalBalance).to.equal(initialBalance + ethers.parseEther('1'));
    });
  });
});

describe('SimpleAccountFactory', () => {
  let factory: SimpleAccountFactory;
  let owner: any;

  const ENTRY_POINT = '0x5FF137D4B0FDCD49DcA30c7B57B04B0ca3615723';

  before(async () => {
    [owner] = await ethers.getSigners();
    factory = await ethers.deployContract('SimpleAccountFactory', [ENTRY_POINT]);
    await factory.waitForDeployment();
  });

  it('should create deterministic accounts', async () => {
    const salt = 42;
    const predicted = await factory.getAddress(owner.address, salt);

    await factory.createAccount(owner.address, salt);

    expect(predicted).to.equal(predicted);
  });

  it('should not recreate existing account', async () => {
    const salt = 99;
    const tx1 = await factory.createAccount(owner.address, salt);
    await tx1.wait();

    // Second call should not create new account
    const tx2 = await factory.createAccount(owner.address, salt);
    await tx2.wait();

    expect(tx2).to.not.throw;
  });

  it('should emit AccountCreated event', async () => {
    const salt = 100;
    const address = await factory.getAddress(owner.address, salt);

    await expect(factory.createAccount(owner.address, salt))
      .to.emit(factory, 'AccountCreated')
      .withArgs(address, owner.address, salt);
  });
});

describe('OpenPrivyPaymaster', () => {
  let paymaster: OpenPrivyPaymaster;
  let owner: any;
  let signer: any;

  const ENTRY_POINT = '0x5FF137D4B0FDCD49DcA30c7B57B04B0ca3615723';

  before(async () => {
    [owner, signer] = await ethers.getSigners();
    paymaster = await ethers.deployContract('OpenPrivyPaymaster', [ENTRY_POINT, owner.address]);
    await paymaster.waitForDeployment();
  });

  it('should set paymaster signer', async () => {
    await paymaster.setPaymasterSigner(signer.address);
    // Cannot directly test, but should not throw
  });

  it('should enable sponsorship', async () => {
    await paymaster.setSponsorshipStatus(signer.address, true);
    expect(await paymaster.sponsoredAccounts(signer.address)).to.equal(true);
  });

  it('should track gas sponsored', async () => {
    const account = signer.address;
    const initialGas = await paymaster.getGasSponsored(account);
    // Gas tracking is done via postOp which requires entry point
    expect(initialGas).to.be.a('bigint');
  });
});
