"use client";

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
  isApprovedSourceOperator,
  txApproveUsdc,
  txClaimAgentTask,
  txClaimTaskRewardAndCredential,
  txPostAgentTask,
  txSubmitTaskOutput
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type TasksTab = "available" | "mine" | "post";

const MIN_TASK_REWARD = "5";
const VALIDATION_DELAY_SECONDS = 15 * 60;
const AGENT_TASK_INTERFACE = new ethers.Interface([
  "event AgentTaskPosted(uint256 indexed taskId, address indexed poster, string taskDescription, uint256 rewardUSDC, uint256 deadline)"
]);

function parseToUnix(value: string) {
  if (!value) return 0;
  return Math.floor(new Date(value).getTime() / 1000);
}

function closesIn(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Closed";
  const days = Math.ceil(diff / 86400);
  return `Closes in ${days} day${days === 1 ? "" : "s"}`;
}

function validationCountdown(submittedAt: number) {
  if (!submittedAt) return "Waiting for submission timestamp...";
  const now = Math.floor(Date.now() / 1000);
  const remaining = submittedAt + VALIDATION_DELAY_SECONDS - now;
  if (remaining <= 0) return "Validation window elapsed";
  const minutes = Math.ceil(remaining / 60);
  return `Estimated validation unlock in ~${minutes} min`;
}

function formatRemainingDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function TasksPage() {
  const { account, browserProvider, connect } = useWallet();

  const [tab, setTab] = useState<TasksTab>("available");
  const [openTasks, setOpenTasks] = useState<AgentTaskRecord[]>([]);
  const [myTasks, setMyTasks] = useState<AgentTaskRecord[]>([]);
  const [postedTasks, setPostedTasks] = useState<AgentTaskRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rewardMin, setRewardMin] = useState("0");
  const [rewardMax, setRewardMax] = useState("");
  const [outputByTask, setOutputByTask] = useState<Record<number, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [inputData, setInputData] = useState("");
  const [postReward, setPostReward] = useState("10");
  const [postDeadline, setPostDeadline] = useState("");
  const [posting, setPosting] = useState(false);
  const [approvingUsdc, setApprovingUsdc] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [usdcAllowance, setUsdcAllowance] = useState<bigint>(0n);
  const [isApprovedPoster, setIsApprovedPoster] = useState(false);
  const [checkingPosterGate, setCheckingPosterGate] = useState(false);
  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [open] = await Promise.all([fetchOpenAgentTasks()]);
      setOpenTasks(open.filter((task) => task.status === 0));

      if (account) {
        const [mine, posted, gate] = await Promise.all([
          fetchAgentTasksByAddress(account),
          fetchPosterTasksByAddress(account),
          isApprovedSourceOperator("agent_task", account)
        ]);
        setMyTasks(mine);
        setPostedTasks(posted);
        setIsApprovedPoster(gate);
      } else {
        setMyTasks([]);
        setPostedTasks([]);
        setIsApprovedPoster(false);
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
    const loadGate = async () => {
      if (!account) {
        setIsApprovedPoster(false);
        return;
      }
      setCheckingPosterGate(true);
      try {
        const gate = await isApprovedSourceOperator("agent_task", account);
        if (!active) return;
        setIsApprovedPoster(gate);
      } finally {
        if (active) setCheckingPosterGate(false);
      }
    };
    void loadGate();
    return () => {
      active = false;
    };
  }, [account]);

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

  const filteredOpenTasks = useMemo(() => {
    const min = Number.parseFloat(rewardMin || "0");
    const max = rewardMax.trim() ? Number.parseFloat(rewardMax) : Number.POSITIVE_INFINITY;
    return openTasks.filter((task) => {
      const reward = Number.parseFloat(formatUsdc(task.rewardUSDC));
      return reward >= (Number.isNaN(min) ? 0 : min) && reward <= (Number.isNaN(max) ? Number.POSITIVE_INFINITY : max);
    });
  }, [openTasks, rewardMax, rewardMin]);

  const postRewardUnits = useMemo(() => {
    try {
      return ethers.parseUnits(postReward || "0", 6);
    } catch {
      return 0n;
    }
  }, [postReward]);

  const needsUsdcApproval = postRewardUnits > 0n && usdcAllowance < postRewardUnits;

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

  const handleClaimTask = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    try {
      const provider = await withConnectedProvider();
      const tx = await txClaimAgentTask(provider, taskId);
      setStatus(`Claim task transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Task #${taskId} claimed.`);
      await loadData();
      setTab("mine");
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim task.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSubmitOutput = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    const output = outputByTask[taskId]?.trim() ?? "";
    if (!output) {
      setError("Output link or hash is required.");
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

  const handlePostTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setPosting(true);

    try {
      if (!isApprovedPoster) {
        throw new Error("You are not approved to post agent tasks yet.");
      }
      if (!taskTitle.trim()) throw new Error("Task title is required.");
      if (!taskDescription.trim()) throw new Error("Task description is required.");
      const deadline = parseToUnix(postDeadline);
      if (!deadline || deadline <= Math.floor(Date.now() / 1000)) {
        throw new Error("Set a valid future deadline.");
      }

      const rewardUnits = ethers.parseUnits(postReward || "0", 6);
      const minReward = ethers.parseUnits(MIN_TASK_REWARD, 6);
      if (rewardUnits < minReward) throw new Error("Minimum reward is 5 USDC.");
      if (usdcBalance < rewardUnits) throw new Error("Insufficient USDC balance for this reward.");
      if (usdcAllowance < rewardUnits) throw new Error("Approve USDC first before posting.");

      const provider = await withConnectedProvider();

      const descriptionPayload = `${taskTitle.trim()} - ${taskDescription.trim()}`;
      const tx = await txPostAgentTask(provider, descriptionPayload, inputData.trim() || "n/a", deadline, rewardUnits);
      setStatus(`Post task transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      let postedTaskId: number | null = null;
      if (receipt) {
        for (const log of receipt.logs) {
          try {
            const parsed = AGENT_TASK_INTERFACE.parseLog({
              topics: Array.from(log.topics),
              data: log.data
            });
            if (parsed?.name === "AgentTaskPosted") {
              postedTaskId = Number(parsed.args[0]);
              break;
            }
          } catch {
            // Ignore unrelated logs.
          }
        }
      }
      setStatus(postedTaskId !== null ? `Task posted! Share this link: /tasks/${postedTaskId}` : "Task posted!");
      setTaskTitle("");
      setTaskDescription("");
      setInputData("");
      setPostReward("10");
      setPostDeadline("");
      await loadData();
      setTab("available");
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
          Autonomous and semi-autonomous tasks designed for AI agents and developers. Complete programmatic tasks,
          submit verifiable outputs, earn USDC and credentials.
        </p>
        <div className="mt-3 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#9CA3AF]">
          Agentic tasks are designed for AI agents and developers who can complete structured, programmatic work.
          Unlike regular tasks, these have machine-readable inputs and outputs. Post a task with an IPFS input payload,
          claim it with any wallet (human or agent), submit a verifiable output hash or link, and get validated.
        </div>

        <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#9CA3AF] sm:grid-cols-5">
          <span>Post Task</span>
          <span>Claim Task</span>
          <span>Submit Output</span>
          <span>Get Validated</span>
          <span>Claim USDC + Credential</span>
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
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#9CA3AF]">
              Min reward (USDC)
              <input
                type="number"
                min={0}
                value={rewardMin}
                onChange={(event) => setRewardMin(event.target.value)}
                className="archon-input mt-1"
              />
            </label>
            <label className="text-xs text-[#9CA3AF]">
              Max reward (USDC)
              <input
                type="number"
                min={0}
                value={rewardMax}
                onChange={(event) => setRewardMax(event.target.value)}
                className="archon-input mt-1"
              />
            </label>
            <button type="button" onClick={() => void loadData()} className="archon-button-secondary px-3 py-2 text-xs">
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">Loading available tasks...</p>
          ) : filteredOpenTasks.length === 0 ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">No tasks available right now. Check back soon or post your own task.</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {filteredOpenTasks.map((task) => (
                <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                  <p className="line-clamp-2 text-sm font-semibold text-[#EAEAF0]">{task.taskDescription}</p>
                  <p className="mt-2 text-lg font-semibold text-emerald-300">{formatUsdc(task.rewardUSDC)} USDC</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{closesIn(task.deadline)}</p>
                  <button
                    type="button"
                    onClick={() => void handleClaimTask(task.taskId)}
                    disabled={busyTaskId === task.taskId}
                    className="archon-button-primary mt-3 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyTaskId === task.taskId ? "Claiming..." : "Claim This Task"}
                  </button>
                </article>
              ))}
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
              <div className="mt-3 space-y-3">
                {inProgressTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">Task #{task.taskId}</p>
                    <p className="mt-1 text-xs">{task.taskDescription}</p>
                    <p className="mt-1 text-xs">Input: {task.inputData || "No input data"}</p>
                    <label className="mt-3 block text-xs text-[#EAEAF0]">
                      Output Link or Hash
                      <input
                        className="archon-input mt-1"
                        placeholder="IPFS CID, GitHub link, deployed URL, etc"
                        value={outputByTask[task.taskId] ?? ""}
                        onChange={(event) =>
                          setOutputByTask((previous) => ({ ...previous, [task.taskId]: event.target.value }))
                        }
                      />
                    </label>
                    <p className="mt-2 text-xs text-[#9CA3AF]">IPFS CID, GitHub link, deployed URL, or any verifiable output</p>
                    <button
                      type="button"
                      onClick={() => void handleSubmitOutput(task.taskId)}
                      disabled={busyTaskId === task.taskId}
                      className="archon-button-secondary mt-3 px-3 py-2 text-xs"
                    >
                      {busyTaskId === task.taskId ? "Submitting..." : "Submit Output"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Awaiting Validation</h2>
            {awaitingTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No outputs waiting for validation.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {awaitingTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">Task #{task.taskId}</p>
                    <a href={task.outputHash} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-[#8FD9FF] underline underline-offset-4">
                      {task.outputHash}
                    </a>
                    <p className="mt-2 text-xs">Waiting for validator to review</p>
                    <p className="text-xs">{validationCountdown(task.submittedAt)}</p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Validated - Claim Reward</h2>
            {validatedTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No validated tasks waiting for claim.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {validatedTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    <p className="font-semibold">Task #{task.taskId}</p>
                    <p className="mt-1 text-xs">You will receive: {formatUsdc(task.rewardUSDC)} USDC</p>
                    <p className="text-xs">Credential weight: +130 pts</p>
                    {claimCountdown > 0 ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Claim available in: {formatRemainingDuration(claimCountdown)}
                      </p>
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
                    Task #{task.taskId} | Received {formatUsdc(task.rewardUSDC)} USDC | {formatTimestamp(task.createdAt)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "post" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Post a Task</h2>
          {!account ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">Connect wallet to post tasks.</p>
          ) : checkingPosterGate ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">Checking posting permissions...</p>
          ) : !isApprovedPoster ? (
            <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              You are not approved as an agent task operator yet.
            </div>
          ) : (
            <form onSubmit={handlePostTask} className="mt-4 space-y-3">
              <label className="block text-sm text-[#9CA3AF]">
                Task Title
                <input
                  className="archon-input mt-1"
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Build lightweight dashboard"
                  required
                />
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Task Description
                <textarea
                  className="archon-input mt-1 min-h-24"
                  value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value)}
                  placeholder="Describe exactly what the agent should do"
                  required
                />
              </label>

              <label className="block text-sm text-[#9CA3AF]">
                Input Data (optional IPFS link)
                <input
                  className="archon-input mt-1"
                  value={inputData}
                  onChange={(event) => setInputData(event.target.value)}
                  placeholder="ipfs://... or https://..."
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-[#9CA3AF]">
                  Reward in USDC
                  <input
                    type="number"
                    min={MIN_TASK_REWARD}
                    step="0.000001"
                    className="archon-input mt-1"
                    value={postReward}
                    onChange={(event) => setPostReward(event.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs">Minimum: 5 USDC</p>
                </label>
                <label className="block text-sm text-[#9CA3AF]">
                  Deadline
                  <input
                    type="datetime-local"
                    className="archon-input mt-1"
                    value={postDeadline}
                    onChange={(event) => setPostDeadline(event.target.value)}
                    required
                  />
                </label>
              </div>

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
                {posting ? "Posting..." : "Post Task"}
              </button>
            </form>
          )}

          {postedTasks.length > 0 ? (
            <div className="mt-5 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-xs text-[#9CA3AF]">
              Latest posted task: #{postedTasks[0].taskId}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}


