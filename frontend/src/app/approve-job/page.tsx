"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatTimestamp,
  getJobReadContract,
  getJobWriteContract,
  JobRecord,
  parseJob,
  parseSubmission,
  submissionStatusLabel,
  SubmissionRecord,
  toDisplayName
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

function submissionStatusClass(status: number) {
  if (status === 2) return "bg-emerald-500/10 text-emerald-200";
  if (status === 3) return "bg-rose-500/10 text-rose-200";
  if (status === 1) return "bg-cyan-500/10 text-cyan-200";
  return "bg-white/5 text-[#9CA3AF]";
}

export default function ApproveJobPage() {
  const { account, browserProvider, connect } = useWallet();
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busyAgent, setBusyAgent] = useState<string>("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const parsedJobId = Number(jobId);
  const isCreator = useMemo(
    () => Boolean(account && job && account.toLowerCase() === job.client.toLowerCase()),
    [account, job]
  );

  const loadReviewData = async () => {
    setStatus("");
    setError("");
    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setJob(null);
      setSubmissions([]);
      return;
    }

    setLoading(true);
    try {
      const contract = getJobReadContract();
      const [rawJob, rawSubmissions] = await Promise.all([
        contract.getJob(parsedJobId),
        contract.getSubmissions(parsedJobId)
      ]);
      setJob(parseJob(rawJob));
      setSubmissions((rawSubmissions as unknown[]).map((entry) => parseSubmission(entry)));
    } catch (err) {
      setJob(null);
      setSubmissions([]);
      setError(err instanceof Error ? err.message : "Failed to load job submissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedJobId]);

  const handleApprove = async (agent: string) => {
    setError("");
    setStatus("");
    setBusyAgent(agent);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");

      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.approveSubmission(parsedJobId, agent);
      setStatus(`Approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Approved submission from ${toDisplayName(agent)}.`);
      await loadReviewData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve submission.");
    } finally {
      setBusyAgent("");
    }
  };

  const handleReject = async (agent: string) => {
    setError("");
    setStatus("");
    setBusyAgent(agent);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");

      const note = rejectNotes[agent] ?? "";
      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.rejectSubmission(parsedJobId, agent, note);
      setStatus(`Reject transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Rejected submission from ${toDisplayName(agent)}.`);
      await loadReviewData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject submission.");
    } finally {
      setBusyAgent("");
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Review Submissions</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Creators can approve or reject each user submission before credential minting.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <div className="mt-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Job ID</span>
            <input
              aria-label="Job ID"
              type="number"
              min={0}
              className="archon-input"
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              placeholder="0"
            />
          </label>
          <button
            type="button"
            aria-label="Refresh submissions"
            onClick={() => void loadReviewData()}
            className="archon-button-secondary mt-3 px-3 py-2 text-xs"
          >
            Refresh Submissions
          </button>
        </div>
      </div>

      {loading ? <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">Loading submissions...</div> : null}

      {job ? (
        <div className="archon-card p-5 text-sm text-[#9CA3AF]">
          <h2 className="text-base font-semibold text-[#EAEAF0]">
            #{job.jobId} {job.title}
          </h2>
          <p className="mt-2">{job.description}</p>
          <p className="mt-3">Creator: {job.client}</p>
          <p>Deadline: {formatTimestamp(job.deadline)}</p>
          <p>Submissions: {job.submissionCount}</p>
          {!isCreator ? (
            <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Only the creator can approve or reject submissions for this job.
            </p>
          ) : null}
        </div>
      ) : null}

      {job && submissions.length === 0 && !loading ? (
        <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">No submissions yet for this job.</div>
      ) : null}

      {submissions.map((submission) => {
        const pending = submission.status === 1;
        const isBusy = busyAgent.toLowerCase() === submission.agent.toLowerCase();

        return (
          <article key={`${submission.agent}-${submission.submittedAt}`} className="archon-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#EAEAF0]">{toDisplayName(submission.agent)}</p>
                <p className="text-xs text-[#9CA3AF]">{submission.agent}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs ${submissionStatusClass(submission.status)}`}>
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
            {submission.reviewerNote ? <p className="mt-2 text-xs text-rose-200">Review note: {submission.reviewerNote}</p> : null}
            {submission.credentialClaimed ? <p className="mt-2 text-xs text-emerald-200">Credential already claimed.</p> : null}

            {isCreator && pending ? (
              <div className="mt-4 space-y-3">
                <textarea
                  aria-label={`Rejection reason for ${submission.agent}`}
                  className="archon-input min-h-20 text-sm"
                  placeholder="Optional rejection reason..."
                  value={rejectNotes[submission.agent] ?? ""}
                  onChange={(event) =>
                    setRejectNotes((previous) => ({
                      ...previous,
                      [submission.agent]: event.target.value
                    }))
                  }
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleApprove(submission.agent)}
                    disabled={isBusy}
                    className="archon-button-primary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? "Processing..." : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReject(submission.agent)}
                    disabled={isBusy}
                    className="archon-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? "Processing..." : "Reject"}
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
