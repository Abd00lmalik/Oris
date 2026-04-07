import { ethers } from "hardhat";
import contracts from "../../frontend/src/lib/generated/contracts.json";

async function main() {
  console.log("\n=== Arc Testnet E2E Verification ===\n");
  const c = contracts.contracts;
  const jobAddress = c.jobContract?.address ?? c.job?.address;
  if (!jobAddress) {
    throw new Error("Missing job contract address in generated contracts.json");
  }

  const registry = await ethers.getContractAt(
    ["function totalCredentials() view returns (uint256)"],
    c.validationRegistry.address
  );
  const sourceReg = await ethers.getContractAt(
    ["function owner() view returns (address)"],
    c.sourceRegistry.address
  );
  const job = await ethers.getContractAt(
    ["function usdc() view returns (address)",
     "function platformTreasury() view returns (address)",
     "function platformFeeBps() view returns (uint256)"],
    jobAddress
  );
  const hook = await ethers.getContractAt(
    ["function registeredSourceContracts(address) view returns (bool)"],
    c.credentialHook.address
  );
  const agentTask = await ethers.getContractAt(
    ["function usdc() view returns (address)"],
    c.agentTaskSource.address
  );
  const milestoneEscrow = await ethers.getContractAt(
    [
      "function usdc() view returns (address)",
      "function platformFeeBps() view returns (uint256)"
    ],
    c.milestoneEscrow.address
  );
  const communitySource = await ethers.getContractAt(
    ["function activeModeratorCount() view returns (uint256)"],
    c.communitySource.address
  );

  const checks: Array<[string, boolean]> = [
    ["1. Registry deployed", 
      (await registry.totalCredentials()).toString() === "0"],
    ["2. SourceRegistry has owner", 
      (await sourceReg.owner()) !== ethers.ZeroAddress],
    ["3. Job USDC = Arc USDC", 
      (await job.usdc()).toLowerCase() === 
      "0x3600000000000000000000000000000000000000"],
    ["4. Job treasury = Safe", 
      (await job.platformTreasury()).toLowerCase() === 
      "0x25265b9dBEb6c653b0CA281110Bb0697a9685107".toLowerCase()],
    ["5. Job fee = 1000bps", 
      (await job.platformFeeBps()).toString() === "1000"],
    ["6. AgentTask USDC = Arc USDC", 
      (await agentTask.usdc()).toLowerCase() === 
      "0x3600000000000000000000000000000000000000"],
    ["7. Job registered in hook", 
      await hook.registeredSourceContracts(jobAddress)],
    ["8. AgentTask registered in hook", 
      await hook.registeredSourceContracts(c.agentTaskSource.address)],
    ["9. MilestoneEscrow USDC = Arc USDC",
      (await milestoneEscrow.usdc()).toLowerCase() ===
      "0x3600000000000000000000000000000000000000"],
    ["10. Community moderator seeded",
      Number(await communitySource.activeModeratorCount()) >= 1],
  ];

  let passed = 0;
  for (const [label, result] of checks) {
    console.log(`${result ? "[PASS]" : "[FAIL]"} ${label}`);
    if (result) passed++;
  }

  console.log(`\n${passed}/10 checks passed`);
  if (passed < 10) process.exit(1);
}

main().catch(console.error);
