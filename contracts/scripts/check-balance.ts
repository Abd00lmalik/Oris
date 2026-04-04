import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  
  const nativeBalance = await ethers.provider.getBalance(deployer.address);
  console.log("Native USDC (gas):", ethers.formatEther(nativeBalance), "USDC");
  
  // Check ERC-20 USDC balance
  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)",
     "function decimals() view returns (uint8)"],
    "0x3600000000000000000000000000000000000000"
  );
  const erc20Balance = await usdc.balanceOf(deployer.address);
  console.log("ERC-20 USDC:", ethers.formatUnits(erc20Balance, 6), "USDC");
}

main().catch(console.error);
