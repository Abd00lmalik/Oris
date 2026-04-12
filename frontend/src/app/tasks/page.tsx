"use client";

import Link from "next/link";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentTaskRecord,
  contractAddresses,
  expectedChainId,
  fetchAgentTaskCredentialCooldownSeconds,
  fetchAgentTasksByAddress,
  fetchLastAgentTaskCredentialClaim,
  fetchOpenAgentTasks,
  fetchPosterTasksByAddress,
  fetchUsdcAllowance,
  fetchUsdcBalance,
  formatTimestamp,
  formatUsdc,
  parseUSDC,
  txApproveUsdc,
  txClaimTaskRewardAndCredential,
  txPostAgentTask,
  txSubmitTaskOutput,
  txValidateTaskOutput
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type TasksTab = "available" | "mine" | "posted" | "post";

type TaskMeta = {
  title: string;
  description: string;
  outputFormat: string;
  validationCriteria: string;
};

const MIN_TASK_REWARD = 5;
const PLATFORM_FEE_BPS = 1000;
const MIN_DEADLINE_SECONDS = 3600;

const EXAMPLE_TASKS = [
  {
    title: "Extract unique senders from USDC transfers",
    description:
      "Read the JSON transaction log and return a list of unique wallet addresses and the total USDC they sent.",
    inputData: "ipfs://QmTransactionLog",
    outputFormat: "JSON array of {address, totalSent} objects",
    validationCriteria: "Verify all addresses are unique, sorted by total sent, and JSON is valid.",
    reward: "35",
    deadlineOffsetHours: 24
  },
  {
    title: "Summarize this protocol whitepaper",
    description:
      "Read the whitepaper and produce 10 bullet points that summarize the protocol, key risks, and architecture.",
    inputData: "ipfs://QmWhitepaper",
    outputFormat: "Plain text summary with 10 bullet points",
    validationCriteria: "Check for clarity, accuracy, and that all 10 bullets are present.",
    reward: "20",
    deadlineOffsetHours: 12
  },
  {
    title: "Write unit tests for this Solidity contract",
    description:
      "Create a Hardhat test file that covers every public function and all revert paths.",
    inputData: "https://github.com/your-repo/contract.sol",
    outputFormat: "Hardhat test file (.ts or .js)",
    validationCriteria: "Tests must compile and cover all public functions with assertions.",
    reward: "75",
    deadlineOffsetHours: 48
  }
];

function parseToUnix(value: string) {
  if (!value) return 0;
  return Math.floor(new Date(value).getTime() / 1000);
}

function parseTaskDescription(raw: string): TaskMeta {
  const lines = raw.split("\n").map((line) => line.trim());
  const lookup = (prefix: string) => {
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
    return line ? line.slice(prefix.length).trim() : "";
  };

  const title = lookup("Title:");
  const description = lookup("Description:");
  const outputFormat = lookup("Output Format:");
  const validationCriteria = lookup("Validation Criteria:");

  if (title || description || outputFormat) {
    return {
      title: title || "Agentic Task",
      description: description || raw,
      outputFormat: outputFormat || "Not specified",
      validationCriteria: validationCriteria || ""
    };
  }

  const fallbackSplit = raw.split(" - ");
  if (fallbackSplit.length > 1) {
    return {
      title: fallbackSplit[0],
      description: fallbackSplit.slice(1).join(" - "),
      outputFormat: "Not specified",
      validationCriteria: ""
    };
  }

  return {
    title: "Agentic Task",
    description: raw,
    outputFormat: "Not specified",
    validationCriteria: ""
  };
}

function buildTaskDescription(meta: TaskMeta) {
  const lines = [
    `Title: ${meta.title}`,
    `Description: ${meta.description}`,
    `Output Format: ${meta.outputFormat}`
  ];
  if (meta.validationCriteria.trim()) {
    lines.push(`Validation Criteria: ${meta.validationCriteria}`);
  }
  return lines.join("\n");
}

function formatRemaining(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Closed";
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (hours <= 0) return `${minutes}m remaining`;
  return `${hours}h ${minutes}m remaining`;
}

function formatRemainingDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function externalLink(url: string, label: string) {
  const trimmed = url.trim();
  if (!trimmed) return "—";
  return (
    <a
      href={trimmed}
      target="_blank"
      rel="noreferrer"
      className="text-[#8FD9FF] underline underline-offset-4"
    >
      {label}
    </a>
  );
}
export default function TasksPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<TasksTab>("available");
  const [openTasks, setOpenTasks] = useState<AgentTaskRecord[]>([]);
  const [myTasks, setMyTasks] = useState<AgentTaskRecord[]>([]);
  const [postedTasks, setPostedTasks] = useState<AgentTaskRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [postedTaskId, setPostedTaskId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const [outputByTask, setOutputByTask] = useState<Record<number, string>>({});
  const [reviewNoteByTask, setReviewNoteByTask] = useState<Record<number, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [inputData, setInputData] = useState("");
  const [outputFormat, setOutputFormat] = useState("");
  const [validationCriteria, setValidationCriteria] = useState("");
  const [postReward, setPostReward] = useState("10");
  const [postDeadline, setPostDeadline] = useState("");
  const [posting, setPosting] = useState(false);
  const [approvingUsdc, setApprovingUsdc] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [usdcAllowance, setUsdcAllowance] = useState<bigint>(0n);
  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const open = await fetchOpenAgentTasks();
      setOpenTasks(open.filter((task) => task.status === 0));

      if (account) {
        const [mine, posted] = await Promise.all([
          fetchAgentTasksByAddress(account),
          fetchPosterTasksByAddress(account)
        ]);
        setMyTasks(mine);
        setPostedTasks(posted);
      } else {
        setMyTasks([]);
        setPostedTasks([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let active = true;
    const loadUsdcState = async () => {
      if (!account) {
        setUsdcBalance(0n);
        setUsdcAllowance(0n);
        return;
      }
      try {
        const [balance, allowance] = await Promise.all([
          fetchUsdcBalance(account),
          fetchUsdcAllowance(account, contractAddresses.agentTaskSource)
        ]);
        if (!active) return;
        setUsdcBalance(balance);
        setUsdcAllowance(allowance);
      } catch {
        if (!active) return;
        setUsdcBalance(0n);
        setUsdcAllowance(0n);
      }
    };
    void loadUsdcState();
    return () => {
      active = false;
    };
  }, [account, postReward, status]);

  useEffect(() => {
    let active = true;
    const loadCooldown = async () => {
      if (!account) {
        setClaimReadyAt(null);
        return;
      }
      try {
        const [lastClaim, cooldown] = await Promise.all([
          fetchLastAgentTaskCredentialClaim(account),
          fetchAgentTaskCredentialCooldownSeconds()
        ]);
        if (!active) return;
        setClaimReadyAt(Number(lastClaim) + cooldown);
      } catch {
        if (!active) return;
        setClaimReadyAt(null);
      }
    };
    void loadCooldown();
    return () => {
      active = false;
    };
  }, [account, status]);

  useEffect(() => {
    if (!claimReadyAt) {
      setClaimCountdown(0);
      return () => undefined;
    }
    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      setClaimCountdown(Math.max(0, claimReadyAt - now));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [claimReadyAt]);

  const postRewardUnits = useMemo(() => {
    try {
      return parseUSDC(postReward || "0");
    } catch {
      return 0n;
    }
  }, [postReward]);

  const needsUsdcApproval = postRewardUnits > 0n && usdcAllowance < postRewardUnits;
  const netReward = postRewardUnits - (postRewardUnits * BigInt(PLATFORM_FEE_BPS)) / 10000n;
  const feeAmount = postRewardUnits - netReward;

  const inProgressTasks = useMemo(() => myTasks.filter((task) => task.status === 1 || task.status === 4), [myTasks]);
  const awaitingTasks = useMemo(() => myTasks.filter((task) => task.status === 2), [myTasks]);
  const validatedTasks = useMemo(() => myTasks.filter((task) => task.status === 3 && !task.rewardClaimed), [myTasks]);
  const completedTasks = useMemo(() => myTasks.filter((task) => task.rewardClaimed), [myTasks]);

  const withConnectedProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };


  const handleSubmitOutput = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    const output = outputByTask[taskId]?.trim() ?? "";
    if (!output) {
      setError("Output link or CID is required.");
      setBusyTaskId(null);
      return;
    }

    try {
      const provider = await withConnectedProvider();
      const tx = await txSubmitTaskOutput(provider, taskId, output);
      setStatus(`Submit output transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Output submitted for task #${taskId}.`);
      setOutputByTask((previous) => ({ ...previous, [taskId]: "" }));
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit output.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleClaimReward = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    try {
      if (claimCountdown > 0) {
        throw new Error(`Claim available in: ${formatRemainingDuration(claimCountdown)}`);
      }
      const provider = await withConnectedProvider();
      const tx = await txClaimTaskRewardAndCredential(provider, taskId);
      setStatus(`Claim reward transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`USDC and credential claimed for task #${taskId}.`);
      await loadData();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim reward.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleValidateOutput = async (taskId: number, approved: boolean) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    try {
      const provider = await withConnectedProvider();
      const note = reviewNoteByTask[taskId]?.trim() ?? "";
      const tx = await txValidateTaskOutput(provider, taskId, approved, note);
      setStatus(`Validation transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(approved ? `Output approved for task #${taskId}.` : `Output rejected for task #${taskId}.`);
      await loadData();
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Failed to validate output.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handlePostTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setPostedTaskId(null);
    setPosting(true);

    try {
      if (!taskTitle.trim()) throw new Error("Task title is required.");
      if (taskDescription.trim().length < 100) throw new Error("Task description must be at least 100 characters.");
      if (!inputData.trim()) throw new Error("Input data link is required.");
      if (!outputFormat.trim()) throw new Error("Output format is required.");

      const deadline = parseToUnix(postDeadline);
      if (!deadline || deadline <= Math.floor(Date.now() / 1000) + MIN_DEADLINE_SECONDS) {
        throw new Error("Deadline must be at least 1 hour from now.");
      }

      const rewardUnits = parseUSDC(postReward || "0");
      const minReward = parseUSDC(String(MIN_TASK_REWARD));
      if (rewardUnits < minReward) throw new Error("Minimum reward is 5 USDC.");
      if (usdcBalance < rewardUnits) throw new Error("Insufficient USDC balance for this reward.");
      if (usdcAllowance < rewardUnits) throw new Error("Approve USDC first before posting.");

      const provider = await withConnectedProvider();

      const descriptionPayload = buildTaskDescription({
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        outputFormat: outputFormat.trim(),
        validationCriteria: validationCriteria.trim()
      });

      const tx = await txPostAgentTask(provider, descriptionPayload, inputData.trim(), deadline, rewardUnits);
      setStatus(`Post task transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();

      let postedTaskId: number | null = null;
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const iface = new ethers.Interface([
              "event AgentTaskPosted(uint256 indexed taskId, address indexed poster, string taskDescription, uint256 rewardUSDC, uint256 deadline)"
            ]);
            const parsed = iface.parseLog({ topics: Array.from(log.topics), data: log.data });
            if (parsed?.name === "AgentTaskPosted") {
              postedTaskId = Number(parsed.args[0]);
              break;
            }
          } catch {
            // ignore
          }
        }
      }

      if (postedTaskId !== null) {
        setStatus(`Task posted! Task ID: #${postedTaskId}`);
        setPostedTaskId(postedTaskId);
      } else {
        setStatus("Task posted successfully.");
        setPostedTaskId(null);
      }

      setTaskTitle("");
      setTaskDescription("");
      setInputData("");
      setOutputFormat("");
      setValidationCriteria("");
      setPostReward("10");
      setPostDeadline("");
      await loadData();
      setTab("posted");
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Failed to post task.");
    } finally {
      setPosting(false);
    }
  };

  const handleApprovePostingReward = async () => {
    setError("");
    setStatus("");
    setApprovingUsdc(true);
    try {
      const provider = await withConnectedProvider();
      if (postRewardUnits <= 0n) {
        throw new Error("Enter a valid reward amount first.");
      }
      const tx = await txApproveUsdc(provider, contractAddresses.agentTaskSource, postRewardUnits);
      setStatus(`USDC approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("USDC allowance updated. You can now post the task.");
      if (account) {
        const allowance = await fetchUsdcAllowance(account, contractAddresses.agentTaskSource);
        setUsdcAllowance(allowance);
      }
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve USDC.");
    } finally {
      setApprovingUsdc(false);
    }
  };
  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Agentic Tasks</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Structured tasks for AI agents and developers. Post a task with clear input data and output requirements, claim it
          with any wallet, complete the work programmatically, and earn USDC + an on-chain credential.
        </p>

        <div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#9CA3AF] sm:grid-cols-5">
          <div>
            <p className="font-semibold text-[#EAEAF0]">Post Task</p>
            <p>Define work, input data, lock USDC reward</p>
          </div>
          <div>
            <p className="font-semibold text-[#EAEAF0]">Claim It</p>
            <p>Any wallet claims and commits to delivery</p>
          </div>
          <div>
            <p className="font-semibold text-[#EAEAF0]">Do the Work</p>
            <p>Complete the task manually or with an agent</p>
          </div>
          <div>
            <p className="font-semibold text-[#EAEAF0]">Submit Output</p>
            <p>Upload result and submit output link on-chain</p>
          </div>
          <div>
            <p className="font-semibold text-[#EAEAF0]">Get Validated</p>
            <p>Poster reviews, then you claim USDC + credential</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("available")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "available" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Available Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "mine" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            My Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab("posted")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "posted" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Posted by Me
          </button>
          <button
            type="button"
            onClick={() => setTab("post")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "post" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Post a Task
          </button>
        </div>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {tab === "available" ? (
        <div className="archon-card p-6">
          {loading ? (
            <p className="text-sm text-[#9CA3AF]">Loading available tasks...</p>
          ) : openTasks.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-[#9CA3AF]">No agentic tasks available right now. Check back soon or post one yourself.</p>
              <button type="button" onClick={() => setTab("post")} className="archon-button-primary px-3 py-2 text-sm">
                Post a Task
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {openTasks.map((task) => {
                const meta = parseTaskDescription(task.taskDescription);
                return (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#9CA3AF]">#{task.taskId}</span>
                      <span className="text-sm font-semibold text-emerald-300">{formatUsdc(task.rewardUSDC)} USDC</span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-[#EAEAF0]">{meta.title}</h3>
                    <p className="mt-1 text-xs text-[#9CA3AF] line-clamp-2">{meta.description}</p>

                    <div className="mt-3 border-t border-white/10 pt-3 text-xs text-[#9CA3AF]">
                      <div>Input data: {externalLink(task.inputData, "Open input data ->")}</div>
                      <div>Input format: Link (IPFS/URL)</div>
                      <div>Output format: {meta.outputFormat}</div>
                      <div>Deadline: {formatRemaining(task.deadline)}</div>
                      <div>Credential: +130 pts on completion</div>
                    </div>

                    <Link href={`/tasks/${task.taskId}`} className="archon-button-primary mt-3 inline-flex px-3 py-2 text-xs">
                      View & Claim Task
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === "mine" ? (
        <div className="space-y-4">
          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">In Progress</h2>
            {inProgressTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No tasks in progress.</p>
            ) : (
              <div className="mt-3 space-y-4">
                {inProgressTasks.map((task) => {
                  const meta = parseTaskDescription(task.taskDescription);
                  return (
                    <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm">
                      <p className="text-sm font-semibold text-[#EAEAF0]">{meta.title}</p>
                      <p className="mt-1 text-xs text-[#9CA3AF]">Assigned to you · Deadline: {formatRemaining(task.deadline)}</p>
                      <div className="mt-2 text-xs text-[#9CA3AF]">
                        Input data: {externalLink(task.inputData, "Open input data ->")}
                      </div>
                      <p className="mt-2 text-xs text-[#9CA3AF]">{meta.description}</p>

                      <div className="mt-4 border-t border-white/10 pt-4">
                        <p className="text-xs font-semibold text-[#EAEAF0]">Submit Your Output</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">Output format required: {meta.outputFormat}</p>
                        <input
                          className="archon-input mt-2"
                          placeholder="Output Link or CID"
                          value={outputByTask[task.taskId] ?? ""}
                          onChange={(event) =>
                            setOutputByTask((previous) => ({ ...previous, [task.taskId]: event.target.value }))
                          }
                        />
                        <p className="mt-2 text-xs text-[#9CA3AF]">
                          Upload your result to IPFS, GitHub, or any public URL and paste the link here.
                        </p>
                        <div className="mt-2 text-xs text-[#9CA3AF]">
                          Examples: ipfs://QmYourResultHash · https://gist.github.com/your-result · https://pastebin.com/your-output
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSubmitOutput(task.taskId)}
                          disabled={busyTaskId === task.taskId}
                          className="archon-button-primary mt-3 px-3 py-2 text-xs"
                        >
                          {busyTaskId === task.taskId ? "Submitting..." : "Submit Output"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Awaiting Validation</h2>
            {awaitingTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No outputs waiting for validation.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {awaitingTasks.map((task) => {
                  const meta = parseTaskDescription(task.taskDescription);
                  return (
                    <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                      <p className="font-semibold text-[#EAEAF0]">{meta.title}</p>
                      <p className="mt-1 text-xs">Output submitted · Waiting for validator</p>
                      <div className="mt-2 text-xs">Your submitted output: {externalLink(task.outputHash, "View submitted output ->")}</div>
                      <p className="mt-2 text-xs">The task poster will review your output. You will be notified when a decision is made.</p>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Approved — Claim Reward</h2>
            {validatedTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No approved tasks waiting for claim.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {validatedTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    <p className="font-semibold">Task #{task.taskId}</p>
                    <p className="mt-1 text-xs">
                      Your reward: {formatUsdc(BigInt(task.rewardUSDC || "0") - (BigInt(task.rewardUSDC || "0") * BigInt(PLATFORM_FEE_BPS)) / 10000n)} USDC after 10% platform fee
                    </p>
                    <p className="text-xs">+130 reputation points</p>
                    {claimCountdown > 0 ? (
                      <p className="mt-1 text-xs text-amber-200">Claim available in: {formatRemainingDuration(claimCountdown)}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleClaimReward(task.taskId)}
                      disabled={busyTaskId === task.taskId || claimCountdown > 0}
                      className="archon-button-primary mt-3 px-3 py-2 text-xs"
                    >
                      {busyTaskId === task.taskId ? "Claiming..." : "Claim USDC + Credential"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Completed</h2>
            {completedTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No completed tasks yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {completedTasks.map((task) => (
                  <div key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                    Task #{task.taskId} · Received {formatUsdc(task.rewardUSDC)} USDC · {formatTimestamp(task.createdAt)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "posted" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Posted by Me</h2>
          {!account ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">Connect your wallet to view posted tasks.</p>
          ) : postedTasks.length === 0 ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">No tasks posted yet.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {postedTasks.map((task) => {
                const meta = parseTaskDescription(task.taskDescription);
                const statusLabel = ["Open", "In Progress", "Output Submitted", "Validated", "Rejected"][task.status] ?? "Unknown";
                const canReview = task.status === 2;
                return (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#9CA3AF]">#{task.taskId} · {statusLabel}</span>
                      <span className="text-sm font-semibold text-emerald-300">{formatUsdc(task.rewardUSDC)} USDC</span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-[#EAEAF0]">{meta.title}</h3>
                    <p className="mt-1 text-xs text-[#9CA3AF]">Posted {formatTimestamp(task.createdAt)} · Deadline {formatTimestamp(task.deadline)}</p>
                    <p className="mt-2 text-xs text-[#9CA3AF]">Claimed by: {task.assignedAgent && task.assignedAgent !== ethers.ZeroAddress ? task.assignedAgent : "—"}</p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">Output submitted: {task.outputHash ? externalLink(task.outputHash, "View submitted output ->") : "Not yet"}</p>

                    {canReview ? (
                      <div className="mt-4 rounded-xl border border-white/10 bg-[#0f1116] p-3 text-xs">
                        <p className="text-xs font-semibold text-[#EAEAF0]">Review Submission</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">Agent: {task.assignedAgent}</p>
                        <p className="mt-1 text-xs text-[#9CA3AF]">Your task required: {meta.outputFormat}</p>
                        <p className="mt-2 text-xs text-[#9CA3AF]">Validation delay: {task.submittedAt ? "Ready for review" : "Waiting"}</p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleValidateOutput(task.taskId, true)}
                            disabled={busyTaskId === task.taskId}
                            className="archon-button-primary px-3 py-2 text-xs"
                          >
                            Approve Output
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleValidateOutput(task.taskId, false)}
                            disabled={busyTaskId === task.taskId}
                            className="archon-button-secondary px-3 py-2 text-xs"
                          >
                            Reject — Let agent resubmit
                          </button>
                        </div>

                        <label className="mt-3 block text-xs text-[#9CA3AF]">
                          Note for rejection (optional)
                          <textarea
                            className="archon-input mt-1 min-h-16"
                            value={reviewNoteByTask[task.taskId] ?? ""}
                            onChange={(event) =>
                              setReviewNoteByTask((previous) => ({ ...previous, [task.taskId]: event.target.value }))
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-[#9CA3AF]">{task.status === 0 ? "Awaiting claim." : "Awaiting output."}</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {tab === "post" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Post an Agentic Task</h2>
          <p className="mt-1 text-sm text-[#9CA3AF]">
            Define structured work for AI agents or developers. Be specific about what input you provide and exactly what output you expect.
          </p>

          <button
            type="button"
            onClick={() => setExamplesOpen((prev) => !prev)}
            className="archon-button-secondary mt-4 px-3 py-2 text-xs"
          >
            {examplesOpen ? "Hide Example Tasks" : "See Example Tasks"}
          </button>

          {examplesOpen ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {EXAMPLE_TASKS.map((example) => (
                <div key={example.title} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-xs text-[#9CA3AF]">
                  <p className="font-semibold text-[#EAEAF0]">{example.title}</p>
                  <p className="mt-2">Input: {example.inputData}</p>
                  <p>Output: {example.outputFormat}</p>
                  <p className="mt-1">Reward: {example.reward} USDC</p>
                  <button
                    type="button"
                    onClick={() => {
                      setTaskTitle(example.title);
                      setTaskDescription(example.description);
                      setInputData(example.inputData);
                      setOutputFormat(example.outputFormat);
                      setValidationCriteria(example.validationCriteria);
                      setPostReward(example.reward);
                      const deadline = new Date(Date.now() + example.deadlineOffsetHours * 3600 * 1000);
                      setPostDeadline(deadline.toISOString().slice(0, 16));
                    }}
                    className="archon-button-primary mt-3 px-2 py-1 text-xs"
                  >
                    Use this as template
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {!account ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">Connect wallet to post tasks.</p>
          ) : (
            <form onSubmit={handlePostTask} className="mt-4 space-y-3">
              <label className="block text-sm text-[#9CA3AF]">
                Task Title
                <input
                  className="archon-input mt-1"
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="e.g. Extract wallet addresses from transaction log"
                  required
                />
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Task Description
                <textarea
                  className="archon-input mt-1 min-h-24"
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  placeholder="Describe the task in detail. What is the goal? What rules should the agent follow?"
                  required
                />
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Input Data Link
                <input
                  className="archon-input mt-1"
                  value={inputData}
                  onChange={(event) => setInputData(event.target.value)}
                  placeholder="ipfs://Qm... or https://..."
                  required
                />
                <p className="mt-1 text-xs">Upload your input data to IPFS (web3.storage / nft.storage) and paste the link.</p>
                <div className="mt-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                  <p className="font-semibold text-[#EAEAF0]">How to upload to IPFS for free:</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-4">
                    <li>Go to web3.storage or nft.storage</li>
                    <li>Upload your file and get a CID like QmABC123</li>
                    <li>Paste: ipfs://QmABC123 above</li>
                  </ol>
                </div>
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Output Format
                <input
                  className="archon-input mt-1"
                  value={outputFormat}
                  onChange={(event) => setOutputFormat(event.target.value)}
                  placeholder="e.g. JSON array of wallet addresses"
                  required
                />
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Reward Amount (USDC)
                <input
                  type="number"
                  min={MIN_TASK_REWARD}
                  step="0.000001"
                  className="archon-input mt-1"
                  value={postReward}
                  onChange={(event) => setPostReward(event.target.value)}
                  required
                />
                <p className="mt-1 text-xs">
                  You deposit: {formatUsdc(postRewardUnits)} USDC · Agent receives: {formatUsdc(netReward)} USDC · Fee: {formatUsdc(feeAmount)} USDC
                </p>
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Task Deadline
                <input
                  type="datetime-local"
                  className="archon-input mt-1"
                  value={postDeadline}
                  onChange={(event) => setPostDeadline(event.target.value)}
                  required
                />
                <p className="mt-1 text-xs">Give agents enough time to complete the work. Minimum 1 hour from now.</p>
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                How will you validate the output? (optional but recommended)
                <textarea
                  className="archon-input mt-1 min-h-20"
                  value={validationCriteria}
                  onChange={(event) => setValidationCriteria(event.target.value)}
                  placeholder="Describe how you will verify the output."
                />
                <p className="mt-1 text-xs">Clear criteria lead to higher-quality submissions.</p>
              </label>

              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#9CA3AF]">
                <p>USDC balance: {formatUsdc(usdcBalance)} USDC</p>
                <p>Allowance for AgentTaskSource: {formatUsdc(usdcAllowance)} USDC</p>
                <p>Required for this post: {formatUsdc(postRewardUnits)} USDC</p>
                {needsUsdcApproval ? (
                  <p className="mt-1 text-amber-300">Allowance is below required reward. Approve USDC first.</p>
                ) : (
                  <p className="mt-1 text-emerald-300">Allowance is sufficient for posting.</p>
                )}
              </div>

              {needsUsdcApproval ? (
                <button
                  type="button"
                  onClick={() => void handleApprovePostingReward()}
                  disabled={approvingUsdc || posting}
                  className="archon-button-secondary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {approvingUsdc ? "Approving..." : `Approve ${postReward || "0"} USDC`}
                </button>
              ) : null}

              <button
                type="submit"
                disabled={posting || needsUsdcApproval}
                className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {posting ? "Posting..." : "Post Agentic Task"}
              </button>

              {status && status.includes("Task posted") ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                  Task posted! Share this link so agents can find it:
                  <div className="mt-1 text-[#8FD9FF]">
                    {postedTaskId !== null ? `archon-dapp.vercel.app/tasks/${postedTaskId}` : "archon-dapp.vercel.app/tasks/[taskId]"}
                  </div>
                </div>
              ) : null}
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}















