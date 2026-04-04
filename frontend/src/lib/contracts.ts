import { ethers } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const JOB_STATUS_LABELS = ["Open", "Deadline Reached"] as const;
export const SUBMISSION_STATUS_LABELS = ["Not Submitted", "Submitted", "Approved", "Rejected"] as const;

type DeploymentContract = {
  address: string;
  abi: unknown[];
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl: string;
  contracts: {
    validationRegistry: DeploymentContract;
    credentialHook: DeploymentContract;
    job: DeploymentContract;
  };
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
  status: number;
};

export type SubmissionRecord = {
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: number;
  reviewerNote: string;
  credentialClaimed: boolean;
};

export type CredentialRecord = {
  credentialId: number;
  agent: string;
  jobId: number;
  issuedAt: number;
  issuedBy: string;
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
};

type RawSubmissionRecord = {
  agent: unknown;
  deliverableLink: unknown;
  status: unknown;
  submittedAt: unknown;
  reviewerNote: unknown;
  credentialClaimed: unknown;
};

const deployment = deploymentRaw as DeploymentConfig;
const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID;

export const expectedChainId = overrideChainId ? Number(overrideChainId) : deployment.chainId;
export const rpcUrl = overrideRpcUrl ?? deployment.rpcUrl;
export const deploymentNetworkName = deployment.network;
export const contractAddresses = {
  validationRegistry: deployment.contracts.validationRegistry.address,
  credentialHook: deployment.contracts.credentialHook.address,
  job: deployment.contracts.job.address
} as const;

let readProvider: ethers.JsonRpcProvider | null = null;

export function getDeploymentConfig() {
  return deployment;
}

export function isContractsConfigured(): boolean {
  return (
    deployment.contracts.job.address !== ZERO_ADDRESS &&
    deployment.contracts.validationRegistry.address !== ZERO_ADDRESS &&
    deployment.contracts.credentialHook.address !== ZERO_ADDRESS
  );
}

function ensureContractsConfigured() {
  if (!isContractsConfigured()) {
    throw new Error("Contracts are not deployed yet. Start with `npm run dev` in the project root.");
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

function jobStatusFromDeadline(deadline: number) {
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
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function hashDeliverable(input: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(input.trim()));
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
    status: jobStatusFromDeadline(deadline)
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
    credentialClaimed: toBoolean(candidate.credentialClaimed)
  };
}

export function parseCredential(agent: string, rawJobId: unknown): CredentialRecord {
  const jobId = toNumber(rawJobId);
  return {
    credentialId: jobId,
    agent,
    jobId,
    issuedAt: 0,
    issuedBy: contractAddresses.credentialHook
  };
}

export function getReadProvider() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readProvider;
}

export function getJobReadContract() {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.job.address,
    deployment.contracts.job.abi as ethers.InterfaceAbi,
    getReadProvider()
  );
}

export function getValidationRegistryReadContract() {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.validationRegistry.address,
    deployment.contracts.validationRegistry.abi as ethers.InterfaceAbi,
    getReadProvider()
  );
}

export function getValidationRegistryVerificationContract(provider?: ethers.Provider) {
  ensureContractsConfigured();
  return new ethers.Contract(
    deployment.contracts.validationRegistry.address,
    [
      "function hasCredential(address agent, uint256 jobId) view returns (bool)",
      "function getCredentials(address agent) view returns (uint256[])"
    ],
    provider ?? getReadProvider()
  );
}

export async function getJobWriteContract(browserProvider: ethers.BrowserProvider) {
  ensureContractsConfigured();
  const signer = await browserProvider.getSigner();
  return new ethers.Contract(
    deployment.contracts.job.address,
    deployment.contracts.job.abi as ethers.InterfaceAbi,
    signer
  );
}

export async function verifyCredentialOnChain(agent: string, jobId: number, provider?: ethers.Provider) {
  const registry = getValidationRegistryVerificationContract(provider);
  try {
    return (await registry.hasCredential(agent, jobId)) as boolean;
  } catch {
    const jobIds = (await registry.getCredentials(agent)) as bigint[];
    return jobIds.some((value) => Number(value) === jobId);
  }
}
