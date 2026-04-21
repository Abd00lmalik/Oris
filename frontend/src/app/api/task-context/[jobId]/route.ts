import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import contractsJson from "@/lib/generated/contracts.json";
import { LEGACY_ADDRESSES } from "@/lib/legacy-contracts";

const PAYMENT_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS ?? "0x25265b9dBEb6c653b0CA281110Bb0697a9685107";
const PAYMENT_AMOUNT = "10"; // 0.00001 USDC in 6-decimal units.
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const NETWORK = "arc_testnet";
const RPC_URL = "https://rpc.testnet.arc.network";

const LEGACY_JOB_ABI = [
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))"
] as const;

function paymentRequirements(resource: string, jobId: string) {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: PAYMENT_AMOUNT,
    resource,
    description: `Access Archon task #${jobId} context data`,
    mimeType: "application/json",
    payTo: PAYMENT_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: USDC_CONTRACT,
    extra: {
      name: "Archon Task Context",
      version: "1"
    }
  };
}

async function readTask(jobId: number) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contracts = (contractsJson as { contracts?: Record<string, { address?: string; abi?: ethers.InterfaceAbi }> }).contracts ?? {};
  const jobConfig = contracts.jobContract ?? contracts.job;

  if (jobConfig?.address && jobConfig.abi) {
    try {
      const jobContract = new ethers.Contract(jobConfig.address, jobConfig.abi, provider);
      const job = await jobContract.getJob(jobId);
      const client = String(job.client ?? job[1] ?? "");
      if (client && client !== ethers.ZeroAddress) {
        return {
          source: "v2",
          jobId,
          title: String(job.title ?? job[2] ?? ""),
          description: String(job.description ?? job[3] ?? ""),
          acceptanceCriteria: String(job.description ?? job[3] ?? ""),
          rewardUSDC: Number(job.rewardUSDC ?? job[5] ?? 0n) / 1e6,
          deadline: Number(job.deadline ?? job[4] ?? 0),
          maxApprovals: Number(job.maxApprovals ?? job[6] ?? 0),
          submissionCount: Number(job.submissionCount ?? job[9] ?? 0)
        };
      }
    } catch {
      // Fall through to V1 for legacy continuity.
    }
  }

  const legacy = new ethers.Contract(LEGACY_ADDRESSES.job, LEGACY_JOB_ABI, provider);
  const job = await legacy.getJob(jobId);
  const client = String(job.client ?? job[1] ?? "");
  if (!client || client === ethers.ZeroAddress) {
    throw new Error("Task not found");
  }

  return {
    source: "v1",
    jobId,
    title: String(job.title ?? job[2] ?? ""),
    description: String(job.description ?? job[3] ?? ""),
    acceptanceCriteria: String(job.description ?? job[3] ?? ""),
    rewardUSDC: Number(job.rewardUSDC ?? job[5] ?? 0n) / 1e6,
    deadline: Number(job.deadline ?? job[4] ?? 0),
    maxApprovals: Number(job.approvedCount ?? job[9] ?? 0),
    submissionCount: Number(job.submissionCount ?? job[8] ?? 0)
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  const params = await context.params;
  const jobId = params.jobId;
  const requirement = paymentRequirements(request.url, jobId);
  const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");
  const legacyPaymentHeader = request.headers.get("X-Payment");

  if (!paymentSignature && !legacyPaymentHeader) {
    return NextResponse.json(
      {
        error: "Payment Required",
        accepts: [requirement]
      },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": JSON.stringify(requirement),
          "X-Payment-Required": "true"
        }
      }
    );
  }

  try {
    const task = await readTask(Number(jobId));
    return NextResponse.json(
      {
        ...task,
        paymentReceived: true,
        paymentVerification: paymentSignature ? "PAYMENT-SIGNATURE present" : "X-Payment compatibility header present",
        settlement: "Circle Gateway settlement verification pending for Arc testnet",
        accessedAt: Date.now()
      },
      {
        headers: {
          "PAYMENT-RESPONSE": JSON.stringify({ success: true, network: NETWORK })
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch task context",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
