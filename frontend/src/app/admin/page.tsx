"use client";

import { ethers } from "ethers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CommunityApplicationRecord,
  expectedChainId,
  fetchApprovedOperatorsForSource,
  fetchCommunityActiveModeratorCount,
  fetchCommunityModerators,
  fetchDaoGovernors,
  fetchJobPlatformSettings,
  fetchPendingCommunityApplications,
  fetchPendingSourceApplications,
  fetchSourceRegistryOwner,
  fetchTotalApprovedOperators,
  fetchTotalJobsCreated,
  formatTimestamp,
  formatUsdc,
  getRegistryReadContract,
  shortAddress,
  txAddDaoGovernor,
  txApproveCommunityApplication,
  txApproveSourceOperator,
  txDeactivateCommunityModerator,
  txRegisterCommunityModerator,
  txRejectCommunityApplication,
  txRemoveDaoGovernor,
  txRevokeSourceOperator,
  txSetMinJobStake,
  txSetPlatformFeeBps,
  txSetRequireCredentialToPost
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type CreatorApplication = {
  operator: string;
  sourceType: string;
  profileURI: string;
  appliedAt: number;
};

const COMMUNITY_TYPES = [
  { id: 0, label: "Helped a Community Member" },
  { id: 1, label: "Moderated Community Spaces" },
  { id: 2, label: "Created Educational Content" },
  { id: 3, label: "Organized a Community Event" },
  { id: 4, label: "Reported a Verified Bug" }
] as const;

const DAO_NAME_STORAGE_KEY = "archon.admin.dao-names";

function parseProfileURI(profileURI: string) {
  try {
    return JSON.parse(profileURI) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default function AdminPage() {
  const { account, browserProvider, connect } = useWallet();

  const [ownerAddress, setOwnerAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const [totalCredentials, setTotalCredentials] = useState(0);
  const [totalTasksCreated, setTotalTasksCreated] = useState(0);
  const [totalApprovedCreators, setTotalApprovedCreators] = useState(0);
  const [activeModeratorCount, setActiveModeratorCount] = useState(0);

  const [pendingCreatorApplications, setPendingCreatorApplications] = useState<CreatorApplication[]>([]);
  const [dismissedApplications, setDismissedApplications] = useState<Record<string, boolean>>({});

  const [taskCreators, setTaskCreators] = useState<string[]>([]);
  const [agentTaskPosters, setAgentTaskPosters] = useState<string[]>([]);
  const [communityOperators, setCommunityOperators] = useState<string[]>([]);

  const [moderators, setModerators] = useState<Awaited<ReturnType<typeof fetchCommunityModerators>>>([]);
  const [moderatorWallet, setModeratorWallet] = useState("");
  const [moderatorName, setModeratorName] = useState("");
  const [moderatorRole, setModeratorRole] = useState("");
  const [moderatorProfileURI, setModeratorProfileURI] = useState("");

  const [pendingCommunityApplications, setPendingCommunityApplications] = useState<CommunityApplicationRecord[]>([]);
  const [communityTypeByApplication, setCommunityTypeByApplication] = useState<Record<number, number>>({});
  const [communityApproveNoteByApplication, setCommunityApproveNoteByApplication] = useState<Record<number, string>>({});
  const [communityRejectNoteByApplication, setCommunityRejectNoteByApplication] = useState<Record<number, string>>({});

  const [governors, setGovernors] = useState<string[]>([]);
  const [governorAddressInput, setGovernorAddressInput] = useState("");
  const [governorNameInput, setGovernorNameInput] = useState("");
  const [governorNames, setGovernorNames] = useState<Record<string, string>>({});

  const [settings, setSettings] = useState<{
    minJobStake: bigint;
    platformFeeBps: number;
    platformTreasury: string;
    requireCredentialToPost: boolean;
    cooldownSeconds: number;
  } | null>(null);
  const [minStakeInput, setMinStakeInput] = useState("5");
  const [platformFeeInput, setPlatformFeeInput] = useState("10");

  const isOwner = useMemo(() => {
    if (!account || !ownerAddress) return false;
    return account.toLowerCase() === ownerAddress.toLowerCase();
  }, [account, ownerAddress]);

  const visibleCreatorApplications = useMemo(
    () => pendingCreatorApplications.filter((a) => !dismissedApplications[a.operator.toLowerCase()]),
    [dismissedApplications, pendingCreatorApplications]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DAO_NAME_STORAGE_KEY);
      if (!raw) return;
      setGovernorNames(JSON.parse(raw) as Record<string, string>);
    } catch {
      // Ignore malformed local storage.
    }
  }, []);

  const persistDaoNames = (next: Record<string, string>) => {
    setGovernorNames(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DAO_NAME_STORAGE_KEY, JSON.stringify(next));
    }
  };

  const withProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const owner = await fetchSourceRegistryOwner();
      setOwnerAddress(owner);

      const registry = getRegistryReadContract();
      const totalCredentialsValue = Number(await registry.totalCredentials());

      const [
        taskCount,
        approvedCount,
        moderatorCount,
        pendingTask,
        pendingJob,
        approvedTask,
        approvedJob,
        approvedAgentTask,
        approvedCommunity,
        moderatorList,
        pendingCommunity,
        daoList,
        settingsRow
      ] = await Promise.all([
        fetchTotalJobsCreated(),
        fetchTotalApprovedOperators(),
        fetchCommunityActiveModeratorCount(),
        fetchPendingSourceApplications("task"),
        fetchPendingSourceApplications("job"),
        fetchApprovedOperatorsForSource("task"),
        fetchApprovedOperatorsForSource("job"),
        fetchApprovedOperatorsForSource("agent_task"),
        fetchApprovedOperatorsForSource("community"),
        fetchCommunityModerators(),
        fetchPendingCommunityApplications(),
        fetchDaoGovernors(),
        fetchJobPlatformSettings()
      ]);

      const mergedApps: Record<string, CreatorApplication> = {};
      [...pendingTask, ...pendingJob].forEach((item) => {
        const key = item.operator.toLowerCase();
        if (!mergedApps[key] || item.appliedAt > mergedApps[key].appliedAt) {
          mergedApps[key] = {
            operator: item.operator,
            sourceType: item.sourceType,
            profileURI: item.profileURI,
            appliedAt: item.appliedAt
          };
        }
      });

      setTotalCredentials(totalCredentialsValue);
      setTotalTasksCreated(taskCount);
      setTotalApprovedCreators(approvedCount);
      setActiveModeratorCount(moderatorCount);
      setPendingCreatorApplications(Object.values(mergedApps).sort((a, b) => b.appliedAt - a.appliedAt));
      setTaskCreators(Array.from(new Set([...approvedTask, ...approvedJob])));
      setAgentTaskPosters(approvedAgentTask);
      setCommunityOperators(approvedCommunity);
      setModerators(moderatorList);
      setPendingCommunityApplications(pendingCommunity);
      setGovernors(daoList);
      setSettings(settingsRow);
      setMinStakeInput(ethers.formatUnits(settingsRow.minJobStake, 6));
      setPlatformFeeInput((settingsRow.platformFeeBps / 100).toString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const executeAction = async (key: string, action: () => Promise<void>) => {
    setBusyKey(key);
    setStatus("");
    setError("");
    try {
      await action();
      await loadAdminData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusyKey("");
    }
  };

  const handleApproveCreator = (wallet: string) => {
    void executeAction(`approve-creator-${wallet.toLowerCase()}`, async () => {
      const provider = await withProvider();
      const txTask = await txApproveSourceOperator(provider, "task", wallet);
      await txTask.wait();
      const txJob = await txApproveSourceOperator(provider, "job", wallet);
      await txJob.wait();
      setStatus(`Approved ${shortAddress(wallet)} as task creator.`);
    });
  };

  const handleApproveTaskPoster = (wallet: string) => {
    void executeAction(`approve-poster-${wallet.toLowerCase()}`, async () => {
      const provider = await withProvider();
      const tx = await txApproveSourceOperator(provider, "agent_task", wallet);
      await tx.wait();
      setStatus(`Approved ${shortAddress(wallet)} as task poster.`);
    });
  };

  const handleRevokeOperator = (sourceType: "task" | "agent_task" | "community", wallet: string) => {
    void executeAction(`revoke-${sourceType}-${wallet.toLowerCase()}`, async () => {
      const provider = await withProvider();
      if (sourceType === "task") {
        const txTask = await txRevokeSourceOperator(provider, "task", wallet);
        await txTask.wait();
        const txJob = await txRevokeSourceOperator(provider, "job", wallet);
        await txJob.wait();
      } else {
        const tx = await txRevokeSourceOperator(provider, sourceType, wallet);
        await tx.wait();
      }
      setStatus(`Revoked ${shortAddress(wallet)} from ${sourceType}.`);
    });
  };

  const handleRegisterModerator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!moderatorWallet.trim() || !moderatorName.trim() || !moderatorRole.trim()) {
      setError("Moderator wallet, display name, and role are required.");
      return;
    }

    void executeAction("register-moderator", async () => {
      const provider = await withProvider();
      const txApproval = await txApproveSourceOperator(provider, "community", moderatorWallet.trim());
      await txApproval.wait();
      const tx = await txRegisterCommunityModerator(
        provider,
        moderatorWallet.trim(),
        moderatorName.trim(),
        moderatorRole.trim(),
        moderatorProfileURI.trim()
      );
      await tx.wait();
      setModeratorWallet("");
      setModeratorName("");
      setModeratorRole("");
      setModeratorProfileURI("");
      setStatus("Community moderator registered.");
    });
  };

  const handleDeactivateModerator = (wallet: string) => {
    void executeAction(`deactivate-moderator-${wallet.toLowerCase()}`, async () => {
      const provider = await withProvider();
      const tx = await txDeactivateCommunityModerator(provider, wallet);
      await tx.wait();
      setStatus(`Moderator ${shortAddress(wallet)} deactivated.`);
    });
  };

  const handleApproveCommunityApplication = (applicationId: number) => {
    void executeAction(`approve-community-${applicationId}`, async () => {
      const provider = await withProvider();
      const activityType = communityTypeByApplication[applicationId] ?? 0;
      const reviewNote = communityApproveNoteByApplication[applicationId] ?? "";
      const tx = await txApproveCommunityApplication(provider, applicationId, activityType, reviewNote);
      await tx.wait();
      setStatus(`Community application #${applicationId} approved.`);
    });
  };

  const handleRejectCommunityApplication = (applicationId: number) => {
    const note = (communityRejectNoteByApplication[applicationId] ?? "").trim();
    if (!note) {
      setError("Rejection note is required.");
      return;
    }

    void executeAction(`reject-community-${applicationId}`, async () => {
      const provider = await withProvider();
      const tx = await txRejectCommunityApplication(provider, applicationId, note);
      await tx.wait();
      setStatus(`Community application #${applicationId} rejected.`);
    });
  };

  const handleAddGovernor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!governorAddressInput.trim()) {
      setError("Governor contract address is required.");
      return;
    }

    void executeAction("add-governor", async () => {
      const provider = await withProvider();
      const tx = await txAddDaoGovernor(provider, governorAddressInput.trim());
      await tx.wait();
      if (governorNameInput.trim()) {
        const next = {
          ...governorNames,
          [governorAddressInput.trim().toLowerCase()]: governorNameInput.trim()
        };
        persistDaoNames(next);
      }
      setGovernorAddressInput("");
      setGovernorNameInput("");
      setStatus("Governor added.");
    });
  };

  const handleRemoveGovernor = (wallet: string) => {
    void executeAction(`remove-governor-${wallet.toLowerCase()}`, async () => {
      const provider = await withProvider();
      const tx = await txRemoveDaoGovernor(provider, wallet);
      await tx.wait();
      setStatus(`Governor ${shortAddress(wallet)} removed.`);
    });
  };

  const handleUpdateMinStake = () => {
    void executeAction("update-min-stake", async () => {
      const provider = await withProvider();
      const amount = ethers.parseUnits((minStakeInput || "0").trim(), 6);
      const tx = await txSetMinJobStake(provider, amount);
      await tx.wait();
      setStatus("Minimum job stake updated.");
    });
  };

  const handleUpdatePlatformFee = () => {
    void executeAction("update-platform-fee", async () => {
      const feePercent = Number.parseFloat(platformFeeInput || "0");
      if (Number.isNaN(feePercent) || feePercent < 0 || feePercent > 20) {
        throw new Error("Platform fee must be between 0 and 20 percent.");
      }
      const provider = await withProvider();
      const tx = await txSetPlatformFeeBps(provider, Math.round(feePercent * 100));
      await tx.wait();
      setStatus("Platform fee updated.");
    });
  };

  const handleToggleRequireCredential = () => {
    if (!settings) return;
    void executeAction("toggle-require-credential", async () => {
      const provider = await withProvider();
      const tx = await txSetRequireCredentialToPost(provider, !settings.requireCredentialToPost);
      await tx.wait();
      setStatus("Posting requirement updated.");
    });
  };

  if (!account) {
    return <section className="archon-card p-6 text-sm text-[#9CA3AF]">Connect wallet to access admin controls.</section>;
  }

  if (loading && !ownerAddress) {
    return <section className="archon-card p-6 text-sm text-[#9CA3AF]">Loading admin controls...</section>;
  }

  if (!isOwner) {
    return (
      <section className="archon-card p-6">
        <h1 className="text-xl font-semibold text-[#EAEAF0]">Access restricted</h1>
        <p className="mt-2 text-sm text-rose-200">Only the SourceRegistry owner can access this page.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Admin Control Center</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Platform operations, moderation, source approvals, and settings.</p>
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
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Platform Overview Stats</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <p className="text-xs text-[#9CA3AF]">Total credentials minted</p>
            <p className="mt-1 font-semibold text-[#EAEAF0]">{totalCredentials}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <p className="text-xs text-[#9CA3AF]">Total tasks created</p>
            <p className="mt-1 font-semibold text-[#EAEAF0]">{totalTasksCreated}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <p className="text-xs text-[#9CA3AF]">Total USDC paid out</p>
            <p className="mt-1 font-semibold text-[#EAEAF0]">N/A</p>
            <p className="text-[11px] text-[#808894]">Track via RewardPaid events.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <p className="text-xs text-[#9CA3AF]">Total approved creators</p>
            <p className="mt-1 font-semibold text-[#EAEAF0]">{totalApprovedCreators}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2">
            <p className="text-xs text-[#9CA3AF]">Active community moderators</p>
            <p className="mt-1 font-semibold text-[#EAEAF0]">{activeModeratorCount}</p>
          </div>
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Pending Creator Applications</h2>
        {visibleCreatorApplications.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No pending creator applications.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleCreatorApplications.map((application) => {
              const metadata = parseProfileURI(application.profileURI);
              return (
                <article key={application.operator} className="rounded-xl border border-white/10 bg-[#111214] p-4">
                  <p className="text-sm font-semibold text-[#EAEAF0]">{shortAddress(application.operator)}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">Applied: {formatTimestamp(application.appliedAt)}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">Source: {application.sourceType}</p>
                  {metadata ? (
                    <pre className="mt-2 overflow-auto rounded-lg border border-white/10 bg-black/25 p-2 text-xs text-[#9CA3AF]">
                      {JSON.stringify(metadata, null, 2)}
                    </pre>
                  ) : (
                    <p className="mt-2 break-all text-xs text-[#9CA3AF]">{application.profileURI}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleApproveCreator(application.operator)}
                      disabled={busyKey === `approve-creator-${application.operator.toLowerCase()}`}
                      className="archon-button-primary px-3 py-2 text-xs"
                    >
                      Approve as Task Creator
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproveTaskPoster(application.operator)}
                      disabled={busyKey === `approve-poster-${application.operator.toLowerCase()}`}
                      className="archon-button-secondary px-3 py-2 text-xs"
                    >
                      Approve as Task Poster
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDismissedApplications((prev) => ({
                          ...prev,
                          [application.operator.toLowerCase()]: true
                        }))
                      }
                      className="archon-button-secondary px-3 py-2 text-xs"
                    >
                      Reject (off-chain)
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Approved Operators</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-2 text-sm font-medium text-[#EAEAF0]">Task creators</p>
            <div className="space-y-2">
              {taskCreators.length === 0 ? <p className="text-xs text-[#9CA3AF]">None approved</p> : null}
              {taskCreators.map((wallet) => (
                <div key={wallet} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111214] px-2 py-1.5 text-xs text-[#9CA3AF]">
                  <span>{shortAddress(wallet)}</span>
                  <button type="button" onClick={() => handleRevokeOperator("task", wallet)} className="archon-button-secondary px-2 py-1 text-[11px]">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#EAEAF0]">Agent task posters</p>
            <div className="space-y-2">
              {agentTaskPosters.length === 0 ? <p className="text-xs text-[#9CA3AF]">None approved</p> : null}
              {agentTaskPosters.map((wallet) => (
                <div key={wallet} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111214] px-2 py-1.5 text-xs text-[#9CA3AF]">
                  <span>{shortAddress(wallet)}</span>
                  <button type="button" onClick={() => handleRevokeOperator("agent_task", wallet)} className="archon-button-secondary px-2 py-1 text-[11px]">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#EAEAF0]">Community moderators</p>
            <div className="space-y-2">
              {communityOperators.length === 0 ? <p className="text-xs text-[#9CA3AF]">None approved</p> : null}
              {communityOperators.map((wallet) => (
                <div key={wallet} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111214] px-2 py-1.5 text-xs text-[#9CA3AF]">
                  <span>{shortAddress(wallet)}</span>
                  <button type="button" onClick={() => handleRevokeOperator("community", wallet)} className="archon-button-secondary px-2 py-1 text-[11px]">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Community Moderator Management</h2>
        <form onSubmit={handleRegisterModerator} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-[#9CA3AF]">
            Wallet address
            <input className="archon-input mt-1" value={moderatorWallet} onChange={(e) => setModeratorWallet(e.target.value)} placeholder="0x..." required />
          </label>
          <label className="text-sm text-[#9CA3AF]">
            Display name
            <input className="archon-input mt-1" value={moderatorName} onChange={(e) => setModeratorName(e.target.value)} placeholder="ARC Community Team" required />
          </label>
          <label className="text-sm text-[#9CA3AF]">
            Role
            <input className="archon-input mt-1" value={moderatorRole} onChange={(e) => setModeratorRole(e.target.value)} placeholder="Discord Moderator" required />
          </label>
          <label className="text-sm text-[#9CA3AF]">
            Profile link (optional)
            <input className="archon-input mt-1" value={moderatorProfileURI} onChange={(e) => setModeratorProfileURI(e.target.value)} placeholder="https://..." />
          </label>
          <button type="submit" disabled={busyKey === "register-moderator"} className="archon-button-primary px-3 py-2 text-sm md:col-span-2">
            {busyKey === "register-moderator" ? "Registering..." : "Register Moderator"}
          </button>
        </form>

        <div className="mt-5 space-y-2">
          {moderators.length === 0 ? <p className="text-sm text-[#9CA3AF]">No active moderators.</p> : null}
          {moderators.map((moderator) => (
            <div key={moderator.wallet} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#9CA3AF]">
              <div>
                <p className="font-medium text-[#EAEAF0]">{moderator.name || shortAddress(moderator.wallet)}</p>
                <p className="text-xs">{moderator.role || "Moderator"} | {shortAddress(moderator.wallet)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDeactivateModerator(moderator.wallet)}
                disabled={busyKey === `deactivate-moderator-${moderator.wallet.toLowerCase()}`}
                className="archon-button-secondary px-3 py-2 text-xs"
              >
                Deactivate
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Pending Community Applications</h2>
        {pendingCommunityApplications.length === 0 ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">No pending applications.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {pendingCommunityApplications.map((application) => (
              <article key={application.applicationId} className="rounded-xl border border-white/10 bg-[#111214] p-4 text-sm text-[#9CA3AF]">
                <p className="font-semibold text-[#EAEAF0]">Application #{application.applicationId}</p>
                <p className="mt-1 text-xs">Applicant: {shortAddress(application.applicant)}</p>
                <p className="mt-1 text-xs">Platform: {application.platform}</p>
                <p className="mt-1 text-xs">Submitted: {formatTimestamp(application.submittedAt)}</p>
                <p className="mt-2 whitespace-pre-wrap break-words">{application.activityDescription}</p>
                {application.evidenceLink ? (
                  <a href={application.evidenceLink} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-[#8FD9FF] underline underline-offset-4">
                    {application.evidenceLink}
                  </a>
                ) : null}

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-[#9CA3AF]">
                    Activity type
                    <select
                      className="archon-input mt-1"
                      value={communityTypeByApplication[application.applicationId] ?? 0}
                      onChange={(event) =>
                        setCommunityTypeByApplication((prev) => ({
                          ...prev,
                          [application.applicationId]: Number(event.target.value)
                        }))
                      }
                    >
                      {COMMUNITY_TYPES.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[#9CA3AF]">
                    Approval note
                    <input
                      className="archon-input mt-1"
                      value={communityApproveNoteByApplication[application.applicationId] ?? ""}
                      onChange={(event) =>
                        setCommunityApproveNoteByApplication((prev) => ({
                          ...prev,
                          [application.applicationId]: event.target.value
                        }))
                      }
                    />
                  </label>
                </div>

                <label className="mt-3 block text-xs text-[#9CA3AF]">
                  Rejection note (required for reject)
                  <textarea
                    className="archon-input mt-1 min-h-16"
                    value={communityRejectNoteByApplication[application.applicationId] ?? ""}
                    onChange={(event) =>
                      setCommunityRejectNoteByApplication((prev) => ({
                        ...prev,
                        [application.applicationId]: event.target.value
                      }))
                    }
                    placeholder="Provide clear rejection reason"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleApproveCommunityApplication(application.applicationId)}
                    disabled={busyKey === `approve-community-${application.applicationId}`}
                    className="archon-button-primary px-3 py-2 text-xs"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRejectCommunityApplication(application.applicationId)}
                    disabled={busyKey === `reject-community-${application.applicationId}`}
                    className="archon-button-secondary px-3 py-2 text-xs"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">DAO Governor Management</h2>
        <form onSubmit={handleAddGovernor} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-[#9CA3AF]">
            Governor contract address
            <input className="archon-input mt-1" value={governorAddressInput} onChange={(e) => setGovernorAddressInput(e.target.value)} placeholder="0x..." required />
          </label>
          <label className="text-sm text-[#9CA3AF]">
            DAO name
            <input className="archon-input mt-1" value={governorNameInput} onChange={(e) => setGovernorNameInput(e.target.value)} placeholder="ARC Governance" />
          </label>
          <button type="submit" disabled={busyKey === "add-governor"} className="archon-button-primary px-3 py-2 text-sm md:col-span-2">
            {busyKey === "add-governor" ? "Adding..." : "Add Governor"}
          </button>
        </form>

        <div className="mt-5 space-y-2">
          {governors.length === 0 ? <p className="text-sm text-[#9CA3AF]">No approved governors.</p> : null}
          {governors.map((governor) => (
            <div key={governor} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#9CA3AF]">
              <div>
                <p className="font-medium text-[#EAEAF0]">{governorNames[governor.toLowerCase()] || "Unnamed DAO"}</p>
                <p className="text-xs">{shortAddress(governor)}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveGovernor(governor)}
                disabled={busyKey === `remove-governor-${governor.toLowerCase()}`}
                className="archon-button-secondary px-3 py-2 text-xs"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="archon-card p-6">
        <h2 className="text-lg font-semibold text-[#EAEAF0]">Platform Settings</h2>
        {!settings ? (
          <p className="mt-3 text-sm text-[#9CA3AF]">Loading platform settings...</p>
        ) : (
          <div className="mt-4 space-y-4 text-sm text-[#9CA3AF]">
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
              <p>
                Minimum job stake: <span className="text-[#EAEAF0]">{formatUsdc(settings.minJobStake)} USDC</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="archon-input max-w-[180px]" type="number" min="0" step="0.000001" value={minStakeInput} onChange={(e) => setMinStakeInput(e.target.value)} />
                <button type="button" onClick={handleUpdateMinStake} disabled={busyKey === "update-min-stake"} className="archon-button-secondary px-3 py-2 text-xs">
                  Update
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
              <p>
                Platform fee: <span className="text-[#EAEAF0]">{(settings.platformFeeBps / 100).toFixed(2)}%</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="archon-input max-w-[180px]" type="number" min="0" max="20" step="0.01" value={platformFeeInput} onChange={(e) => setPlatformFeeInput(e.target.value)} />
                <button type="button" onClick={handleUpdatePlatformFee} disabled={busyKey === "update-platform-fee"} className="archon-button-secondary px-3 py-2 text-xs">
                  Update
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
              <p>
                Require credential to post: <span className="text-[#EAEAF0]">{settings.requireCredentialToPost ? "Enabled" : "Disabled"}</span>
              </p>
              <button type="button" onClick={handleToggleRequireCredential} disabled={busyKey === "toggle-require-credential"} className="archon-button-secondary mt-2 px-3 py-2 text-xs">
                Toggle
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
              Credential cooldown: <span className="text-[#EAEAF0]">{(settings.cooldownSeconds / 3600).toFixed(1)} hours</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
