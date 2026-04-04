"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatTimestamp,
  formatUsdc,
  getJobReadContract,
  getReadProvider,
  isJobOpen,
  JobRecord,
  parseJob,
  parseSubmission,
  statusLabel,
  submissionStatusLabel,
  SubmissionRecord,
  toDisplayName
} from "@/lib/contracts";
import { subscribeToJobUpdates } from "@/lib/events";
import { useWallet } from "@/lib/wallet-context";

function submissionStatusClass(status: number) {
  if (status === 2) return "bg-emerald-500/10 text-emerald-200";
  if (status === 3) return "bg-rose-500/10 text-rose-200";
  if (status === 1) return "bg-cyan-500/10 text-cyan-200";
  return "bg-white/5 text-[#9CA3AF]";
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const { browserProvider } = useWallet();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);

  const loadJob = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setError("Invalid job ID.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const contract = getJobReadContract();
      const [rawJob, rawSubmissions] = await Promise.all([contract.getJob(jobId), contract.getSubmissions(jobId)]);
      setJob(parseJob(rawJob));
      setSubmissions((rawSubmissions as unknown[]).map((item) => parseSubmission(item)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load job.");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;

    const unsubscribe = subscribeToJobUpdates(browserProvider ?? getReadProvider(), jobId, () => {
      void loadJob();
      setToast("Job activity updated");
      setTimeout(() => setToast(""), 1800);
    });

    return unsubscribe;
  }, [browserProvider, jobId, loadJob]);

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Job Details</h1>
        <Link href="/" className="archon-button-secondary px-3 py-2 text-sm">
          Back to Jobs
        </Link>
      </div>

      {toast ? <div className="archon-card border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200">{toast}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">Loading job...</div>
      ) : job ? (
        <>
          <div className="archon-card space-y-4 p-5 text-sm text-[#9CA3AF]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#EAEAF0]">
                #{job.jobId} {job.title}
              </h2>
              <span className="rounded-full bg-white/5 px-2 py-1 text-xs">{statusLabel(job.status)}</span>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
              <span className="font-medium text-[#EAEAF0]">Description:</span> {job.description}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Client:</span> {job.client}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Reward:</span> {formatUsdc(job.rewardUSDC)} USDC
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Deadline:</span> {formatTimestamp(job.deadline)}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Open:</span> {isJobOpen(job) ? "Yes" : "No"}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Accepted:</span> {job.acceptedCount}
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
                <span className="font-medium text-[#EAEAF0]">Submissions:</span> {job.submissionCount}
              </div>
            </div>
          </div>

          <div className="archon-card p-5">
            <h3 className="text-base font-semibold text-[#EAEAF0]">Submissions</h3>
            {submissions.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No submissions yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {submissions.map((submission) => (
                  <article key={`${submission.agent}-${submission.submittedAt}`} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-[#EAEAF0]">{toDisplayName(submission.agent)}</p>
                        <p className="text-xs">{submission.agent}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs ${submissionStatusClass(submission.status)}`}>
                        {submissionStatusLabel(submission.status)}
                      </span>
                    </div>
                    <a href={submission.deliverableLink} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-[#8FD9FF] underline underline-offset-4">
                      {submission.deliverableLink}
                    </a>
                    <p className="mt-2 text-xs">Submitted: {formatTimestamp(submission.submittedAt)}</p>
                    {submission.reviewerNote ? <p className="mt-1 text-xs text-rose-200">Note: {submission.reviewerNote}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="archon-card px-4 py-5 text-sm text-[#9CA3AF]">Job not found.</div>
      )}
    </section>
  );
}
