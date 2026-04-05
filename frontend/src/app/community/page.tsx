"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CommunityActivityRecord,
  expectedChainId,
  fetchCommunityActivitiesByRecipient,
  isApprovedSourceOperator,
  shortAddress,
  txAwardCommunityActivity,
  txClaimCommunityCredential
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

const COMMUNITY_TYPES = [
  { id: 0, label: "Helped a user solve a problem (Discord/Telegram)" },
  { id: 1, label: "Moderated community spaces" },
  { id: 2, label: "Created a tutorial, guide or thread" },
  { id: 3, label: "Organized a community event or workshop" },
  { id: 4, label: "Submitted a verified bug report" }
] as const;

type CommunityApplication = {
  address: string;
  summary: string;
  evidenceLink: string;
  submittedAt: number;
};

const APPLICATION_KEY = "archon.community.applications";

function readApplications(): CommunityApplication[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(APPLICATION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CommunityApplication[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeApplications(items: CommunityApplication[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(APPLICATION_KEY, JSON.stringify(items));
}

export default function CommunityPage() {
  const { account, browserProvider, connect } = useWallet();
  const [isOperator, setIsOperator] = useState(false);
  const [activities, setActivities] = useState<CommunityActivityRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showApply, setShowApply] = useState(false);

  const [applicationSummary, setApplicationSummary] = useState("");
  const [applicationLink, setApplicationLink] = useState("");

  const [recipient, setRecipient] = useState("");
  const [activityType, setActivityType] = useState(0);
  const [platform, setPlatform] = useState("discord");
  const [evidenceNote, setEvidenceNote] = useState("");

  const myApplication = account
    ? readApplications().find((item) => item.address.toLowerCase() === account.toLowerCase()) ?? null
    : null;

  const pendingAwards = useMemo(
    () => activities.filter((activity) => !activity.credentialClaimed),
    [activities]
  );

  const load = useCallback(async () => {
    if (!account) {
      setActivities([]);
      setIsOperator(false);
      return;
    }
    setLoading(true);
    try {
      const [list, approved] = await Promise.all([
        fetchCommunityActivitiesByRecipient(account),
        isApprovedSourceOperator("community", account)
      ]);
      setActivities(list);
      setIsOperator(approved);
    } catch {
      setActivities([]);
      setIsOperator(false);
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleAward = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      const provider = await withProvider();
      const tx = await txAwardCommunityActivity(
        provider,
        recipient.trim(),
        activityType,
        platform.trim(),
        evidenceNote.trim()
      );
      setStatus(`Award transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Community activity awarded.");
      setRecipient("");
      setEvidenceNote("");
      await load();
    } catch (awardError) {
      setError(awardError instanceof Error ? awardError.message : "Failed to award community activity.");
    }
  };

  const handleClaim = async (activityId: number) => {
    setBusyId(activityId);
    setError("");
    setStatus("");
    try {
      const provider = await withProvider();
      const tx = await txClaimCommunityCredential(provider, activityId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Community credential claimed for activity #${activityId}.`);
      await load();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim credential.");
    } finally {
      setBusyId(null);
    }
  };

  const handleApplication = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    if (!account) {
      setError("Connect your wallet before submitting an application.");
      return;
    }
    if (applicationSummary.trim().length < 20) {
      setError("Please describe your contribution in more detail.");
      return;
    }

    const list = readApplications().filter(
      (item) => item.address.toLowerCase() !== account.toLowerCase()
    );
    list.push({
      address: account,
      summary: applicationSummary.trim(),
      evidenceLink: applicationLink.trim(),
      submittedAt: Date.now()
    });
    writeApplications(list);
    setStatus("Application submitted. Review typically takes 24-48 hours.");
    setApplicationSummary("");
    setApplicationLink("");
    setShowApply(false);
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Community Credentials</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Awarded by verified platform moderators for real contributions to the CredentialHook community.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          Community credentials are awarded by platform-approved moderators. You cannot self-claim these. If you
          believe you deserve one, apply below and a moderator will review.
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

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Claim a Community Credential</h2>
        {loading ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Loading awards...</p>
        ) : pendingAwards.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">You have no pending community awards.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {pendingAwards.map((activity) => (
              <article key={activity.activityId} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                <p className="font-medium text-[#EAEAF0]">Award #{activity.activityId}</p>
                <p className="mt-1 text-xs">{COMMUNITY_TYPES[activity.activityType]?.label ?? `Type ${activity.activityType}`}</p>
                <p className="mt-1 text-xs">Platform: {activity.platform}</p>
                <p className="mt-1 text-xs">Evidence: {activity.evidenceNote}</p>
                <button
                  type="button"
                  onClick={() => void handleClaim(activity.activityId)}
                  disabled={busyId === activity.activityId}
                  className="archon-button-secondary mt-3 px-3 py-2 text-xs"
                >
                  {busyId === activity.activityId ? "Claiming..." : "Claim Credential"}
                </button>
              </article>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-xs text-[#9CA3AF]">
          <p>This is a request, not a guarantee. A moderator will review within 48 hours.</p>
          {myApplication ? (
            <p className="mt-1">
              Current status: Pending | Applied as {shortAddress(myApplication.address)} on{" "}
              {new Date(myApplication.submittedAt).toLocaleString()}
            </p>
          ) : (
            <p className="mt-1">Current status: Not Applied</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowApply((previous) => !previous)}
          className="archon-button-primary mt-3 px-3 py-2 text-sm"
        >
          Apply for Community Recognition
        </button>

        {showApply ? (
          <form onSubmit={handleApplication} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Describe what you did
              <textarea
                className="archon-input mt-1 min-h-24"
                value={applicationSummary}
                onChange={(event) => setApplicationSummary(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Optional supporting link
              <input
                className="archon-input mt-1"
                value={applicationLink}
                onChange={(event) => setApplicationLink(event.target.value)}
                placeholder="https://..."
              />
            </label>
            <button type="submit" className="archon-button-secondary px-3 py-2 text-sm">
              Submit Application
            </button>
          </form>
        ) : null}
      </div>

      {isOperator ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Award a Credential</h2>
          <p className="mt-1 text-sm text-[#9CA3AF]">Visible because your wallet is approved for source type &quot;community&quot;.</p>
          <form onSubmit={handleAward} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Recipient address
              <input
                className="archon-input mt-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                required
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Activity type
                <select
                  className="archon-input mt-1"
                  value={activityType}
                  onChange={(event) => setActivityType(Number(event.target.value))}
                >
                  {COMMUNITY_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Platform
                <input
                  className="archon-input mt-1"
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                  required
                />
              </label>
            </div>
            <label className="block text-sm text-[#9CA3AF]">
              Evidence note
              <textarea
                className="archon-input mt-1 min-h-20"
                value={evidenceNote}
                onChange={(event) => setEvidenceNote(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="archon-button-primary w-full px-4 py-2.5 text-sm">
              Award Activity
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}

