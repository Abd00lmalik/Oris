"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { expectedChainId, isApprovedSourceOperator, txApplyToOperate } from "@/lib/contracts";
import { IconCheck, IconTask, IconWallet } from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

type ApplicationStatus = "not_applied" | "pending" | "approved";

type StoredApplication = {
  address: string;
  submittedAt: number;
  profileURI: string;
};

const STORAGE_KEY = "archon.apply.task-operator";

function readApplications(): StoredApplication[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredApplication[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeApplications(items: StoredApplication[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export default function ApplyPage() {
  const { account, browserProvider, connect } = useWallet();

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState<ApplicationStatus>("not_applied");

  const [name, setName] = useState("");
  const [taskTypes, setTaskTypes] = useState("");
  const [profileLink, setProfileLink] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      if (!account) {
        setApplicationStatus("not_applied");
        return;
      }
      const cached = readApplications().some((item) => item.address.toLowerCase() === account.toLowerCase());
      try {
        const [approvedTask, approvedJob] = await Promise.all([
          isApprovedSourceOperator("task", account),
          isApprovedSourceOperator("job", account)
        ]);
        if (!active) return;
        if (approvedTask || approvedJob) {
          setApplicationStatus("approved");
        } else if (cached) {
          setApplicationStatus("pending");
        } else {
          setApplicationStatus("not_applied");
        }
      } catch {
        if (!active) return;
        setApplicationStatus(cached ? "pending" : "not_applied");
      }
    };
    void loadStatus();
    return () => {
      active = false;
    };
  }, [account, status]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleApply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!account) {
      setError("Connect wallet before submitting your application.");
      return;
    }
    if (reason.trim().length < 100) {
      setError("Why should we approve you? must be at least 100 characters.");
      return;
    }
    if (!profileLink.startsWith("http://") && !profileLink.startsWith("https://")) {
      setError("Profile link must start with http:// or https://");
      return;
    }

    setSubmitting(true);
    try {
      const provider = await withProvider();
      const profileURI = JSON.stringify({
        nameOrOrganization: name.trim(),
        taskTypes: taskTypes.trim(),
        profileLink: profileLink.trim(),
        reason: reason.trim()
      });
      const tx = await txApplyToOperate(provider, "task", profileURI);
      setStatus(`Application submitted. Transaction: ${tx.hash}`);
      await tx.wait();

      const entries = readApplications().filter((item) => item.address.toLowerCase() !== account.toLowerCase());
      entries.push({
        address: account,
        submittedAt: Date.now(),
        profileURI
      });
      writeApplications(entries);

      setApplicationStatus("pending");
      setShowApplyForm(false);
      setName("");
      setTaskTypes("");
      setProfileLink("");
      setReason("");
      setStatus("Application submitted. Review typically takes 24-48 hours.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit application.");
    } finally {
      setSubmitting(false);
    }
  };

  const statusLabel = useMemo(() => {
    if (applicationStatus === "approved") return "Approved";
    if (applicationStatus === "pending") return "Pending";
    return "Not Applied";
  }, [applicationStatus]);

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Get Started on Archon</h1>

        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-white/10 bg-[#111214] p-4">
            <h2 className="text-sm font-semibold text-[#EAEAF0]">Step 1: Connect Your Wallet</h2>
            {!account ? (
              <button
                type="button"
                onClick={() => void connect()}
                className="archon-button-primary mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm"
              >
                <IconWallet className="h-4 w-4" />
                Connect Wallet
              </button>
            ) : (
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-emerald-300">
                <IconCheck className="h-4 w-4" />
                Connected: {account}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#111214] p-4">
            <h2 className="text-sm font-semibold text-[#EAEAF0]">Step 2: Choose Your Role</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <article className="rounded-xl border border-white/10 bg-[#0f1013] p-4 text-sm text-[#9CA3AF]">
                <h3 className="font-semibold text-[#EAEAF0]">I want to complete tasks and earn</h3>
                <p className="mt-2">
                  Browse open tasks, submit your work, get paid in USDC, and build your on-chain reputation.
                </p>
                <p className="mt-2 text-xs">No application required. Connect your wallet and start working on any open task.</p>
                <Link href="/" className="archon-button-secondary mt-3 inline-flex px-3 py-2 text-xs">
                  Browse Open Tasks
                </Link>
              </article>

              <article className="rounded-xl border border-white/10 bg-[#0f1013] p-4 text-sm text-[#9CA3AF]">
                <h3 className="font-semibold text-[#EAEAF0]">I want to post tasks for others to complete</h3>
                <p className="mt-2">
                  Create tasks with USDC rewards. Requires platform approval to prevent spam.
                </p>
                <button
                  type="button"
                  onClick={() => setShowApplyForm((previous) => !previous)}
                  className="archon-button-primary mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs"
                >
                  <IconTask className="h-4 w-4" />
                  Apply to Post Tasks
                </button>
                <p className="mt-2 text-xs">Current status: {statusLabel}</p>
              </article>
            </div>
          </div>
        </div>
      </div>

      {status ? (
        <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {showApplyForm ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Task Poster Application</h2>
          <form onSubmit={handleApply} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Name or organization
              <input className="archon-input mt-1" value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              What type of tasks do you plan to post?
              <input
                className="archon-input mt-1"
                value={taskTypes}
                onChange={(event) => setTaskTypes(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Link to your GitHub, LinkedIn or portfolio
              <input
                className="archon-input mt-1"
                type="url"
                value={profileLink}
                onChange={(event) => setProfileLink(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Why should we approve you?
              <textarea
                className="archon-input mt-1 min-h-28"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
              <p className="mt-1 text-xs text-[#9CA3AF]">{reason.trim().length}/100 minimum characters</p>
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
