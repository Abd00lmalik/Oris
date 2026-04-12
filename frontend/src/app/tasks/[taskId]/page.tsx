"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  fetchAgentTaskById,
  fetchAgentTaskCredentialCooldownSeconds,
  fetchLastAgentTaskCredentialClaim,
  formatTimestamp,
  formatUsdc,
  txClaimAgentTask,
  txClaimTaskRewardAndCredential,
  txSubmitTaskOutput,
  txValidateTaskOutput,
  ZERO_ADDRESS
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type TaskMeta = {
  title: string;
  description: string;
  outputFormat: string;
  validationCriteria: string;
};

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

  return {
    title: "Agentic Task",
    description: raw,
    outputFormat: "Not specified",
    validationCriteria: ""
  };
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

export default function AgenticTaskDetailsPage() {
  const params = useParams<{ taskId: string }>();
  const { account, browserProvider, connect } = useWallet();

  const taskId = useMemo(() => Number(params.taskId), [params.taskId]);
  const [task, setTask] = useState<Awaited<ReturnType<typeof fetchAgentTaskById>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [outputLink, setOutputLink] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);

  const isConnected = Boolean(account);
  const meta = task ? parseTaskDescription(task.taskDescription) : null;
  const isPoster = Boolean(account && task && account.toLowerCase() === task.taskPoster.toLowerCase());
  const isAgent = Boolean(account && task && account.toLowerCase() === task.assignedAgent.toLowerCase());
  const isOpen = Boolean(task && task.assignedAgent === ZERO_ADDRESS);

  const loadTask = useCallback(async () => {
    if (!Number.isInteger(taskId) || taskId < 0) {
      setError("Invalid task ID.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const taskData = await fetchAgentTaskById(taskId);
      setTask(taskData);
      if (!taskData) return;

      if (account) {
        try {
          const [lastClaim, cooldownSeconds] = await Promise.all([
            fetchLastAgentTaskCredentialClaim(account),
            fetchAgentTaskCredentialCooldownSeconds()
          ]);
          setClaimReadyAt(Number(lastClaim) + cooldownSeconds);
        } catch {
          setClaimReadyAt(null);
        }
      } else {
        setClaimReadyAt(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load task.");
    } finally {
      setLoading(false);
    }
  }, [account, taskId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

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

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleClaimTask = async () => {
    if (!task) return;
    setError("");
    setStatus("");
    setBusyAction("claim");
    try {
      const provider = await withProvider();
      const tx = await txClaimAgentTask(provider, task.taskId);
      setStatus(`Claim task transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Task claimed successfully.");
      await loadTask();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim task.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitOutput = async () => {
    if (!task) return;
    setError("");
    setStatus("");
    const trimmed = outputLink.trim();
    if (!trimmed) {
      setError("Output link or CID is required.");
      return;
    }
    setBusyAction("submit");
    try {
      const provider = await withProvider();
      const tx = await txSubmitTaskOutput(provider, task.taskId, trimmed);
      setStatus(`Submit output transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Output submitted. Awaiting validation.");
      setOutputLink("");
      await loadTask();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit output.");
    } finally {
      setBusyAction("");
    }
  };

  const handleValidate = async (approved: boolean) => {
    if (!task) return;
    setError("");
    setStatus("");
    setBusyAction(approved ? "approve" : "reject");
    try {
      const provider = await withProvider();
      const tx = await txValidateTaskOutput(provider, task.taskId, approved, reviewNote.trim());
      setStatus(approved ? "Output approved." : "Output rejected.");
      await tx.wait();
      setReviewNote("");
      await loadTask();
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Failed to validate output.");
    } finally {
      setBusyAction("");
    }
  };

  const handleClaimReward = async () => {
    if (!task) return;
    setError("");
    setStatus("");
    if (claimCountdown > 0) {
      setError(`Claim available in: ${formatRemainingDuration(claimCountdown)}`);
      return;
    }
    setBusyAction("reward");
    try {
      const provider = await withProvider();
      const tx = await txClaimTaskRewardAndCredential(provider, task.taskId);
      setStatus(`Claim reward transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("USDC + credential claimed.");
      await loadTask();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim reward.");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">
          Agentic Task #{Number.isInteger(taskId) ? taskId : "?"}
        </h1>
        <Link href="/tasks" className="archon-button-secondary px-3 py-2 text-sm">
          Back to Agentic Tasks
        </Link>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      {loading ? <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Loading task details...</div> : null}
      {!loading && !task ? <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Task not found.</div> : null}

      {task && meta ? (
        <>
          <div className="archon-card p-5 text-sm text-[#9CA3AF]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#EAEAF0]">{meta.title}</h2>
                <p className="mt-2 max-w-3xl">{meta.description}</p>
              </div>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs">
                {["Open", "In Progress", "Output Submitted", "Validated", "Rejected"][task.status] ?? "Unknown"}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Reward:</span> {formatUsdc(task.rewardUSDC)} USDC
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Deadline:</span> {formatTimestamp(task.deadline)} ({formatRemaining(task.deadline)})
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Input data:</span> {externalLink(task.inputData, "Open input data ->")}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Output format:</span> {meta.outputFormat}
              </div>
            </div>
            {meta.validationCriteria ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                <span className="font-medium text-[#EAEAF0]">Validation criteria:</span> {meta.validationCriteria}
              </div>
            ) : null}
            <p className="mt-3 text-xs text-[#9CA3AF]">Credential earned: +130 pts on completion</p>
          </div>

          {!isConnected ? (
            <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">Connect wallet to claim or submit this task.</div>
          ) : null}

          {isConnected && isPoster ? (
            <div className="archon-card p-5 space-y-3">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Review Submission</h3>
              <p className="text-xs text-[#9CA3AF]">Claimed by: {task.assignedAgent && task.assignedAgent !== ZERO_ADDRESS ? task.assignedAgent : "—"}</p>
              <p className="text-xs text-[#9CA3AF]">Output submitted: {task.outputHash ? externalLink(task.outputHash, "View submitted output ->") : "Not yet"}</p>
              {task.status === 2 ? (
                <div className="rounded-xl border border-white/10 bg-[#111214] p-3 text-xs text-[#9CA3AF] space-y-2">
                  <p>Validation delay: Ready for review</p>
                  <label className="block">
                    Note for rejection (optional)
                    <textarea
                      className="archon-input mt-1 min-h-16"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleValidate(true)}
                      disabled={busyAction === "approve"}
                      className="archon-button-primary px-3 py-2 text-xs"
                    >
                      {busyAction === "approve" ? "Approving..." : "Approve Output"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleValidate(false)}
                      disabled={busyAction === "reject"}
                      className="archon-button-secondary px-3 py-2 text-xs"
                    >
                      {busyAction === "reject" ? "Rejecting..." : "Reject — Let agent resubmit"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#9CA3AF]">Awaiting output submission.</p>
              )}
            </div>
          ) : null}

          {isConnected && isAgent ? (
            <div className="archon-card p-5 space-y-3">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Your Task Actions</h3>
              {task.status === 1 || task.status === 4 ? (
                <div className="space-y-3">
                  <div className="text-xs text-[#9CA3AF]">Submit your output link or CID below.</div>
                  <input
                    className="archon-input"
                    value={outputLink}
                    onChange={(event) => setOutputLink(event.target.value)}
                    placeholder="Output Link or CID"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSubmitOutput()}
                    disabled={busyAction === "submit"}
                    className="archon-button-primary px-3 py-2 text-xs"
                  >
                    {busyAction === "submit" ? "Submitting..." : "Submit Output"}
                  </button>
                </div>
              ) : null}
              {task.status === 2 ? (
                <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
                  Output submitted. Waiting for validation.
                </div>
              ) : null}
              {task.status === 3 ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <p>Output approved. Claim your USDC + credential.</p>
                  {claimCountdown > 0 ? <p className="mt-1 text-xs text-amber-200">Claim available in: {formatRemainingDuration(claimCountdown)}</p> : null}
                  <button
                    type="button"
                    onClick={() => void handleClaimReward()}
                    disabled={busyAction === "reward" || claimCountdown > 0}
                    className="archon-button-primary mt-3 px-4 py-2 text-xs"
                  >
                    {busyAction === "reward" ? "Claiming..." : "Claim USDC + Credential"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {isConnected && isOpen && !isPoster ? (
            <div className="archon-card p-5 space-y-3">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Ready to complete this task?</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-[#9CA3AF]">
                <li>Click Claim Task to reserve it for your wallet.</li>
                <li>Fetch the input data from the link above.</li>
                <li>Complete the work manually or with AI/scripts.</li>
                <li>Upload your result and submit the output link.</li>
                <li>Wait for the poster to validate, then claim rewards.</li>
              </ol>
              <button
                type="button"
                onClick={() => void handleClaimTask()}
                disabled={busyAction === "claim"}
                className="archon-button-primary px-4 py-2 text-sm"
              >
                {busyAction === "claim" ? "Claiming..." : "Claim This Task"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
