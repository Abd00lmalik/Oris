import { ethers } from "hardhat";
import { formatBps, formatUSDC, getAdmin, loadContracts } from "./_setup";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();

  const sourceRegistryAddress = contracts.contracts.sourceRegistry?.address;
  const validationRegistryAddress = contracts.contracts.validationRegistry?.address;
  const jobAddress = (contracts.contracts.jobContract ?? contracts.contracts.job)?.address;
  const agentTaskAddress = contracts.contracts.agentTaskSource?.address;

  if (!sourceRegistryAddress || !validationRegistryAddress || !jobAddress || !agentTaskAddress) {
    throw new Error("Missing one or more required contract addresses in generated contracts config.");
  }

  const sourceRegistry = await ethers.getContractAt(
    [
      "function owner() view returns (address)",
      "function totalApproved() view returns (uint256)"
    ],
    sourceRegistryAddress,
    admin
  );
  const validationRegistry = await ethers.getContractAt(
    ["function totalCredentials() view returns (uint256)"],
    validationRegistryAddress,
    admin
  );
  const jobContract = await ethers.getContractAt(
    [
      "function nextJobId() view returns (uint256)",
      "function platformFeeBps() view returns (uint256)",
      "function minJobStake() view returns (uint256)",
      "function platformTreasury() view returns (address)"
    ],
    jobAddress,
    admin
  );
  const agentTaskSource = await ethers.getContractAt(
    ["function nextTaskId() view returns (uint256)"],
    agentTaskAddress,
    admin
  );

  const [
    totalCredentials,
    totalJobs,
    totalAgentTasks,
    platformFeeBps,
    minJobStake,
    platformTreasury,
    totalApprovedOperators,
    owner
  ] = await Promise.all([
    validationRegistry.totalCredentials() as Promise<bigint>,
    jobContract.nextJobId() as Promise<bigint>,
    agentTaskSource.nextTaskId() as Promise<bigint>,
    jobContract.platformFeeBps() as Promise<bigint>,
    jobContract.minJobStake() as Promise<bigint>,
    jobContract.platformTreasury() as Promise<string>,
    sourceRegistry.totalApproved() as Promise<bigint>,
    sourceRegistry.owner() as Promise<string>
  ]);

  console.log("\n=== ARCHON PLATFORM STATS ===");
  console.log("\n[Registry]");
  console.log(`Total credentials minted: ${totalCredentials.toString()}`);
  console.log(`Total approved operators: ${totalApprovedOperators.toString()}`);
  console.log(`Owner: ${owner}`);

  console.log("\n[Tasks]");
  console.log(`Total tasks created: ${totalJobs.toString()}`);
  console.log(`Total agentic tasks: ${totalAgentTasks.toString()}`);

  console.log("\n[Economics]");
  console.log(`Platform fee: ${platformFeeBps.toString()} bps (${formatBps(platformFeeBps)})`);
  console.log(`Minimum job stake: ${formatUSDC(minJobStake)}`);
  console.log(`Platform treasury: ${platformTreasury}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

