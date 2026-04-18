"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LandingPage from "@/app/landing/page";
import { LiveFeed } from "@/components/ui/live-feed";
import { SectionHeader } from "@/components/ui/section-header";
import { StatBlock } from "@/components/ui/stat";
import { ActivityEvent, initActivityFeed, subscribeToActivity } from "@/lib/activity";
import {
  CredentialRecord,
  fetchAllJobs,
  fetchCredentialsForAgent,
  formatUsdc,
  JobRecord,
  statusLabel
} from "@/lib/contracts";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

function formatDeadline(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "closed";
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours <= 0) return `${mins}m left`;
  return `${hours}h ${mins}m left`;
}

function statusBadgeClass(status: number) {
  if (status === 0) return "badge badge-pulse";
  if (status === 1) return "badge badge-warn";
  if (status === 2) return "badge badge-gold";
  return "badge badge-muted";
}

const FILTERS = ["All", "Tasks", "Tournaments"] as const;

export default function HomePage() {
  const { account } = useWallet();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [myCredentials, setMyCredentials] = useState<CredentialRecord[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<(typeof FILTERS)[number]>("All");
  const [loading, setLoading] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  const loadFeed = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const [jobRows, credentials] = await Promise.all([fetchAllJobs(), fetchCredentialsForAgent(account)]);
      setJobs(jobRows);
      setMyCredentials(credentials);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    initActivityFeed();
    const unsubscribe = subscribeToActivity(setActivityEvents);
    return unsubscribe;
  }, []);

  const myScore = useMemo(() => calculateWeightedScore(myCredentials), [myCredentials]);
  const myTier = useMemo(() => getReputationTier(myScore), [myScore]);

  const visibleJobs = useMemo(() => {
    if (selectedFilter === "Tournaments") return jobs;
    return jobs;
  }, [jobs, selectedFilter]);

  if (!account) {
    return <LandingPage />;
  }

  return (
    <section className="page-container grid gap-6 xl:grid-cols-[240px_1fr_320px]">
      <aside className="panel h-fit space-y-6">
        <SectionHeader>Your Command</SectionHeader>
        <StatBlock value={myScore} label="Score" accent="var(--arc)" />
        <div className="badge badge-agent">{myTier}</div>

        <div className="space-y-2 text-sm">
          <Link href="/" className="nav-link block">Browse Tasks</Link>
          <Link href="/my-work" className="nav-link block">My Work</Link>
          <Link href="/profile" className="nav-link block">Profile</Link>
        </div>

        <div className="space-y-2 border-t border-[var(--border)] pt-4">
          <div className="mono text-xs text-[var(--text-secondary)]">Credentials: {myCredentials.length}</div>
          <div className="mono text-xs text-[var(--text-secondary)]">Tasks Open: {jobs.filter((job) => job.status === 0).length}</div>
        </div>
      </aside>

      <main className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeader>Open Tasks</SectionHeader>
          <Link href="/create-job" className="btn-primary">Post Task</Link>
        </div>

        <div className="panel-elevated flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            if (filter === "Tournaments") {
              return (
                <button
                  key={filter}
                  type="button"
                  disabled
                  className="cursor-not-allowed border border-dashed border-[#162334] px-4 py-2 text-xs font-mono tracking-wider text-[#3D5A73] opacity-40"
                >
                  TOURNAMENTS
                  <span className="ml-2 border border-[#3D5A73] px-1 text-[9px]">SOON</span>
                </button>
              );
            }

            return (
              <button
                key={filter}
                type="button"
                onClick={() => setSelectedFilter(filter)}
                className={selectedFilter === filter ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
              >
                {filter}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="panel text-sm text-[var(--text-secondary)]">Loading feed...</div>
        ) : visibleJobs.length === 0 ? (
          <div className="panel text-sm text-[var(--text-secondary)]">No tasks match this filter yet.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visibleJobs.slice(0, 20).map((task) => {
              const status = statusLabel(task.status);
              const statusColor = task.status === 0 ? "var(--pulse)" : task.status === 1 ? "var(--warn)" : "var(--arc)";
              return (
                <Link key={task.jobId} href={`/job/${task.jobId}`} className="card-sharp group cursor-pointer overflow-hidden p-0">
                  <div className="h-[2px]" style={{ background: statusColor }} />
                  <div className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="mono text-xs text-[var(--text-muted)]">#{task.jobId}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-gold mono">{formatUsdc(task.rewardUSDC)} USDC</span>
                        <span className={statusBadgeClass(task.status)}>{status}</span>
                      </div>
                    </div>

                    <h3 className="font-heading mb-2 text-base font-semibold transition-colors group-hover:text-[var(--arc)]">
                      {task.title}
                    </h3>

                    <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">{task.description}</p>

                    <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span className="mono">{task.client.slice(0, 6)}...{task.client.slice(-4)}</span>
                        <span>-</span>
                        <span>{formatDeadline(task.deadline)}</span>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{task.submissionCount} submissions</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <aside className="panel h-fit p-0">
        <div className="px-4 pt-4">
          <SectionHeader>Live Activity</SectionHeader>
        </div>
        <LiveFeed events={activityEvents} maxVisible={10} />
      </aside>
    </section>
  );
}
