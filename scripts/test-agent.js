/**
 * Archon Agent Test Script
 *
 * Tests the full agent flow: discover -> submit -> respond -> claim
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js
 *
 * Or with a specific task:
 *   AGENT_PRIVATE_KEY=0x... TASK_ID=1 node scripts/test-agent.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC = "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";

async function getContracts() {
  try {
    const res = await fetch("https://archon-dapp.vercel.app/api/contracts");
    const json = await res.json();
    const c = json.contracts ?? {};
    return {
      job: c.jobContract?.address ?? c.mockJob?.address ?? c.job?.address,
      registry: c.validationRegistry?.address
    };
  } catch {
    const filePath = path.resolve(__dirname, "../frontend/src/lib/generated/contracts.json");
    const local = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const c = local.contracts ?? {};
    return {
      job: c.jobContract?.address ?? c.mockJob?.address ?? c.job?.address,
      registry: c.validationRegistry?.address
    };
  }
}

const JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getJob(uint256) view returns (uint256,address,string,string,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool,uint8)",
  "function submitDirect(uint256 jobId, string deliverableLink) external",
  "function submitDeliverable(uint256 jobId, string deliverableLink) external",
  "function acceptJob(uint256 jobId) external",
  "function claimCredential(uint256 jobId) external",
  "function respondToSubmission(uint256 parentSubmissionId, uint8 responseType, string contentURI) external returns (uint256)",
  "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId, address agent, string deliverableLink, uint8 status, uint256 submittedAt, string reviewerNote, bool credentialClaimed, uint256 allocatedReward, uint256 buildOnBonus, bool isBuildOnWinner)[])",
  "event JobCreated(uint256 indexed jobId, address indexed client, string title, string description, uint256 deadline, uint256 rewardUSDC)"
];

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const REG_ABI = ["function getWeightedScore(address) view returns (uint256)"];

function log(step, message, data) {
  const prefix = `[${step.padEnd(12)}]`;
  console.log(prefix, message);
  if (data !== undefined) {
    console.log("".padEnd(15), typeof data === "object" ? JSON.stringify(data, null, 2) : String(data));
  }
}

async function runAgentTest() {
  console.log("\n═══════════════════════════════════════");
  console.log("  ARCHON AGENT TEST SCRIPT");
  console.log("═══════════════════════════════════════\n");

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("ERROR: Set AGENT_PRIVATE_KEY environment variable");
    console.error("Usage: AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  log("WALLET", "Agent address:", wallet.address);

  const addresses = await getContracts();
  log("CONTRACTS", "Job contract:", addresses.job);
  log("CONTRACTS", "Registry:", addresses.registry);

  if (!addresses.job) {
    console.error("ERROR: Could not load contract addresses. Deploy contracts first.");
    process.exit(1);
  }

  const jobContract = new ethers.Contract(addresses.job, JOB_ABI, wallet);
  const usdc = new ethers.Contract(USDC, USDC_ABI, wallet);
  const registry = new ethers.Contract(addresses.registry, REG_ABI, provider);

  const balance = await usdc.balanceOf(wallet.address);
  const balanceFormatted = (Number(balance) / 1e6).toFixed(2);
  log("BALANCE", `${balanceFormatted} USDC`);
  if (Number(balance) < 1_000_000) {
    console.warn("WARNING: Less than 1 USDC. Get testnet funds at faucet.arc.network");
  }

  const score = await registry.getWeightedScore(wallet.address);
  log("REPUTATION", `Current score: ${score}/2000`);

  let total = 0n;
  try {
    total = await jobContract.totalJobs();
  } catch {
    total = await jobContract.nextJobId();
  }
  log("DISCOVERY", `Total tasks on chain: ${total}`);

  let targetTaskId = process.env.TASK_ID ? Number(process.env.TASK_ID) : null;
  if (!targetTaskId) {
    log("DISCOVERY", "Scanning for open tasks...");
    for (let i = Number(total) - 1; i >= 0; i -= 1) {
      const job = await jobContract.getJob(i);
      const status = Number(job[13]);
      const deadline = Number(job[4]);
      const now = Math.floor(Date.now() / 1000);
      log(
        "SCAN",
        `Task #${i}: "${job[2]}" | Status: ${status} | Deadline: ${
          deadline > now ? `${Math.floor((deadline - now) / 3600)}h remaining` : "EXPIRED"
        }`
      );
      if (status === 0 && deadline > now) {
        targetTaskId = i;
        log("FOUND", `Selected task #${i} for submission`);
        break;
      }
    }
  }

  if (!targetTaskId && targetTaskId !== 0) {
    log("RESULT", "No open tasks found. Create one at archon-dapp.vercel.app");
    return;
  }

  const task = await jobContract.getJob(targetTaskId);
  log("TASK", `#${targetTaskId}: ${task[2]}`);
  log("TASK", "Description:", String(task[3]).slice(0, 100) + "...");
  log("TASK", "Reward:", `${Number(task[5]) / 1e6} USDC`);

  log("WORK", "Generating solution (simulated)...");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const simulatedOutput = `https://gist.github.com/agent-test-${Date.now()}`;
  log("WORK", "Solution ready:", simulatedOutput);

  log("SUBMIT", "Attempting submitDirect...");
  try {
    const tx = await jobContract.submitDirect(targetTaskId, simulatedOutput);
    log("SUBMIT", "Transaction sent:", tx.hash);
    const receipt = await tx.wait();
    log("SUBMIT", "Confirmed in block:", receipt.blockNumber);
    log("SUCCESS", `Submission recorded on-chain for task #${targetTaskId}`);
  } catch (error) {
    const msg = error?.reason ?? error?.message ?? "Unknown error";
    if (String(msg).includes("already submitted")) {
      log("SKIP", "Already submitted to this task");
    } else if (String(msg).includes("deadline passed")) {
      log("ERROR", "Deadline has passed for this task");
    } else {
      log("FALLBACK", "submitDirect failed, trying acceptJob + submit...");
      try {
        await (await jobContract.acceptJob(targetTaskId)).wait();
        log("FALLBACK", "acceptJob confirmed");
        await (await jobContract.submitDeliverable(targetTaskId, simulatedOutput)).wait();
        log("SUCCESS", "Submitted via fallback flow");
      } catch (fallbackError) {
        log("ERROR", "Both submit methods failed:", fallbackError?.reason ?? fallbackError?.message);
      }
    }
  }

  log("EVENTS", "Starting 30s event listener test...");
  const timeout = setTimeout(() => {
    log("EVENTS", "No new events in 30s - listener test complete");
    process.exit(0);
  }, 30000);

  jobContract.on("JobCreated", (jobId, client, title) => {
    log("EVENT", `JobCreated: #${jobId} "${title}" by ${String(client).slice(0, 8)}...`);
    clearTimeout(timeout);
    process.exit(0);
  });

  console.log("\n  Listening for JobCreated events...");
  console.log("  Post a task on archon-dapp.vercel.app to trigger it");
  console.log("  (Will timeout in 30 seconds)\n");
}

runAgentTest().catch((error) => {
  console.error("FATAL:", error?.message ?? error);
  process.exit(1);
});
