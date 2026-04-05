"use client";

import Image from "next/image";
import Link from "next/link";
import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentTaskRecord,
  CredentialRecord,
  fetchAllJobs,
  fetchCredentialsForAgent,
  fetchJobsByAgent,
  fetchJobsCreatedCount,
  fetchOpenAgentTasks,
  fetchSubmissionForAgent,
  formatTimestamp,
  formatUsdc,
  getJobReadContract,
  getReadProvider,
  getRegistryReadContract,
  getSourceLabelForDisplay,
  isContractsConfigured,
  JobRecord,
  parseCredential,
  statusLabel,
  SubmissionRecord
} from "@/lib/contracts";
import { subscribeToNewJobs, subscribeToOpenTasks } from "@/lib/events";
import { useWallet } from "@/lib/wallet-context";

type JobViewerState = {
  submission: SubmissionRecord | null;
  accepted: boolean;
};

function statusClasses(status: number) {
  if (status === 0) return "bg-[#00D1B2]/15 text-[#6EF2DE]";
  return "bg-white/5 text-[#9CA3AF]";
}

function sourceBadgeClass(sourceType: string) {
  if (sourceType === "github") return "bg-[#8B5CF6]/20 text-[#C4B5FD]";
  if (sourceType === "agent_task") return "bg-[#3B82F6]/20 text-[#93C5FD]";
  if (sourceType === "community") return "bg-[#F59E0B]/20 text-[#FCD34D]";
  if (sourceType === "peer_attestation") return "bg-[#EC4899]/20 text-[#F9A8D4]";
  if (sourceType === "dao_governance") return "bg-[#6366F1]/20 text-[#A5B4FC]";
  return "bg-[#00D1B2]/15 text-[#6EF2DE]";
}

export default function HomePage() {
  const { account, browserProvider } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [recentCredentials, setRecentCredentials] = useState<CredentialRecord[]>([]);
  const [viewerStateByJob, setViewerStateByJob] = useState<Record<number, JobViewerState>>({});
  const [creatorJobCount, setCreatorJobCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [stats, setStats] = useState({
    totalCredentials: 0,
    totalUsdcPaidOut: "0",
    totalWalletsVerified: 0
  });

  const configured = useMemo(() => isContractsConfigured(), []);

  const loadFeed = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    setError("");

    try {
      const [jobRows, taskRows] = await Promise.all([fetchAllJobs(), fetchOpenAgentTasks()]);
      const visibleJobs = jobRows.slice(0, 12);
      setJobs(visibleJobs);
      setTasks(taskRows.filter((task) => task.status === 0).slice(0, 8));

      const uniqueCreators = Array.from(new Set(visibleJobs.map((job) => job.client.toLowerCase())));
      const creatorCounts = await Promise.all(
        uniqueCreators.map(async (creator) => [creator, await fetchJobsCreatedCount(creator)] as const)
      );
      setCreatorJobCount(Object.fromEntries(creatorCounts));

      if (account) {
        const readContract = getJobReadContract();
        const viewerEntries = await Promise.all(
          visibleJobs.map(async (job) => {
            const [submission, accepted] = await Promise.all([
              fetchSubmissionForAgent(job.jobId, account),
              (async () => {
                try {
                  return (await readContract.isAccepted(job.jobId, account)) as boolean;
                } catch {
                  return false;
                }
              })()
            ]);
            return [job.jobId, { submission, accepted }] as const;
          })
        );
        setViewerStateByJob(Object.fromEntries(viewerEntries));
      } else {
        setViewerStateByJob({});
      }

      const registry = getRegistryReadContract();
      const totalCredentials = Number(await registry.totalCredentials());
      const credentials: CredentialRecord[] = [];
      const wallets = new Set<string>();
      const start = Math.max(1, totalCredentials - 9);
      for (let credentialId = totalCredentials; credentialId >= start; credentialId--) {
        const credential = parseCredential(await registry.getCredential(credentialId));
        if (credential.agent !== ethers.ZeroAddress) {
          credentials.push(credential);
          wallets.add(credential.agent.toLowerCase());
        }
      }
      setRecentCredentials(credentials);

      const jobPayout = jobRows.reduce((sum, job) => sum + BigInt(job.paidOutUSDC || "0"), 0n);
      const taskPayout = taskRows.reduce((sum, task) => sum + BigInt(task.rewardClaimed ? task.rewardUSDC : "0"), 0n);
      setStats({
        totalCredentials,
        totalUsdcPaidOut: formatUsdc(jobPayout + taskPayout),
        totalWalletsVerified: wallets.size
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load activity feed.");
    } finally {
      setLoading(false);
    }
  }, [account, configured]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!configured) return () => undefined;
    const provider = browserProvider ?? getReadProvider();
    const unsubs = [
      subscribeToNewJobs(provider, () => {
        void loadFeed();
      }),
      subscribeToOpenTasks(provider, () => {
        void loadFeed();
      })
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [browserProvider, configured, loadFeed]);

  useEffect(() => {
    let active = true;
    const checkWelcome = async () => {
      if (!account) {
        setShowWelcomeBanner(false);
        return;
      }
      const dismissKey = `archon.welcome.dismissed.${account.toLowerCase()}`;
      if (typeof window !== "undefined" && window.localStorage.getItem(dismissKey) === "true") {
        setShowWelcomeBanner(false);
        return;
      }

      try {
        const [credentials, jobsAsAgent] = await Promise.all([
          fetchCredentialsForAgent(account),
          fetchJobsByAgent(account)
        ]);
        let hasSubmitted = false;
        for (const job of jobsAsAgent) {
          const submission = await fetchSubmissionForAgent(job.jobId, account);
          if (submission && submission.submittedAt > 0) {
            hasSubmitted = true;
            break;
          }
        }
        if (!active) return;
        setShowWelcomeBanner(credentials.length === 0 && !hasSubmitted);
      } catch {
        if (!active) return;
        setShowWelcomeBanner(false);
      }
    };
    void checkWelcome();
    return () => {
      active = false;
    };
  }, [account]);

  const dismissWelcome = () => {
    if (!account || typeof window === "undefined") return;
    window.localStorage.setItem(`archon.welcome.dismissed.${account.toLowerCase()}`, "true");
    setShowWelcomeBanner(false);
  };

  return (
    <section className="space-y-8">
      <div className="archon-card p-6 text-center md:p-8">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
          <Image src="/logo.svg" alt="Archon" width={220} height={70} priority />
          <h1 className="text-3xl font-semibold tracking-wide text-[#EAEAF0]">Archon</h1>
        </div>
      </div>

      {showWelcomeBanner ? (
        <div className="archon-card border border-[#00D1B2]/30 bg-[#00D1B2]/10 p-4">
          <p className="text-sm font-semibold text-[#EAEAF0]">Welcome to Archon - Start Building Your Reputation</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/" className="archon-button-secondary px-3 py-2 text-xs">
              Browse Tasks
            </Link>
            <Link href="/my-work" className="archon-button-secondary px-3 py-2 text-xs">
              Submit Task Deliverables
            </Link>
            <Link href="/attest" className="archon-button-secondary px-3 py-2 text-xs">
              Get Vouched By Peers
            </Link>
            <button type="button" onClick={dismissWelcome} className="archon-button-primary px-3 py-2 text-xs">
              Dismiss - do not show again
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Credentials Minted</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalCredentials}</p>
        </div>
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">USDC Paid Out</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalUsdcPaidOut}</p>
        </div>
        <div className="archon-card p-4">
          <p className="text-xs uppercase tracking-wide text-[#9CA3AF]">Wallets Verified</p>
          <p className="mt-2 text-2xl font-semibold text-[#EAEAF0]">{stats.totalWalletsVerified}</p>
        </div>
      </div>

      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      ) : null}

      <div className="archon-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Recent Credentials Minted</h2>
          <Link href="/profile" className="text-xs text-[#9CA3AF] hover:text-[#EAEAF0]">
            View profile
          </Link>
        </div>
        {recentCredentials.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">{loading ? "Loading credentials..." : "No credentials minted yet."}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {recentCredentials.map((credential) => (
              <div
                key={credential.credentialId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm"
              >
                <div>
                  <p className="text-[#EAEAF0]">
                    Credential #{credential.credentialId} | {credential.agent.slice(0, 8)}...{credential.agent.slice(-4)}
                  </p>
                  <p className="text-xs text-[#9CA3AF]">{formatTimestamp(credential.issuedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${sourceBadgeClass(credential.sourceType)}`}>
                    {getSourceLabelForDisplay(credential.sourceType)}
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-[#9CA3AF]">+{credential.weight} pts</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-wide text-[#EAEAF0]">Recent Jobs</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Refresh jobs and tasks"
            onClick={() => void loadFeed()}
            className="archon-button-secondary px-3 py-2 text-sm transition-all duration-200"
          >
            Refresh
          </button>
          <Link href="/create-job" className="archon-button-primary px-4 py-2 text-sm transition-all duration-200">
            Create Task
          </Link>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Loading jobs" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="archon-card h-56 animate-pulse p-4" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="archon-card px-5 py-10 text-center text-sm text-[#9CA3AF]">No jobs available yet. Create the first posting.</div>
      ) : (
        <div aria-label="Job listings" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => {
            const creatorKey = job.client.toLowerCase();
            const creatorCount = creatorJobCount[creatorKey] ?? 0;
            const viewerState = viewerStateByJob[job.jobId];
            const isCreator = Boolean(account && account.toLowerCase() === creatorKey);
            const hasSubmission = Boolean(viewerState?.submission);

            return (
              <article key={job.jobId} className="archon-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/job/${job.jobId}`} className="text-base font-semibold tracking-wide text-[#EAEAF0] hover:text-[#00D1B2]">
                    #{job.jobId} {job.title}
                  </Link>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusClasses(job.status)}`}>{statusLabel(job.status)}</span>
                </div>

                <p className="mt-3 line-clamp-3 text-sm text-[#9CA3AF]">{job.description}</p>

                <div className="mt-4 space-y-1 text-xs text-[#9CA3AF]">
                  <p>Reward Pool: {formatUsdc(job.rewardUSDC)} USDC</p>
                  <p>Paid Out: {formatUsdc(job.paidOutUSDC)} USDC</p>
                  <p>Deadline: {formatTimestamp(job.deadline)}</p>
                  <p>Creator: {creatorCount} jobs posted</p>
                  <p>
                    Accepted: {job.acceptedCount} | Submissions: {job.submissionCount} | Approved: {job.approvedCount}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link href={`/job/${job.jobId}`} className="archon-button-secondary px-3 py-1.5 text-xs">
                    View Job
                  </Link>

                  {account ? (
                    isCreator ? (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        Review Submissions ({job.submissionCount})
                      </Link>
                    ) : hasSubmission ? (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        View My Submission
                      </Link>
                    ) : (
                      <Link href={`/job/${job.jobId}`} className="archon-button-primary px-3 py-1.5 text-xs">
                        View & Apply
                      </Link>
                    )
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="archon-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Open Agent Tasks</h2>
          <Link href="/tasks" className="text-xs text-[#9CA3AF] hover:text-[#EAEAF0]">
            Open Tasks Hub
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No open agent tasks right now.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {tasks.map((task) => (
              <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-3">
                <p className="text-sm font-medium text-[#EAEAF0]">Task #{task.taskId}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[#9CA3AF]">{task.taskDescription}</p>
                <p className="mt-2 text-xs text-[#9CA3AF]">Reward: {formatUsdc(task.rewardUSDC)} USDC</p>
                <p className="text-xs text-[#9CA3AF]">Deadline: {formatTimestamp(task.deadline)}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}


