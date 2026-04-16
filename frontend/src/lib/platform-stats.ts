import { Contract } from "ethers";
import { getReadProvider } from "./contracts";
import contracts from "./generated/contracts.json";

export interface PlatformStats {
  totalCredentials: number;
  totalUSDCEscrowed: string;
  totalCreators: number;
  totalAgents: number;
  totalTasks: number;
  totalSubmissions: number;
  loading: boolean;
  error: string | null;
}

type RawJob = {
  client?: string;
  rewardUSDC?: bigint;
  paidOutUSDC?: bigint;
  submissionCount?: bigint;
  refunded?: boolean;
};

const JOB_MIN_ABI = [
  "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded)[])"
] as const;

const VALIDATION_MIN_ABI = ["function totalCredentials() view returns (uint256)"] as const;
const IDENTITY_MIN_ABI = ["function totalSupply() view returns (uint256)"] as const;

function formatUsdcWhole(units: bigint): string {
  if (units <= 0n) return "0";
  return (Number(units) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  const provider = getReadProvider();

  try {
    const registry = new Contract(contracts.contracts.validationRegistry.address, VALIDATION_MIN_ABI, provider);
    const jobContract = new Contract(
      contracts.contracts.jobContract.address,
      JOB_MIN_ABI,
      provider
    );
    const identityRegistry = new Contract(
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      IDENTITY_MIN_ABI,
      provider
    );

    const [totalCredentialsRaw, jobsRaw, totalAgentsRaw] = await Promise.all([
      registry.totalCredentials().catch(() => 0n),
      jobContract.getAllJobs().catch(() => [] as RawJob[]),
      identityRegistry.totalSupply().catch(() => 0n)
    ]);

    const creatorSet = new Set<string>();
    let escrowActive = 0n;
    let totalSubmissions = 0;

    for (const job of jobsRaw as RawJob[]) {
      if (job.client) {
        creatorSet.add(job.client.toLowerCase());
      }

      const reward = job.rewardUSDC ?? 0n;
      const paidOut = job.paidOutUSDC ?? 0n;
      const remaining = reward > paidOut ? reward - paidOut : 0n;

      if (!job.refunded && remaining > 0n) {
        escrowActive += remaining;
      }

      totalSubmissions += Number(job.submissionCount ?? 0n);
    }

    return {
      totalCredentials: Number(totalCredentialsRaw),
      totalUSDCEscrowed: formatUsdcWhole(escrowActive),
      totalCreators: creatorSet.size,
      totalAgents: Number(totalAgentsRaw),
      totalTasks: (jobsRaw as RawJob[]).length,
      totalSubmissions,
      loading: false,
      error: null
    };
  } catch (err) {
    console.error("[platformStats] error:", err);
    return {
      totalCredentials: 0,
      totalUSDCEscrowed: "0",
      totalCreators: 0,
      totalAgents: 0,
      totalTasks: 0,
      totalSubmissions: 0,
      loading: false,
      error: "Failed to load stats"
    };
  }
}
