"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  fetchApprovedAgentCount,
  fetchJob,
  fetchJobEscrow,
  fetchJobsCompletedCount,
  fetchJobsCreatedCount,
  fetchSubmissionForAgent,
  fetchSubmissions,
  fetchSuspicionScore,
  formatTimestamp,
  formatUsdc,
  getDeploymentConfig,
  getJobReadContract,
  isJobOpen,
  JobRecord,
  statusLabel,
  SubmissionRecord,
  submissionStatusLabel,
  SuspicionResult,
  toDisplayName,
  txAcceptJob,
  txApproveSubmission,
  txClaimJobCredential,
  txRejectSubmission,
  txSubmitDeliverable
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type AgentInsight = {
  suspicion: SuspicionResult;
  completedCount: number;
};

const MAX_APPROVALS = 3;

function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function submissionClass(status: number) {
  if (status === 2) return "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (status === 3) return "border border-rose-400/30 bg-rose-500/10 text-rose-200";
  if (status === 1) return "border border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
  return "border border-white/10 bg-white/5 text-[#9CA3AF]";
}

function suspicionClass(score: number) {
  if (score > 70) return "text-rose-300";
  if (score > 40) return "text-amber-300";
  return "text-[#9CA3AF]";
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const { account, browserProvider, connect } = useWallet();

  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [escrowLocked, setEscrowLocked] = useState<bigint>(0n);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [platformFeeBps, setPlatformFeeBps] = useState(
    getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000
  );
  const [creatorPostedCount, setCreatorPostedCount] = useState(0);
  const [insightsByAgent, setInsightsByAgent] = useState<Record<string, AgentInsight>>({});
  const [deliverableLink, setDeliverableLink] = useState("");
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);
  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());

  const grossPerApproval = useMemo(() => {
    if (!job) return 0n;
    return BigInt(job.rewardUSDC) / BigInt(MAX_APPROVALS);
  }, [job]);

  const netPerApproval = useMemo(() => {
    if (!job) return 0n;
    const fee = (grossPerApproval * BigInt(platformFeeBps)) / 10_000n;
    return grossPerApproval - fee;
  }, [grossPerApproval, job, platformFeeBps]);

  const myStatus = mySubmission?.status ?? 0;
  const canSubmit = isConnected && !isCreator && isAccepted && (mySubmission === null || myStatus === 3);
  const canClaim = isConnected && !isCreator && mySubmission?.status === 2 && !mySubmission.credentialClaimed;

  const loadJobData = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setError("Invalid job ID.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [jobData, submissionRows, escrow, approvedCount] = await Promise.all([
        fetchJob(jobId),
        fetchSubmissions(jobId),
        fetchJobEscrow(jobId),
        fetchApprovedAgentCount(jobId)
      ]);

      if (!jobData) {
        setJob(null);
        setSubmissions([]);
        return;
      }

      setJob(jobData);
      setSubmissions(submissionRows);
      setEscrowLocked(escrow);
      setApprovalsUsed(approvedCount);
      setCreatorPostedCount(await fetchJobsCreatedCount(jobData.client));

      try {
        const readContract = getJobReadContract();
        setPlatformFeeBps(Number(await readContract.platformFeeBps()));
      } catch {
        setPlatformFeeBps(getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000);
      }

      if (account) {
        const [accepted, submission] = await Promise.all([
          (async () => {
            try {
              const readContract = getJobReadContract();
              return (await readContract.isAccepted(jobId, account)) as boolean;
            } catch {
              return false;
            }
          })(),
          fetchSubmissionForAgent(jobId, account)
        ]);
        setIsAccepted(accepted);
        setMySubmission(submission);
      } else {
        setIsAccepted(false);
        setMySubmission(null);
      }

      if (submissionRows.length > 0) {
        const insightEntries = await Promise.all(
          submissionRows.map(async (submission) => {
            const [suspicion, completedCount] = await Promise.all([
              fetchSuspicionScore(jobId, submission.agent),
              fetchJobsCompletedCount(submission.agent)
            ]);
            return [submission.agent.toLowerCase(), { suspicion, completedCount }] as const;
          })
        );
        setInsightsByAgent(Object.fromEntries(insightEntries));
      } else {
        setInsightsByAgent({});
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load job data.");
    } finally {
      setLoading(false);
    }
  }, [account, jobId]);

  useEffect(() => {
    void loadJobData();
  }, [loadJobData]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleAccept = async () => {
    setError("");
    setStatus("");
    setBusyAction("accept");
    try {
      const provider = await withProvider();
      const tx = await txAcceptJob(provider, jobId);
      setStatus(`Accept transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Job accepted. You can now submit your work.");
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to accept job.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitWork = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

    const trimmed = deliverableLink.trim();
    if (!trimmed || !isHttpUrl(trimmed)) {
      setError("Deliverable link must start with http:// or https://");
      return;
    }

    setBusyAction("submit");
    try {
      const provider = await withProvider();
      const tx = await txSubmitDeliverable(provider, jobId, trimmed);
      setStatus(`Submit transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Work submitted. Awaiting review.");
      setDeliverableLink("");
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to submit work.");
    } finally {
      setBusyAction("");
    }
  };

  const handleApprove = async (agent: string) => {
    setError("");
    setStatus("");
    setBusyAction(`approve-${agent.toLowerCase()}`);
    try {
      const provider = await withProvider();
      const tx = await txApproveSubmission(provider, jobId, agent);
      setStatus(`Approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Submission approved for ${toDisplayName(agent)}.`);
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to approve submission.");
    } finally {
      setBusyAction("");
    }
  };

  const handleReject = async (agent: string) => {
    setError("");
    setStatus("");
    setBusyAction(`reject-${agent.toLowerCase()}`);
    try {
      const provider = await withProvider();
      const reason = (rejectNotes[agent.toLowerCase()] ?? "").trim() || "Submission rejected by reviewer.";
      const tx = await txRejectSubmission(provider, jobId, agent, reason);
      setStatus(`Reject transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Submission rejected for ${toDisplayName(agent)}.`);
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to reject submission.");
    } finally {
      setBusyAction("");
    }
  };

  const handleClaim = async () => {
    setError("");
    setStatus("");
    setBusyAction("claim");
    try {
      const provider = await withProvider();
      const tx = await txClaimJobCredential(provider, jobId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Reward and credential claimed successfully.");
      await loadJobData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Failed to claim reward and credential.");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Job #{Number.isInteger(jobId) ? jobId : "?"}</h1>
        <Link href="/" className="archon-button-secondary px-3 py-2 text-sm">
          Back to Home
        </Link>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      {loading ? (
        <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Loading job details...</div>
      ) : null}

      {!loading && !job ? (
        <div className="archon-card px-4 py-6 text-sm text-[#9CA3AF]">Job not found.</div>
      ) : null}

      {job ? (
        <>
          <div className="archon-card p-5 text-sm text-[#9CA3AF]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#EAEAF0]">{job.title}</h2>
                <p className="mt-2 max-w-3xl">{job.description}</p>
              </div>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs">{statusLabel(job.status)}</span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Creator:</span> {shortAddress(job.client)}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Creator activity:</span> {creatorPostedCount} jobs posted
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Deadline:</span> {formatTimestamp(job.deadline)}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Reward Pool:</span> {formatUsdc(job.rewardUSDC)} USDC
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Submissions:</span> {job.submissionCount}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Approvals:</span> {approvalsUsed}/{MAX_APPROVALS}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-3 py-3 text-xs text-[#C9D0DB]">
              <span className="font-semibold text-[#EAEAF0]">Escrow info:</span> {formatUsdc(escrowLocked)} USDC locked · {formatUsdc(netPerApproval)} USDC per approval after {platformFeeBps / 100}% fee
            </div>
          </div>

          {!isConnected ? (
            <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">
              Connect your wallet to accept this job, submit work, or review submissions.
            </div>
          ) : null}

          {isConnected && isCreator ? (
            <div className="archon-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-[#EAEAF0]">Review Submissions</h3>
                <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-[#9CA3AF]">{approvalsUsed}/{MAX_APPROVALS} approvals used</span>
              </div>

              {submissions.length === 0 ? (
                <p className="text-sm text-[#9CA3AF]">No submissions yet. Share this job link with agents to get started.</p>
              ) : (
                <div className="space-y-3">
                  {submissions.map((submission) => {
                    const agentKey = submission.agent.toLowerCase();
                    const insight = insightsByAgent[agentKey];
                    const isPending = submission.status === 1;
                    const isBusyApprove = busyAction === `approve-${agentKey}`;
                    const isBusyReject = busyAction === `reject-${agentKey}`;

                    return (
                      <article key={`${submission.agent}-${submission.submittedAt}`} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm text-[#EAEAF0]">
                              <span>{shortAddress(submission.agent)}</span>
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(submission.agent)}
                                className="archon-button-secondary px-2 py-1 text-xs"
                              >
                                Copy
                              </button>
                            </div>
                            <p className="text-xs text-[#9CA3AF]">{toDisplayName(submission.agent)} · Agent has completed {insight?.completedCount ?? 0} jobs total</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${submissionClass(submission.status)}`}>
                            {submissionStatusLabel(submission.status)}
                          </span>
                        </div>

                        <a
                          href={submission.deliverableLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 block break-all text-sm text-[#8FD9FF] underline underline-offset-4"
                        >
                          {submission.deliverableLink}
                        </a>

                        <p className="mt-2 text-xs text-[#9CA3AF]">Submitted: {formatTimestamp(submission.submittedAt)}</p>

                        <p className={`mt-2 text-xs ${suspicionClass(insight?.suspicion.score ?? 0)}`}>
                          Suspicion score: {insight?.suspicion.score ?? 0}
                          {insight?.suspicion.score && insight.suspicion.score > 40 ? " ?" : ""}
                          {insight?.suspicion.reason ? ` · ${insight.suspicion.reason}` : ""}
                        </p>

                        {submission.status === 2 && submission.credentialClaimed ? (
                          <p className="mt-2 text-xs text-emerald-200">Approved — credential minted</p>
                        ) : null}
                        {submission.status === 2 && !submission.credentialClaimed ? (
                          <p className="mt-2 text-xs text-emerald-200">Approved — awaiting credential claim</p>
                        ) : null}
                        {submission.status === 3 ? (
                          <p className="mt-2 text-xs text-rose-200">Rejected: {submission.reviewerNote || "No note provided."}</p>
                        ) : null}

                        {isPending ? (
                          <div className="mt-3 space-y-2">
                            <textarea
                              className="archon-input min-h-20 text-xs"
                              placeholder="Optional rejection note"
                              value={rejectNotes[agentKey] ?? ""}
                              onChange={(event) =>
                                setRejectNotes((previous) => ({
                                  ...previous,
                                  [agentKey]: event.target.value
                                }))
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={isBusyApprove || isBusyReject || approvalsUsed >= MAX_APPROVALS}
                                onClick={() => void handleApprove(submission.agent)}
                                className="archon-button-primary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusyApprove ? "Approving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                disabled={isBusyApprove || isBusyReject}
                                onClick={() => void handleReject(submission.agent)}
                                className="archon-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isBusyReject ? "Rejecting..." : "Reject"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {isConnected && !isCreator ? (
            <div className="archon-card p-5 space-y-4">
              <h3 className="text-lg font-semibold text-[#EAEAF0]">Your Submission</h3>

              {!isAccepted && mySubmission === null ? (
                <div className="space-y-3">
                  <p className="text-sm text-[#9CA3AF]">You have not accepted this job yet.</p>
                  <button
                    type="button"
                    onClick={() => void handleAccept()}
                    disabled={busyAction === "accept" || !isJobOpen(job)}
                    className="archon-button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "accept" ? "Accepting..." : "Accept Job"}
                  </button>
                </div>
              ) : null}

              {canSubmit ? (
                <form onSubmit={handleSubmitWork} className="space-y-3">
                  <label className="block text-sm text-[#EAEAF0]">
                    Deliverable Link
                    <input
                      className="archon-input mt-1"
                      type="url"
                      placeholder="https://github.com/..."
                      value={deliverableLink}
                      onChange={(event) => setDeliverableLink(event.target.value)}
                      required
                    />
                  </label>
                  <p className="text-xs text-[#9CA3AF]">GitHub PR, Notion doc, deployed app URL, IPFS link, etc.</p>
                  <button
                    type="submit"
                    disabled={busyAction === "submit"}
                    className="archon-button-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "submit" ? "Submitting..." : "Submit Work"}
                  </button>
                </form>
              ) : null}

              {mySubmission?.status === 1 ? (
                <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
                  <p>Awaiting review.</p>
                  <a
                    href={mySubmission.deliverableLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-xs underline underline-offset-4"
                  >
                    {mySubmission.deliverableLink}
                  </a>
                </div>
              ) : null}

              {canClaim ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <p>Approved! Claim your reward and credential.</p>
                  <p className="mt-1 text-xs">You will receive: {formatUsdc(netPerApproval)} USDC</p>
                  <button
                    type="button"
                    onClick={() => void handleClaim()}
                    disabled={busyAction === "claim"}
                    className="archon-button-primary mt-3 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === "claim" ? "Claiming..." : "Claim USDC + Credential"}
                  </button>
                </div>
              ) : null}

              {mySubmission?.status === 2 && mySubmission.credentialClaimed ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Approved and claimed. Credential minted.
                </div>
              ) : null}

              {mySubmission?.status === 3 ? (
                <div className="space-y-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  <p>Rejected: {mySubmission.reviewerNote || "No rejection note provided."}</p>
                  <p className="text-xs text-[#F5C2CD]">You can resubmit with an updated link.</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

