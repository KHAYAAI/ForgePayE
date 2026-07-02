import { ethers } from 'hardhat';

async function main() {
  console.log('🚀 Deploying OpenPrivy contracts...');

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with account:', deployer.address);
  console.log('Account balance:', (await deployer.getBalance()).toString());

  // Get or use mock EntryPoint (in production, use official EntryPoint 0x5FF137D4B0FDCD49DcA30c7B57B04B0ca3615723)
  const ENTRY_POINT = process.env.ENTRY_POINT || '0x5FF137D4B0FDCD49DcA30c7B57B04B0ca3615723';

  // Deploy SimpleAccountFactory
  console.log('\n📦 Deploying SimpleAccountFactory...');
  const factory = await ethers.deployContract('SimpleAccountFactory', [ENTRY_POINT]);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log('✅ SimpleAccountFactory deployed to:', factoryAddress);

  // Deploy OpenPrivyPaymaster
  console.log('\n💳 Deploying OpenPrivyPaymaster...');
  const paymaster = await ethers.deployContract('OpenPrivyPaymaster', [
    ENTRY_POINT,
    deployer.address,
  ]);
  await paymaster.waitForDeployment();
  const paymasterAddress = await paymaster.getAddress();
  console.log('✅ OpenPrivyPaymaster deployed to:', paymasterAddress);

  // Deposit ETH to paymaster (for gas sponsorship)
  console.log('\n💰 Funding paymaster...');
  const fundTx = await paymaster.deposit({ value: ethers.parseEther('10') });
  await fundTx.wait();
  const balance = await paymaster.getBalance();
  console.log('✅ Paymaster balance:', ethers.formatEther(balance), 'ETH');

  // Create sample account
  console.log('\n👤 Creating sample account...');
  const salt = 0;
  const tx = await factory.createAccount(deployer.address, salt);
  await tx.wait();
  const accountAddress = await factory.getAddress(deployer.address, salt);
  console.log('✅ Sample account created at:', accountAddress);

  // Enable sponsorship for sample account
  console.log('\n🎯 Enabling gas sponsorship...');
  const sponsorTx = await paymaster.setSponsorshipStatus(accountAddress, true);
  await sponsorTx.wait();
  console.log('✅ Gas sponsorship enabled for:', accountAddress);

  // Output deployment info
  console.log('\n' + '='.repeat(50));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('='.repeat(50));
  console.log(`Network: ${(await deployer.provider?.getNetwork())?.name}`);
  console.log(`Chain ID: ${(await deployer.provider?.getNetwork())?.chainId}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Entry Point: ${ENTRY_POINT}`);
  console.log(`Factory: ${factoryAddress}`);
  console.log(`Paymaster: ${paymasterAddress}`);
  console.log(`Sample Account: ${accountAddress}`);
  console.log('='.repeat(50));

  // Save deployment info
  const deployment = {
    network: (await deployer.provider?.getNetwork())?.name,
    chainId: (await deployer.provider?.getNetwork())?.chainId,
    deployer: deployer.address,
    entryPoint: ENTRY_POINT,
    factory: factoryAddress,
    paymaster: paymasterAddress,
    sampleAccount: accountAddress,
    timestamp: new Date().toISOString(),
  };

  console.log('\n✅ Deployment successful!');
  console.log('Contract addresses:', JSON.stringify(deployment, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
