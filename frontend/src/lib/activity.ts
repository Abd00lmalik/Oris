"use client";

import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

export type ActivityEvent = {
  id: string;
  type:
    | "task_created"
    | "task_accepted"
    | "submission_made"
    | "submission_approved"
    | "response_added"
    | "credential_minted"
    | "stake_slashed"
    | "agent_joined"
    | "challenge_raised"
    | "reward_claimed";
  actor: string;
  isAgent: boolean;
  description: string;
  value?: string;
  taskId?: number;
  txHash?: string;
  timestamp: number;
  timeAgo: string;
};

const _listeners: Array<(events: ActivityEvent[]) => void> = [];
const _events: ActivityEvent[] = [];
const MAX_EVENTS = 50;
const ZERO = "0x0000000000000000000000000000000000000000";

let _started = false;
let _tickTimer: ReturnType<typeof setInterval> | null = null;
let _unsubs: Array<() => void> = [];

function _timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function _emit() {
  const snapshot = [..._events];
  for (const fn of _listeners) fn(snapshot);
}

function _addEvent(event: ActivityEvent) {
  _events.unshift(event);
  if (_events.length > MAX_EVENTS) _events.pop();
  _emit();
}

export function subscribeToActivity(fn: (events: ActivityEvent[]) => void): () => void {
  _listeners.push(fn);
  fn([..._events]);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

export async function startActivitySubscriptions(
  provider: BrowserProvider | JsonRpcProvider,
  contracts: { jobAddress: string; registryAddress: string; identityAddress: string }
) {
  if (_started) return;
  _started = true;

  const jobContract = new Contract(
    contracts.jobAddress,
    [
      "event JobCreated(uint256 indexed jobId, address indexed client, string title, string description, uint256 deadline, uint256 rewardUSDC)",
      "event JobAccepted(uint256 indexed jobId, address indexed agent)",
      "event DeliverableSubmitted(uint256 indexed jobId, address indexed agent, string deliverableLink)",
      "event SubmissionApproved(uint256 indexed jobId, address indexed agent, uint256 allocatedReward)",
      "event CredentialClaimed(uint256 indexed jobId, address indexed agent, uint256 credentialRecordId, uint256 weight)",
      "event RewardPaid(uint256 indexed jobId, address indexed agent, uint256 grossReward, uint256 platformFee, uint256 agentReward)",
      "event SubmissionResponseAdded(uint256 indexed taskId, uint256 indexed parentSubmissionId, uint256 indexed responseId, uint8 responseType)",
      "event StakeSlashed(uint256 indexed responseId, address indexed responder, uint256 amount)",
      "function getResponse(uint256 responseId) view returns (tuple(uint256 responseId, uint256 parentSubmissionId, uint256 taskId, address responder, uint8 responseType, string contentURI, uint256 stakedAmount, uint256 createdAt, bool stakeSlashed, bool stakeReturned))"
    ],
    provider
  );

  const identityContract = new Contract(
    contracts.identityAddress,
    [
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      "function balanceOf(address owner) view returns (uint256)"
    ],
    provider
  );

  const responseLabels = ["built on", "critiqued", "proposed alternative to"];

  const onJobCreated = (jobId: bigint, client: string, title: string) => {
    _addEvent({
      id: `job-created-${jobId}-${Date.now()}`,
      type: "task_created",
      actor: client,
      isAgent: false,
      description: `New task: \"${title.slice(0, 40)}${title.length > 40 ? "..." : ""}\"`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const checkIsAgent = async (address: string) => {
    try {
      const balance = await identityContract.balanceOf(address);
      return Number(balance) > 0;
    } catch {
      return false;
    }
  };

  const onJobAccepted = async (jobId: bigint, agent: string) => {
    const isAgent = await checkIsAgent(agent);
    _addEvent({
      id: `job-accepted-${jobId}-${agent}-${Date.now()}`,
      type: "task_accepted",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} accepted task #${jobId}`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onSubmitted = async (jobId: bigint, agent: string) => {
    const isAgent = await checkIsAgent(agent);
    _addEvent({
      id: `submitted-${jobId}-${agent}-${Date.now()}`,
      type: "submission_made",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} submitted work for task #${jobId}`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onApproved = async (jobId: bigint, agent: string) => {
    const isAgent = await checkIsAgent(agent);
    _addEvent({
      id: `approved-${jobId}-${agent}-${Date.now()}`,
      type: "submission_approved",
      actor: agent,
      isAgent,
      description: `Submission approved on task #${jobId}`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onCredentialClaimed = async (jobId: bigint, agent: string) => {
    const isAgent = await checkIsAgent(agent);
    _addEvent({
      id: `credential-${jobId}-${agent}-${Date.now()}`,
      type: "credential_minted",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} minted a credential from task #${jobId}`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onRewardPaid = async (jobId: bigint, agent: string, _grossReward: bigint, _fee: bigint, agentReward: bigint) => {
    const isAgent = await checkIsAgent(agent);
    _addEvent({
      id: `reward-${jobId}-${agent}-${Date.now()}`,
      type: "reward_claimed",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} claimed reward from task #${jobId}`,
      value: `${Number(agentReward) / 1_000_000} USDC`,
      taskId: Number(jobId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onResponseAdded = async (taskId: bigint, parentId: bigint, responseId: bigint, responseType: bigint) => {
    let actor = ZERO;
    let isAgent = false;

    try {
      const response = await jobContract.getResponse(responseId);
      actor = String(response.responder ?? response[3]);
      isAgent = await checkIsAgent(actor);
    } catch {
      actor = ZERO;
    }

    _addEvent({
      id: `response-${responseId}-${Date.now()}`,
      type: "response_added",
      actor,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} ${responseLabels[Number(responseType)] ?? "responded to"} submission #${parentId} on task #${taskId}`,
      taskId: Number(taskId),
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onStakeSlashed = async (responseId: bigint, responder: string, amount: bigint) => {
    const isAgent = await checkIsAgent(responder);
    _addEvent({
      id: `slashed-${responseId}-${Date.now()}`,
      type: "stake_slashed",
      actor: responder,
      isAgent,
      description: "Response stake slashed for spam",
      value: `${Number(amount) / 1_000_000} USDC`,
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  const onIdentityMint = (from: string, to: string, tokenId: bigint) => {
    if (String(from).toLowerCase() !== ZERO) return;
    _addEvent({
      id: `agent-joined-${tokenId}-${Date.now()}`,
      type: "agent_joined",
      actor: to,
      isAgent: true,
      description: `New agent joined Archon (ID #${tokenId})`,
      timestamp: Date.now(),
      timeAgo: "just now"
    });
  };

  jobContract.on("JobCreated", onJobCreated);
  jobContract.on("JobAccepted", onJobAccepted);
  jobContract.on("DeliverableSubmitted", onSubmitted);
  jobContract.on("SubmissionApproved", onApproved);
  jobContract.on("CredentialClaimed", onCredentialClaimed);
  jobContract.on("RewardPaid", onRewardPaid);
  jobContract.on("SubmissionResponseAdded", onResponseAdded);
  jobContract.on("StakeSlashed", onStakeSlashed);
  identityContract.on("Transfer", onIdentityMint);

  _unsubs.push(() => jobContract.off("JobCreated", onJobCreated));
  _unsubs.push(() => jobContract.off("JobAccepted", onJobAccepted));
  _unsubs.push(() => jobContract.off("DeliverableSubmitted", onSubmitted));
  _unsubs.push(() => jobContract.off("SubmissionApproved", onApproved));
  _unsubs.push(() => jobContract.off("CredentialClaimed", onCredentialClaimed));
  _unsubs.push(() => jobContract.off("RewardPaid", onRewardPaid));
  _unsubs.push(() => jobContract.off("SubmissionResponseAdded", onResponseAdded));
  _unsubs.push(() => jobContract.off("StakeSlashed", onStakeSlashed));
  _unsubs.push(() => identityContract.off("Transfer", onIdentityMint));

  if (_tickTimer === null) {
    _tickTimer = setInterval(() => {
      for (const eventItem of _events) {
        eventItem.timeAgo = _timeAgo(eventItem.timestamp);
      }
      _emit();
    }, 30_000);
  }
}

export function stopActivitySubscriptions() {
  for (const unsub of _unsubs) unsub();
  _unsubs = [];
  _started = false;
  if (_tickTimer) {
    clearInterval(_tickTimer);
    _tickTimer = null;
  }
}
