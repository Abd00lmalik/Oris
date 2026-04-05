import { ethers } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const JOB_STATUS_LABELS = ["Open", "Deadline Reached"] as const;
export const SUBMISSION_STATUS_LABELS = ["Not Submitted", "Submitted", "Approved", "Rejected"] as const;

type DeploymentContract = {
  address: string;
  abi: unknown[];
};

type DeploymentContracts = {
  sourceRegistry?: DeploymentContract;
  validationRegistry: DeploymentContract;
  credentialHook: DeploymentContract;
  usdc?: DeploymentContract;
  job?: DeploymentContract;
  jobContract?: DeploymentContract;
  communitySource?: DeploymentContract;
  agentTaskSource?: DeploymentContract;
  peerAttestationSource?: DeploymentContract;
  daoGovernanceSource?: DeploymentContract;
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl?: string;
  usdcAddress?: string;
  platformTreasury?: string;
  platformFeeBps?: number;
  platform?: {
    treasury: string;
    feeBps: number;
  };
  contracts: DeploymentContracts;
};

type RawCredential = {
  credentialId: unknown;
  agent: unknown;
  jobId: unknown;
  issuedAt: unknown;
  issuedBy: unknown;
  valid: unknown;
  sourceType?: unknown;
  weight?: unknown;
};

type RawJobRecord = {
  jobId: unknown;
  client: unknown;
  title: unknown;
  description: unknown;
  deadline: unknown;
  rewardUSDC: unknown;
  createdAt: unknown;
  acceptedCount: unknown;
  submissionCount: unknown;
  approvedCount?: unknown;
  claimedCount?: unknown;
  paidOutUSDC?: unknown;
  refunded?: unknown;
};

type RawSubmissionRecord = {
  agent: unknown;
  deliverableLink: unknown;
  status: unknown;
  submittedAt: unknown;
  reviewerNote: unknown;
  credentialClaimed: unknown;
  allocatedReward?: unknown;
};

type RawModeratorProfile = {
  name: unknown;
  role: unknown;
  profileURI: unknown;
  active: unknown;
};

type RawCommunityApplication = {
  applicationId: unknown;
  applicant: unknown;
  activityDescription: unknown;
  evidenceLink: unknown;
  platform: unknown;
  submittedAt: unknown;
  status: unknown;
  reviewedBy: unknown;
  reviewNote: unknown;
};

export type JobRecord = {
  jobId: number;
  client: string;
  title: string;
  description: string;
  deadline: number;
  rewardUSDC: string;
  createdAt: number;
  acceptedCount: number;
  submissionCount: number;
  approvedCount: number;
  claimedCount: number;
  paidOutUSDC: string;
  refunded: boolean;
  status: number;
};

export type SubmissionRecord = {
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: number;
  reviewerNote: string;
  credentialClaimed: boolean;
  allocatedReward: string;
};

export type CredentialRecord = {
  credentialId: number;
  agent: string;
  activityId: number;
  issuedAt: number;
  issuedBy: string;
  valid: boolean;
  sourceType: string;
  weight: number;
  metadata?: Record<string, string | number>;
};

export type EnrichedCredential = CredentialRecord;

export type AgentTaskRecord = {
  taskId: number;
  taskPoster: string;
  assignedAgent: string;
  taskDescription: string;
  inputData: string;
  outputHash: string;
  rewardUSDC: string;
  deadline: number;
  createdAt: number;
  submittedAt: number;
  status: number;
  rewardClaimed: boolean;
  validatorNote: string;
};

export type CommunityActivityRecord = {
  activityId: number;
  recipient: string;
  activityType: number;
  platform: string;
  evidenceNote: string;
  issuedAt: number;
  issuedBy: string;
  credentialClaimed: boolean;
};

export type ModeratorProfileRecord = {
  wallet: string;
  name: string;
  role: string;
  profileURI: string;
  active: boolean;
};

export type CommunityApplicationRecord = {
  applicationId: number;
  applicant: string;
  activityDescription: string;
  evidenceLink: string;
  platform: string;
  submittedAt: number;
  status: number;
  reviewedBy: string;
  reviewNote: string;
};

export type AttestationRecord = {
  attestationId: number;
  attester: string;
  recipient: string;
  category: string;
  note: string;
  issuedAt: number;
};

export type GovernanceActivityRecord = {
  activityId: number;
  participant: string;
  governorContract: string;
  proposalId: number;
  credentialClaimed: boolean;
  claimedAt: number;
};

export type SuspicionResult = {
  score: number;
  reason: string;
};

const deployment = deploymentRaw as DeploymentConfig;
const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID;
const fallbackRpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const resolvedJobContract = deployment.contracts.jobContract ?? deployment.contracts.job;
const resolvedUsdcAddress = deployment.usdcAddress ?? deployment.contracts.usdc?.address ?? ZERO_ADDRESS;
const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
] as const;
const COMMUNITY_SOURCE_ABI = [
  "function getActivitiesByRecipient(address recipient) view returns (uint256[])",
  "function getActivity(uint256 activityId) view returns (uint256,address,uint8,string,string,uint256,address,bool)",
  "function moderatorProfiles(address moderator) view returns (string,string,string,bool)",
  "function getModerators() view returns (address[])",
  "function getApplicationsByApplicant(address applicant) view returns (uint256[])",
  "function getApplication(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)",
  "function getPendingApplications() view returns (uint256[])",
  "function awardActivity(address recipient,uint8 activityType,string platform,string evidenceNote)",
  "function claimCredential(uint256 activityId)",
  "function submitApplication(string activityDescription,string evidenceLink,string platform)",
  "function approveApplication(uint256 applicationId,uint8 activityType,string reviewNote)",
  "function rejectApplication(uint256 applicationId,string reviewNote)"
] as const;
const JOB_OPTIONAL_ABI = [
  "function getJobsByClient(address client) view returns (uint256[])",
  "function getJobsByAgent(address agent) view returns (uint256[])",
  "function jobEscrow(uint256 jobId) view returns (uint256)",
  "function approvedAgentCount(uint256 jobId) view returns (uint256)",
  "function maxApprovalsForJob(uint256 jobId) view returns (uint256)",
  "function getSuspicionScore(address agent, uint256 jobId) view returns (uint256,string)",
  "function jobsCreatedByWallet(address wallet) view returns (uint256)",
  "function jobsCompletedByWallet(address wallet) view returns (uint256)"
] as const;

export const expectedChainId = overrideChainId ? Number(overrideChainId) : deployment.chainId;
export const rpcUrl = overrideRpcUrl ?? deployment.rpcUrl ?? fallbackRpcUrl;
export const deploymentNetworkName = deployment.network;
export const contractAddresses = {
  sourceRegistry: deployment.contracts.sourceRegistry?.address ?? ZERO_ADDRESS,
  validationRegistry: deployment.contracts.validationRegistry.address,
  credentialHook: deployment.contracts.credentialHook.address,
  usdc: resolvedUsdcAddress,
  job: resolvedJobContract?.address ?? ZERO_ADDRESS,
  communitySource: deployment.contracts.communitySource?.address ?? ZERO_ADDRESS,
  agentTaskSource: deployment.contracts.agentTaskSource?.address ?? ZERO_ADDRESS,
  peerAttestationSource: deployment.contracts.peerAttestationSource?.address ?? ZERO_ADDRESS,
  daoGovernanceSource: deployment.contracts.daoGovernanceSource?.address ?? ZERO_ADDRESS
} as const;

let readProvider: ethers.JsonRpcProvider | null = null;

export function getDeploymentConfig() {
  return deployment;
}

export function isContractsConfigured(): boolean {
  return (
    !!resolvedJobContract &&
    resolvedJobContract.address !== ZERO_ADDRESS &&
    deployment.contracts.validationRegistry.address !== ZERO_ADDRESS &&
    deployment.contracts.credentialHook.address !== ZERO_ADDRESS
  );
}

function ensureContractsConfigured() {
  if (!isContractsConfigured()) {
    throw new Error("Contracts are not deployed yet. Run contract deployment first.");
  }
}

function toNumber(input: unknown) {
  if (typeof input === "bigint") return Number(input);
  if (typeof input === "number") return input;
  const parsed = Number(input);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toString(input: unknown) {
  if (typeof input === "string") return input;
  return input == null ? "" : String(input);
}

function toBoolean(input: unknown) {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") return input.toLowerCase() === "true";
  return Boolean(input);
}

function sourceTypeKey(value: string) {
  return value.toLowerCase().trim();
}

export function getSourceLabelForDisplay(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return "Job";
  if (normalized === "agent_task") return "Agent Task";
  if (normalized === "community") return "Community";
  if (normalized === "peer_attestation") return "Peer";
  if (normalized === "dao_governance") return "Governance";
  return sourceType;
}

function contractForSourceType(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return resolvedJobContract;
  if (normalized === "community") return deployment.contracts.communitySource;
  if (normalized === "agent_task") return deployment.contracts.agentTaskSource;
  if (normalized === "peer_attestation") return deployment.contracts.peerAttestationSource;
  if (normalized === "dao_governance") return deployment.contracts.daoGovernanceSource;
  return undefined;
}

function normalizeJobStatus(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  return now <= deadline ? 0 : 1;
}

export function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function toDisplayName(address: string) {
  if (!address || address === ZERO_ADDRESS) return "Unknown User";
  return `user-${address.slice(2, 8)}`;
}

export function statusLabel(status: number) {
  return JOB_STATUS_LABELS[status] ?? "Unknown";
}

export function submissionStatusLabel(status: number) {
  return SUBMISSION_STATUS_LABELS[status] ?? "Unknown";
}

export function isJobOpen(job: JobRecord) {
  return job.status === 0;
}

export function formatUsdc(units: string | number | bigint) {
  try {
    const value = typeof units === "bigint" ? units : BigInt(String(units || 0));
    return ethers.formatUnits(value, 6);
  } catch {
    return "0";
  }
}

export function formatTimestamp(ts: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

export function parseJob(rawJob: unknown): JobRecord {
  const candidate = rawJob as Partial<RawJobRecord>;
  const deadline = toNumber(candidate.deadline);
  return {
    jobId: toNumber(candidate.jobId),
    client: toString(candidate.client),
    title: toString(candidate.title),
    description: toString(candidate.description),
    deadline,
    rewardUSDC: toString(candidate.rewardUSDC),
    createdAt: toNumber(candidate.createdAt),
    acceptedCount: toNumber(candidate.acceptedCount),
    submissionCount: toNumber(candidate.submissionCount),
    approvedCount: toNumber(candidate.approvedCount),
    claimedCount: toNumber(candidate.claimedCount),
    paidOutUSDC: toString(candidate.paidOutUSDC),
    refunded: toBoolean(candidate.refunded),
    status: normalizeJobStatus(deadline)
  };
}

export function parseSubmission(rawSubmission: unknown): SubmissionRecord {
  const candidate = rawSubmission as Partial<RawSubmissionRecord>;
  return {
    agent: toString(candidate.agent),
    deliverableLink: toString(candidate.deliverableLink),
    status: toNumber(candidate.status),
    submittedAt: toNumber(candidate.submittedAt),
    reviewerNote: toString(candidate.reviewerNote),
    credentialClaimed: toBoolean(candidate.credentialClaimed),
    allocatedReward: toString(candidate.allocatedReward ?? "0")
  };
}

export function parseCredential(rawCredential: unknown): CredentialRecord {
  const candidate = rawCredential as Partial<RawCredential>;
  return {
    credentialId: toNumber(candidate.credentialId),
    agent: toString(candidate.agent),
    activityId: toNumber(candidate.jobId),
    issuedAt: toNumber(candidate.issuedAt),
    issuedBy: toString(candidate.issuedBy),
    valid: toBoolean(candidate.valid),
    sourceType: toString(candidate.sourceType || "job"),
    weight: Math.max(0, toNumber(candidate.weight) || 100)
  };
}

export function parseAgentTask(rawTask: unknown): AgentTaskRecord {
  const task = rawTask as Record<string, unknown>;
  return {
    taskId: toNumber(task.taskId),
    taskPoster: toString(task.taskPoster),
    assignedAgent: toString(task.assignedAgent),
    taskDescription: toString(task.taskDescription),
    inputData: toString(task.inputData),
    outputHash: toString(task.outputHash),
    rewardUSDC: toString(task.rewardUSDC),
    deadline: toNumber(task.deadline),
    createdAt: toNumber(task.createdAt),
    submittedAt: toNumber(task.submittedAt),
    status: toNumber(task.status),
    rewardClaimed: toBoolean(task.rewardClaimed),
    validatorNote: toString(task.validatorNote)
  };
}

export function parseCommunityActivity(rawActivity: unknown): CommunityActivityRecord {
  const activity = rawActivity as Record<string, unknown> & unknown[];
  return {
    activityId: toNumber(activity.activityId ?? activity[0]),
    recipient: toString(activity.recipient ?? activity[1]),
    activityType: toNumber(activity.activityType ?? activity[2]),
    platform: toString(activity.platform ?? activity[3]),
    evidenceNote: toString(activity.evidenceNote ?? activity[4]),
    issuedAt: toNumber(activity.issuedAt ?? activity[5]),
    issuedBy: toString(activity.issuedBy ?? activity[6]),
    credentialClaimed: toBoolean(activity.credentialClaimed ?? activity[7])
  };
}

export function parseModeratorProfile(rawProfile: unknown, wallet: string): ModeratorProfileRecord {
  const profile = rawProfile as Partial<RawModeratorProfile> & unknown[];
  return {
    wallet,
    name: toString(profile.name ?? profile[0]),
    role: toString(profile.role ?? profile[1]),
    profileURI: toString(profile.profileURI ?? profile[2]),
    active: toBoolean(profile.active ?? profile[3])
  };
}

export function parseCommunityApplication(rawApplication: unknown): CommunityApplicationRecord {
  const application = rawApplication as Partial<RawCommunityApplication> & unknown[];
  return {
    applicationId: toNumber(application.applicationId ?? application[0]),
    applicant: toString(application.applicant ?? application[1]),
    activityDescription: toString(application.activityDescription ?? application[2]),
    evidenceLink: toString(application.evidenceLink ?? application[3]),
    platform: toString(application.platform ?? application[4]),
    submittedAt: toNumber(application.submittedAt ?? application[5]),
    status: toNumber(application.status ?? application[6]),
    reviewedBy: toString(application.reviewedBy ?? application[7]),
    reviewNote: toString(application.reviewNote ?? application[8])
  };
}

export function parseAttestation(rawAttestation: unknown): AttestationRecord {
  const attestation = rawAttestation as Record<string, unknown>;
  return {
    attestationId: toNumber(attestation.attestationId),
    attester: toString(attestation.attester),
    recipient: toString(attestation.recipient),
    category: toString(attestation.category),
    note: toString(attestation.note),
    issuedAt: toNumber(attestation.issuedAt)
  };
}

export function parseGovernanceActivity(rawActivity: unknown): GovernanceActivityRecord {
  const activity = rawActivity as Record<string, unknown>;
  return {
    activityId: toNumber(activity.activityId),
    participant: toString(activity.participant),
    governorContract: toString(activity.governorContract),
    proposalId: toNumber(activity.proposalId),
    credentialClaimed: toBoolean(activity.credentialClaimed),
    claimedAt: toNumber(activity.claimedAt)
  };
}

export function getReadProvider() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readProvider;
}

function getContractFromConfig(
  contractConfig: DeploymentContract | undefined,
  providerOrSigner: ethers.Provider | ethers.Signer
) {
  if (!contractConfig || !contractConfig.address || contractConfig.address === ZERO_ADDRESS) {
    throw new Error("Contract is not configured on this network yet.");
  }
  return new ethers.Contract(
    contractConfig.address,
    contractConfig.abi as ethers.InterfaceAbi,
    providerOrSigner
  );
}

function getCommunityContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.communitySource || contractAddresses.communitySource === ZERO_ADDRESS) {
    throw new Error("Community source contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.communitySource, COMMUNITY_SOURCE_ABI, providerOrSigner);
}

export function getJobReadContract() {
  ensureContractsConfigured();
  return getContractFromConfig(resolvedJobContract, getReadProvider());
}

function getOptionalJobReadContract() {
  if (!contractAddresses.job || contractAddresses.job === ZERO_ADDRESS) {
    throw new Error("Job contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.job, JOB_OPTIONAL_ABI, getReadProvider());
}

export function getRegistryReadContract() {
  ensureContractsConfigured();
  return getContractFromConfig(deployment.contracts.validationRegistry, getReadProvider());
}

export function getSourceReadContract(sourceType: string) {
  const config = contractForSourceType(sourceType);
  return getContractFromConfig(config, getReadProvider());
}

export async function getJobWriteContract(browserProvider: ethers.BrowserProvider) {
  ensureContractsConfigured();
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(resolvedJobContract, signer);
}

export async function getSourceWriteContract(
  browserProvider: ethers.BrowserProvider,
  sourceType: string
) {
  const signer = await browserProvider.getSigner();
  const config = contractForSourceType(sourceType);
  return getContractFromConfig(config, signer);
}

export async function getRegistryWriteContract(browserProvider: ethers.BrowserProvider) {
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(deployment.contracts.validationRegistry, signer);
}

export async function getSourceRegistryWriteContract(browserProvider: ethers.BrowserProvider) {
  if (!deployment.contracts.sourceRegistry) {
    throw new Error("Source registry is not configured on this network.");
  }
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(deployment.contracts.sourceRegistry, signer);
}

export async function fetchAllJobs(): Promise<JobRecord[]> {
  const contract = getJobReadContract();
  try {
    const rawJobs = (await contract.getAllJobs()) as unknown[];
    return rawJobs.map((item) => parseJob(item)).sort((a, b) => b.jobId - a.jobId);
  } catch {
    const nextJobId = Number(await contract.nextJobId());
    const jobs: JobRecord[] = [];
    for (let jobId = 0; jobId < nextJobId; jobId++) {
      try {
        const rawJob = await contract.getJob(jobId);
        jobs.push(parseJob(rawJob));
      } catch {
        // Ignore sparse indexes.
      }
    }
    return jobs.sort((a, b) => b.jobId - a.jobId);
  }
}

export async function fetchJob(jobId: number): Promise<JobRecord | null> {
  try {
    const contract = getJobReadContract();
    const raw = await contract.getJob(jobId);
    return parseJob(raw);
  } catch {
    return null;
  }
}

export async function fetchSubmissionForAgent(
  jobId: number,
  agentAddress: string
): Promise<SubmissionRecord | null> {
  if (!agentAddress) return null;
  try {
    const contract = getJobReadContract();
    const raw = await contract.getSubmission(jobId, agentAddress);
    const parsed = parseSubmission(raw);
    if (!parsed.agent || parsed.agent === ZERO_ADDRESS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchSubmissions(jobId: number): Promise<SubmissionRecord[]> {
  const contract = getJobReadContract();
  const raw = (await contract.getSubmissions(jobId)) as unknown[];
  return raw.map((item) => parseSubmission(item));
}

export async function fetchJobsByClient(clientAddress: string): Promise<JobRecord[]> {
  if (!clientAddress) return [];
  try {
    const optional = getOptionalJobReadContract();
    const ids = (await optional.getJobsByClient(clientAddress)) as unknown[];
    const jobs: JobRecord[] = [];
    for (const id of ids) {
      const job = await fetchJob(toNumber(id));
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.jobId - a.jobId);
  } catch {
    const allJobs = await fetchAllJobs();
    return allJobs
      .filter((job) => job.client.toLowerCase() === clientAddress.toLowerCase())
      .sort((a, b) => b.jobId - a.jobId);
  }
}

export async function fetchJobsByAgent(agentAddress: string): Promise<JobRecord[]> {
  if (!agentAddress) return [];
  try {
    const optional = getOptionalJobReadContract();
    const ids = (await optional.getJobsByAgent(agentAddress)) as unknown[];
    const jobs: JobRecord[] = [];
    for (const id of ids) {
      const job = await fetchJob(toNumber(id));
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.jobId - a.jobId);
  } catch {
    const allJobs = await fetchAllJobs();
    const contract = getJobReadContract();
    const acceptedChecks = await Promise.all(
      allJobs.map(async (job) => {
        try {
          const accepted = (await contract.isAccepted(job.jobId, agentAddress)) as boolean;
          return accepted ? job : null;
        } catch {
          return null;
        }
      })
    );
    return acceptedChecks
      .filter((job): job is JobRecord => Boolean(job))
      .sort((a, b) => b.jobId - a.jobId);
  }
}

export async function fetchJobsCreatedCount(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0;
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.jobsCreatedByWallet(walletAddress));
  } catch {
    const jobs = await fetchJobsByClient(walletAddress);
    return jobs.length;
  }
}

export async function fetchJobsCompletedCount(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0;
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.jobsCompletedByWallet(walletAddress));
  } catch {
    try {
      const registry = getRegistryReadContract();
      return Number(await registry.credentialCount(walletAddress));
    } catch {
      return 0;
    }
  }
}

export async function fetchJobEscrow(jobId: number): Promise<bigint> {
  try {
    const optional = getOptionalJobReadContract();
    return (await optional.jobEscrow(jobId)) as bigint;
  } catch {
    const job = await fetchJob(jobId);
    if (!job) return 0n;
    return BigInt(job.rewardUSDC) - BigInt(job.paidOutUSDC || "0");
  }
}

export async function fetchApprovedAgentCount(jobId: number): Promise<number> {
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.approvedAgentCount(jobId));
  } catch {
    const job = await fetchJob(jobId);
    return job?.approvedCount ?? 0;
  }
}

export async function fetchMaxApprovalsForJob(jobId: number): Promise<number> {
  try {
    const optional = getOptionalJobReadContract();
    const value = (await optional.maxApprovalsForJob(jobId)) as bigint;
    return Number(value);
  } catch {
    return 3;
  }
}

export async function fetchSuspicionScore(
  jobId: number,
  agentAddress: string
): Promise<SuspicionResult> {
  try {
    const optional = getOptionalJobReadContract();
    const result = (await optional.getSuspicionScore(agentAddress, jobId)) as [bigint, string];
    return { score: Number(result[0]), reason: result[1] };
  } catch {
    const [job, submission] = await Promise.all([
      fetchJob(jobId),
      fetchSubmissionForAgent(jobId, agentAddress)
    ]);
    if (!job || !submission || !submission.submittedAt) {
      return { score: 0, reason: "" };
    }
    let score = 0;
    let reason = "";
    const timeToComplete = submission.submittedAt - job.createdAt;
    if (timeToComplete > 0 && timeToComplete < 2 * 60 * 60) {
      score += 30;
      reason = "submission too fast; ";
    }
    return { score, reason };
  }
}

export async function fetchOpenAgentTasks(): Promise<AgentTaskRecord[]> {
  if (!deployment.contracts.agentTaskSource || deployment.contracts.agentTaskSource.address === ZERO_ADDRESS) {
    return [];
  }

  const contract = getSourceReadContract("agent_task");
  const nextTaskId = Number(await contract.nextTaskId());
  const tasks: AgentTaskRecord[] = [];
  for (let taskId = 0; taskId < nextTaskId; taskId++) {
    try {
      const rawTask = await contract.tasks(taskId);
      const parsed = parseAgentTask(rawTask);
      if (parsed.taskPoster !== ZERO_ADDRESS) {
        tasks.push(parsed);
      }
    } catch {
      // Ignore sparse indexes.
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchAgentTasksByAddress(agentAddress: string): Promise<AgentTaskRecord[]> {
  if (!agentAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  let taskIds: unknown[] = [];
  let usedIndexedRead = false;
  try {
    taskIds = (await (
      contract as unknown as {
        getTasksByAgent: (address: string) => Promise<unknown[]>;
      }
    ).getTasksByAgent(agentAddress)) as unknown[];
    usedIndexedRead = true;
  } catch {
    // Fallback for older deployments below.
  }

  const tasks: AgentTaskRecord[] = [];
  if (usedIndexedRead) {
    for (const taskId of taskIds) {
      const rawTask = await contract.tasks(taskId);
      tasks.push(parseAgentTask(rawTask));
    }
  } else {
    const nextTaskId = Number(await contract.nextTaskId());
    for (let taskId = 0; taskId < nextTaskId; taskId++) {
      const rawTask = await contract.tasks(taskId);
      const task = parseAgentTask(rawTask);
      if (task.assignedAgent.toLowerCase() === agentAddress.toLowerCase()) {
        tasks.push(task);
      }
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchPosterTasksByAddress(posterAddress: string): Promise<AgentTaskRecord[]> {
  if (!posterAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  let taskIds: unknown[] = [];
  let usedIndexedRead = false;
  try {
    taskIds = (await (
      contract as unknown as {
        getTasksByPoster: (address: string) => Promise<unknown[]>;
      }
    ).getTasksByPoster(posterAddress)) as unknown[];
    usedIndexedRead = true;
  } catch {
    // Fallback for older deployments below.
  }

  const tasks: AgentTaskRecord[] = [];
  if (usedIndexedRead) {
    for (const taskId of taskIds) {
      const rawTask = await contract.tasks(taskId);
      tasks.push(parseAgentTask(rawTask));
    }
  } else {
    const nextTaskId = Number(await contract.nextTaskId());
    for (let taskId = 0; taskId < nextTaskId; taskId++) {
      const rawTask = await contract.tasks(taskId);
      const task = parseAgentTask(rawTask);
      if (task.taskPoster.toLowerCase() === posterAddress.toLowerCase()) {
        tasks.push(task);
      }
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchCommunityActivitiesByRecipient(
  recipientAddress: string
): Promise<CommunityActivityRecord[]> {
  if (!recipientAddress || !deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const activityIds = (await contract.getActivitiesByRecipient(recipientAddress)) as unknown[];
  const activities: CommunityActivityRecord[] = [];
  for (const activityId of activityIds) {
    const raw = await contract.getActivity(activityId);
    activities.push(parseCommunityActivity(raw));
  }
  return activities.sort((a, b) => b.activityId - a.activityId);
}

export async function fetchCommunityModerators(): Promise<ModeratorProfileRecord[]> {
  if (!deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const moderatorAddresses = (await contract.getModerators()) as string[];
  const profiles = await Promise.all(
    moderatorAddresses.map(async (wallet) => parseModeratorProfile(await contract.moderatorProfiles(wallet), wallet))
  );
  return profiles.filter((profile) => profile.active);
}

export async function fetchCommunityModeratorProfile(
  walletAddress: string
): Promise<ModeratorProfileRecord | null> {
  if (!walletAddress || !deployment.contracts.communitySource) return null;
  const contract = getCommunityContract(getReadProvider());
  try {
    const raw = await contract.moderatorProfiles(walletAddress);
    const parsed = parseModeratorProfile(raw, walletAddress);
    if (!parsed.wallet || parsed.wallet === ZERO_ADDRESS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchCommunityApplicationsByApplicant(
  applicantAddress: string
): Promise<CommunityApplicationRecord[]> {
  if (!applicantAddress || !deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const ids = (await contract.getApplicationsByApplicant(applicantAddress)) as unknown[];
  const applications: CommunityApplicationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.getApplication(id);
    applications.push(parseCommunityApplication(raw));
  }
  return applications.sort((a, b) => b.applicationId - a.applicationId);
}

export async function fetchPendingCommunityApplications(): Promise<CommunityApplicationRecord[]> {
  if (!deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const ids = (await contract.getPendingApplications()) as unknown[];
  const applications: CommunityApplicationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.getApplication(id);
    applications.push(parseCommunityApplication(raw));
  }
  return applications.sort((a, b) => b.applicationId - a.applicationId);
}

export async function fetchPeerAttestationsForRecipient(recipientAddress: string): Promise<AttestationRecord[]> {
  if (!recipientAddress || !deployment.contracts.peerAttestationSource) return [];
  const contract = getSourceReadContract("peer_attestation");
  const ids = (await contract.attestationsReceivedByAddress(recipientAddress)) as unknown[];
  const list: AttestationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.attestations(id);
    list.push(parseAttestation(raw));
  }
  return list.sort((a, b) => b.attestationId - a.attestationId);
}

export async function fetchPeerAttestationsGiven(attesterAddress: string): Promise<AttestationRecord[]> {
  if (!attesterAddress || !deployment.contracts.peerAttestationSource) return [];
  const contract = getSourceReadContract("peer_attestation");
  const ids = (await contract.attestationsGivenByAddress(attesterAddress)) as unknown[];
  const list: AttestationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.attestations(id);
    list.push(parseAttestation(raw));
  }
  return list.sort((a, b) => b.attestationId - a.attestationId);
}

export async function fetchGovernanceActivitiesByParticipant(
  participantAddress: string
): Promise<GovernanceActivityRecord[]> {
  if (!participantAddress || !deployment.contracts.daoGovernanceSource) return [];
  const contract = getSourceReadContract("dao_governance");
  const ids = (await contract.activitiesByParticipant(participantAddress)) as unknown[];
  const list: GovernanceActivityRecord[] = [];
  for (const id of ids) {
    const raw = await contract.activities(id);
    list.push(parseGovernanceActivity(raw));
  }
  return list.sort((a, b) => b.activityId - a.activityId);
}

export async function fetchCredentialsForAgent(agentAddress: string): Promise<CredentialRecord[]> {
  if (!agentAddress) return [];

  const registry = getRegistryReadContract();
  const credentialIds = (await registry.getCredentials(agentAddress)) as unknown[];
  const credentials: CredentialRecord[] = [];

  for (const credentialId of credentialIds) {
    const rawCredential = await registry.getCredential(credentialId);
    const parsed = parseCredential(rawCredential);
    parsed.metadata = await fetchCredentialMetadata(parsed);
    credentials.push(parsed);
  }

  return credentials.sort((a, b) => b.issuedAt - a.issuedAt);
}

export async function fetchCredentialMetadata(
  credential: CredentialRecord
): Promise<Record<string, string | number> | undefined> {
  try {
    const normalizedSourceType = sourceTypeKey(credential.sourceType);
    if (normalizedSourceType === "job") {
      const job = await fetchJob(credential.activityId);
      if (!job) return undefined;
      return {
        title: job.title,
        client: shortAddress(job.client),
        rewardUSDC: formatUsdc(job.rewardUSDC),
        deadline: formatTimestamp(job.deadline)
      };
    }
    if (normalizedSourceType === "community") {
      const contract = getSourceReadContract("community");
      const activity = parseCommunityActivity(await contract.getActivity(credential.activityId));
      return {
        platform: activity.platform,
        activityType: String(activity.activityType),
        evidenceNote: activity.evidenceNote
      };
    }
    if (normalizedSourceType === "agent_task") {
      const contract = getSourceReadContract("agent_task");
      const task = parseAgentTask(await contract.tasks(credential.activityId));
      return {
        description: task.taskDescription,
        rewardUSDC: formatUsdc(task.rewardUSDC),
        deadline: formatTimestamp(task.deadline)
      };
    }
    if (normalizedSourceType === "peer_attestation") {
      const contract = getSourceReadContract("peer_attestation");
      const attestation = parseAttestation(await contract.attestations(credential.activityId));
      return {
        attester: shortAddress(attestation.attester),
        category: attestation.category,
        note: attestation.note
      };
    }
    if (normalizedSourceType === "dao_governance") {
      const contract = getSourceReadContract("dao_governance");
      const activity = parseGovernanceActivity(await contract.activities(credential.activityId));
      return {
        governorContract: shortAddress(activity.governorContract),
        proposalId: activity.proposalId
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function verifyCredentialOnChain(
  agent: string,
  activityId: number,
  sourceType = "job",
  provider?: ethers.Provider
) {
  const registryConfig = deployment.contracts.validationRegistry;
  const registry = getContractFromConfig(registryConfig, provider ?? getReadProvider());
  if (sourceTypeKey(sourceType) === "job") {
    return (await registry.hasCredential(agent, activityId)) as boolean;
  }
  return (await registry.hasCredentialForSource(agent, activityId, sourceType)) as boolean;
}

export async function txCreateJob(
  browserProvider: ethers.BrowserProvider,
  title: string,
  description: string,
  deadline: number,
  rewardUSDC: bigint,
  maxApprovals: number
) {
  const contract = await getJobWriteContract(browserProvider);
  try {
    const tx = await contract.createJob(title, description, deadline, rewardUSDC, maxApprovals);
    return tx as ethers.TransactionResponse;
  } catch {
    const tx = await contract.createJob(title, description, deadline, rewardUSDC);
    return tx as ethers.TransactionResponse;
  }
}

export async function txAcceptJob(browserProvider: ethers.BrowserProvider, jobId: number) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.acceptJob(jobId)) as ethers.TransactionResponse;
}

export async function txSubmitDeliverable(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  deliverableLink: string
) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.submitDeliverable(jobId, deliverableLink)) as ethers.TransactionResponse;
}

export async function txApproveSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string,
  rewardAmount: bigint
) {
  const contract = await getJobWriteContract(browserProvider);
  try {
    return (await contract.approveSubmission(jobId, agent, rewardAmount)) as ethers.TransactionResponse;
  } catch {
    return (await contract.approveSubmission(jobId, agent)) as ethers.TransactionResponse;
  }
}

export async function txRejectSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string,
  reason: string
) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.rejectSubmission(jobId, agent, reason)) as ethers.TransactionResponse;
}

export async function txClaimJobCredential(browserProvider: ethers.BrowserProvider, jobId: number) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.claimCredential(jobId)) as ethers.TransactionResponse;
}

export async function txAwardCommunityActivity(
  browserProvider: ethers.BrowserProvider,
  recipient: string,
  activityType: number,
  platform: string,
  evidenceNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.awardActivity(
    recipient,
    activityType,
    platform,
    evidenceNote
  )) as ethers.TransactionResponse;
}

export async function txClaimCommunityCredential(
  browserProvider: ethers.BrowserProvider,
  activityId: number
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.claimCredential(activityId)) as ethers.TransactionResponse;
}

export async function txSubmitCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  activityDescription: string,
  evidenceLink: string,
  platform: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.submitApplication(
    activityDescription,
    evidenceLink,
    platform
  )) as ethers.TransactionResponse;
}

export async function txApproveCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  applicationId: number,
  activityType: number,
  reviewNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.approveApplication(
    applicationId,
    activityType,
    reviewNote
  )) as ethers.TransactionResponse;
}

export async function txRejectCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  applicationId: number,
  reviewNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.rejectApplication(applicationId, reviewNote)) as ethers.TransactionResponse;
}

export async function txPostAgentTask(
  browserProvider: ethers.BrowserProvider,
  taskDescription: string,
  inputData: string,
  deadline: number,
  rewardUSDC: bigint
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.postTask(taskDescription, inputData, deadline, rewardUSDC)) as ethers.TransactionResponse;
}

export async function txClaimAgentTask(browserProvider: ethers.BrowserProvider, taskId: number) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.claimTask(taskId)) as ethers.TransactionResponse;
}

export async function txSubmitTaskOutput(
  browserProvider: ethers.BrowserProvider,
  taskId: number,
  outputHash: string
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.submitOutput(taskId, outputHash)) as ethers.TransactionResponse;
}

export async function txValidateTaskOutput(
  browserProvider: ethers.BrowserProvider,
  taskId: number,
  approved: boolean,
  validatorNote: string
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.validateOutput(taskId, approved, validatorNote)) as ethers.TransactionResponse;
}

export async function txClaimTaskRewardAndCredential(
  browserProvider: ethers.BrowserProvider,
  taskId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.claimRewardAndCredential(taskId)) as ethers.TransactionResponse;
}

export async function txRefundExpiredTask(browserProvider: ethers.BrowserProvider, taskId: number) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.refundExpiredTask(taskId)) as ethers.TransactionResponse;
}

export async function txPeerAttest(
  browserProvider: ethers.BrowserProvider,
  recipient: string,
  category: string,
  note: string
) {
  const contract = await getSourceWriteContract(browserProvider, "peer_attestation");
  return (await contract.attest(recipient, category, note)) as ethers.TransactionResponse;
}

export async function txClaimGovernanceCredential(
  browserProvider: ethers.BrowserProvider,
  governorContract: string,
  proposalId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "dao_governance");
  return (await contract.claimGovernanceCredential(
    governorContract,
    proposalId
  )) as ethers.TransactionResponse;
}

export async function txApproveUsdcIfNeeded(
  browserProvider: ethers.BrowserProvider,
  spender: string,
  amount: bigint
) {
  if (!resolvedUsdcAddress || resolvedUsdcAddress === ZERO_ADDRESS) {
    return null;
  }
  const signer = await browserProvider.getSigner();
  const usdc = deployment.contracts.usdc
    ? getContractFromConfig(deployment.contracts.usdc, signer)
    : new ethers.Contract(resolvedUsdcAddress, ERC20_MIN_ABI, signer);
  const ownerAddress = await signer.getAddress();
  const allowance = (await usdc.allowance(ownerAddress, spender)) as bigint;
  if (allowance >= amount) {
    return null;
  }
  const tx = (await usdc.approve(spender, amount)) as ethers.TransactionResponse;
  return tx;
}

export async function isApprovedSourceOperator(sourceType: string, operator: string): Promise<boolean> {
  if (!deployment.contracts.sourceRegistry || !operator) return false;
  const contract = getContractFromConfig(deployment.contracts.sourceRegistry, getReadProvider());
  return (await contract.isApprovedFor(sourceType, operator)) as boolean;
}

export async function txApplyToOperate(
  browserProvider: ethers.BrowserProvider,
  sourceType: string,
  profileURI: string
) {
  const contract = await getSourceRegistryWriteContract(browserProvider);
  return (await contract.applyToOperate(sourceType, profileURI)) as ethers.TransactionResponse;
}
