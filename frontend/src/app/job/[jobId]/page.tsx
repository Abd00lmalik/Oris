
"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import SubmissionGraph from "@/components/submission-graph";
import type { GraphEdge, GraphNode } from "@/lib/graph";
import {
  expectedChainId,
  fetchApprovedAgentCount,
  fetchJob,
  fetchJobCredentialCooldownSeconds,
  fetchJobEscrow,
  fetchJobsCreatedCount,
  fetchLastJobCredentialClaim,
  fetchMaxApprovalsForJob,
  fetchSubmissionForAgent,
  fetchSubmissionGraph,
  fetchSubmissions,
  formatTimestamp,
  formatUsdc,
  getDeploymentConfig,
  getJobReadContract,
  getJobSignalsReadContract,
  getReadProvider,
  JobRecord,
  RESPONSE_TYPE,
  SubmissionRecord,
  txAcceptJob,
  txApproveSubmission,
  txClaimJobCredential,
  txRejectSubmission,
  txRespondToSubmission,
  txSubmitDeliverable
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type ViewMode = "graph" | "list" | "timeline";

function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseUsdcInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const safeWhole = whole === "" ? "0" : whole;
  const safeFrac = frac.slice(0, 6).padEnd(6, "0");
  if (!/^\d+$/.test(safeWhole) || !/^\d+$/.test(safeFrac)) return null;
  return BigInt(safeWhole) * 1_000_000n + BigInt(safeFrac);
}

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("ipfs://") || value.startsWith("data:");
}

function mapToGateway(uri: string) {
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`;
  return uri;
}

function responseTypeLabel(value: number) {
  if (value === RESPONSE_TYPE.BuildsOn) return "builds_on";
  if (value === RESPONSE_TYPE.Critiques) return "critiques";
  return "alternative";
}

function makeResponseDataUri(content: string, responseType: number, address: string) {
  const payload = {
    responseType: responseTypeLabel(responseType),
    summary: content.slice(0, 120),
    content,
    referencedElements: [],
    agentId: address
  };
  const serialized = JSON.stringify(payload);
  if (typeof window === "undefined") return `data:application/json,${encodeURIComponent(serialized)}`;
  const encoded = window.btoa(unescape(encodeURIComponent(serialized)));
  return `data:application/json;base64,${encoded}`;
}

function formatRemainingDuration(seconds: number) {
  if (seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function DeadlineCountdown({ deadline }: { deadline: number }) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now() / 1000;
      const diff = deadline - now;
      if (diff <= 0) {
        setRemaining("EXPIRED");
        setUrgent(false);
        return;
      }
      const days = Math.floor(diff / 86400);
      const hours = Math.floor((diff % 86400) / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = Math.floor(diff % 60);
      setUrgent(diff < 3600);
      if (days > 0) setRemaining(`${days}d ${hours}h ${minutes}m`);
      else if (hours > 0) setRemaining(`${hours}h ${minutes}m ${seconds}s`);
      else setRemaining(`${minutes}m ${seconds}s`);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return <span className="text-data font-semibold" style={{ color: urgent ? "var(--danger)" : "var(--text-primary)" }}>{remaining}</span>;
}

export default function JobDetailsPage() {
  const params = useParams<{ jobId: string }>();
  const router = useRouter();
  const { account, browserProvider, connect } = useWallet();

  const [job, setJob] = useState<JobRecord | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [mySubmission, setMySubmission] = useState<SubmissionRecord | null>(null);
  const [isAccepted, setIsAccepted] = useState(false);
  const [escrowLocked, setEscrowLocked] = useState(0n);
  const [maxApprovals, setMaxApprovals] = useState(3);
  const [approvalsUsed, setApprovalsUsed] = useState(0);
  const [creatorPostedCount, setCreatorPostedCount] = useState(0);
  const [platformFeeBps, setPlatformFeeBps] = useState(
    getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000
  );
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const [deliverableLink, setDeliverableLink] = useState("");
  const [rewardInputs, setRewardInputs] = useState<Record<string, string>>({});
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const [showResponsePanel, setShowResponsePanel] = useState(false);
  const [responseType, setResponseType] = useState<number>(RESPONSE_TYPE.BuildsOn);
  const [responseContent, setResponseContent] = useState("");

  const [claimReadyAt, setClaimReadyAt] = useState<number | null>(null);
  const [claimCountdown, setClaimCountdown] = useState(0);

  const jobId = useMemo(() => Number(params.jobId), [params.jobId]);
  const isConnected = Boolean(account);
  const isCreator = Boolean(account && job && account.toLowerCase() === job.client.toLowerCase());
  const isTaskOpen = Boolean(job && Date.now() / 1000 < job.deadline);

  const allocatedReserved = useMemo(
    () =>
      submissions.reduce((sum, submission) => {
        if (submission.status === 2 || submission.credentialClaimed) return sum + BigInt(submission.allocatedReward || "0");
        return sum;
      }, 0n),
    [submissions]
  );

  const remainingPool = useMemo(() => {
    if (!job) return 0n;
    const pool = BigInt(job.rewardUSDC);
    return pool > allocatedReserved ? pool - allocatedReserved : 0n;
  }, [allocatedReserved, job]);

  const claimableNet = useMemo(() => {
    if (!mySubmission?.allocatedReward) return 0n;
    const gross = BigInt(mySubmission.allocatedReward);
    const fee = (gross * BigInt(platformFeeBps)) / 10_000n;
    return gross - fee;
  }, [mySubmission?.allocatedReward, platformFeeBps]);

  const pendingSubmissions = useMemo(() => submissions.filter((item) => item.status === 1), [submissions]);

  const timelineItems = useMemo(() => {
    const base = submissions.map((submission) => ({
      id: `submission-${submission.submissionId}`,
      at: submission.submittedAt,
      label: `${shortAddress(submission.agent)} submitted work`
    }));
    const responses = graphData.nodes
      .filter((node) => node.type === "response")
      .map((node) => ({
        id: node.id,
        at: node.createdAt,
        label: `${shortAddress(node.submitterAddress)} posted ${node.responseType ?? "response"}`
      }));
    return [...base, ...responses].sort((a, b) => b.at - a.at);
  }, [graphData.nodes, submissions]);

  const loadTask = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) {
      setErrorMessage("Invalid task id.");
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const [jobData, submissionRows, escrow, approvedCount, maxAllowed] = await Promise.all([
        fetchJob(jobId),
        fetchSubmissions(jobId),
        fetchJobEscrow(jobId),
        fetchApprovedAgentCount(jobId),
        fetchMaxApprovalsForJob(jobId)
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
      setMaxApprovals(Math.max(1, maxAllowed || 3));
      setCreatorPostedCount(await fetchJobsCreatedCount(jobData.client));

      try {
        const contract = getJobReadContract();
        setPlatformFeeBps(Number(await contract.platformFeeBps()));
      } catch {
        setPlatformFeeBps(getDeploymentConfig().platformFeeBps ?? getDeploymentConfig().platform?.feeBps ?? 1000);
      }

      if (account) {
        const [accepted, mine, lastClaim, cooldownSeconds] = await Promise.all([
          (async () => {
            try {
              const contract = getJobReadContract();
              return (await contract.isAccepted(jobId, account)) as boolean;
            } catch {
              return false;
            }
          })(),
          fetchSubmissionForAgent(jobId, account),
          fetchLastJobCredentialClaim(account),
          fetchJobCredentialCooldownSeconds()
        ]);
        setIsAccepted(accepted);
        setMySubmission(mine);
        const ready = Number(lastClaim) + cooldownSeconds;
        setClaimReadyAt(ready > 0 ? ready : null);
      } else {
        setIsAccepted(false);
        setMySubmission(null);
        setClaimReadyAt(null);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load task.");
    } finally {
      setLoading(false);
    }
  }, [account, jobId]);

  const loadGraph = useCallback(async () => {
    if (!Number.isInteger(jobId) || jobId < 0) return;
    setGraphLoading(true);
    try {
      const provider = browserProvider ?? getReadProvider();
      console.log("[graph] Loading for task:", jobId);
      const data = await fetchSubmissionGraph(provider, jobId);
      console.log("[graph] Result:", data.nodes.length, "nodes");
      setGraphData({ nodes: data.nodes as unknown as GraphNode[], edges: data.edges as unknown as GraphEdge[] });
      if (!selectedNodeId && data.nodes.length > 0) {
        setSelectedNodeId((data.nodes[0] as unknown as GraphNode).id);
      }
    } catch {
      setGraphData({ nodes: [], edges: [] });
    } finally {
      setGraphLoading(false);
    }
  }, [browserProvider, jobId, selectedNodeId]);
  useEffect(() => {
    void loadTask();
    void loadGraph();
  }, [loadTask, loadGraph]);

  useEffect(() => {
    setSelectedNode(graphData.nodes.find((node) => node.id === selectedNodeId) ?? null);
  }, [graphData.nodes, selectedNodeId]);

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

  useEffect(() => {
    if (!Number.isInteger(jobId) || jobId < 0) return () => undefined;
    const contract = getJobSignalsReadContract();

    const onNewSubmission = async (taskId: bigint) => {
      if (Number(taskId) !== jobId) return;
      console.log("[graph] New submission, refreshing graph");
      await loadGraph();
      await loadTask();
    };

    const onNewResponse = async (taskId: bigint) => {
      if (Number(taskId) !== jobId) return;
      console.log("[graph] New response, refreshing graph");
      await loadGraph();
      await loadTask();
    };

    contract.on("DeliverableSubmitted", onNewSubmission);
    contract.on("SubmissionResponseAdded", onNewResponse);
    return () => {
      contract.off("DeliverableSubmitted", onNewSubmission);
      contract.off("SubmissionResponseAdded", onNewResponse);
    };
  }, [jobId, loadGraph, loadTask]);

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
    setBusyAction("accept");
    setErrorMessage("");
    setStatusMessage("");
    try {
      const provider = await withProvider();
      const tx = await txAcceptJob(provider, jobId);
      setStatusMessage(`Accept transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatusMessage("Task accepted. You can now submit your work.");
      await loadTask();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to accept task.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("submit");
    setErrorMessage("");
    setStatusMessage("");
    try {
      const trimmed = deliverableLink.trim();
      if (!trimmed || !isHttpUrl(trimmed)) throw new Error("Deliverable link must start with http://, https://, ipfs://, or data:");
      const provider = await withProvider();
      const tx = await txSubmitDeliverable(provider, jobId, trimmed);
      setStatusMessage(`Submission transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatusMessage("Work submitted. Awaiting review.");
      setDeliverableLink("");
      await loadTask();
      await loadGraph();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit work.");
    } finally {
      setBusyAction("");
    }
  };

  const handleApprove = async (agent: string) => {
    setErrorMessage("");
    setStatusMessage("");
    const key = agent.toLowerCase();
    const amount = parseUsdcInput(rewardInputs[key] ?? "");
    if (!amount || amount <= 0n) {
      setErrorMessage("Enter a valid reward amount before approving.");
      return;
    }

    const otherDraftTotal = Object.entries(rewardInputs).reduce((sum, [address, value]) => {
      if (address === key) return sum;
      const parsed = parseUsdcInput(value);
      return parsed ? sum + parsed : sum;
    }, 0n);

    const availableForThis = remainingPool > otherDraftTotal ? remainingPool - otherDraftTotal : 0n;
    if (amount > availableForThis) {
      setErrorMessage(`Reward exceeds remaining pool. Available: ${formatUsdc(availableForThis)} USDC`);
      return;
    }

    setBusyAction(`approve-${key}`);
    try {
      const provider = await withProvider();
      const tx = await txApproveSubmission(provider, jobId, agent, amount);
      setStatusMessage(`Approve transaction submitted: ${tx.hash}`);
      await tx.wait();
      setRewardInputs((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await loadTask();
      await loadGraph();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to approve submission.");
    } finally {
      setBusyAction("");
    }
  };
  const handleReject = async (agent: string) => {
    const key = agent.toLowerCase();
    const note = (rejectNotes[key] ?? "").trim();
    if (!note) {
      setErrorMessage("Rejection note is required.");
      return;
    }

    setBusyAction(`reject-${key}`);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const provider = await withProvider();
      const tx = await txRejectSubmission(provider, jobId, agent, note);
      setStatusMessage(`Reject transaction submitted: ${tx.hash}`);
      await tx.wait();
      await loadTask();
      await loadGraph();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to reject submission.");
    } finally {
      setBusyAction("");
    }
  };

  const handleClaim = async () => {
    setBusyAction("claim");
    setErrorMessage("");
    setStatusMessage("");
    try {
      const provider = await withProvider();
      const tx = await txClaimJobCredential(provider, jobId);
      setStatusMessage(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatusMessage("Reward and credential claimed successfully.");
      await loadTask();
      await loadGraph();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to claim reward.");
    } finally {
      setBusyAction("");
    }
  };

  const handleSubmitResponse = async () => {
    if (!selectedNode || selectedNode.type !== "submission") {
      setErrorMessage("Select a submission node before responding.");
      return;
    }
    if (!account) {
      setErrorMessage("Connect wallet to respond.");
      return;
    }
    if (responseContent.trim().length < 20) {
      setErrorMessage("Response must be at least 20 characters.");
      return;
    }

    setBusyAction("respond");
    setErrorMessage("");
    setStatusMessage("");
    try {
      const provider = await withProvider();
      const signer = await provider.getSigner();
      const contentURI = makeResponseDataUri(responseContent.trim(), responseType, account);
      const txHash = await txRespondToSubmission(
        signer,
        BigInt(selectedNode.submissionId ?? 0),
        responseType,
        contentURI
      );
      setStatusMessage(`Response submitted. Tx: ${txHash}`);
      setResponseContent("");
      setResponseType(RESPONSE_TYPE.BuildsOn);
      setShowResponsePanel(false);
      await loadTask();
      await loadGraph();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to submit response.");
    } finally {
      setBusyAction("");
    }
  };

  const hasSubmitted = Boolean(mySubmission && mySubmission.status !== 0);
  const isApproved = mySubmission?.status === 2;
  const isClaimed = Boolean(mySubmission?.credentialClaimed);
  const canClaim = Boolean(isConnected && !isCreator && isApproved && !isClaimed);
  const claimBlockedByCooldown = canClaim && claimCountdown > 0;
  return (
    <section className="page-container space-y-6">
      {statusMessage ? <div className="panel border-[var(--pulse)] py-3 text-sm text-[var(--pulse)]">{statusMessage}</div> : null}
      {errorMessage ? <div className="panel border-[var(--danger)] py-3 text-sm text-[var(--danger)]">{errorMessage}</div> : null}
      {loading ? <div className="panel text-sm text-[var(--text-secondary)]">Loading task details...</div> : null}
      {!loading && !job ? <div className="panel text-sm text-[var(--text-secondary)]">Task not found.</div> : null}

      {job ? (
        <>
          <div className="mb-0 border-b border-[var(--border)] pb-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => router.back()} className="text-sm font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  ? TASKS
                </button>
                <span className="text-sm font-mono text-[var(--border-bright)]">/</span>
                <span className="text-xs font-mono text-[var(--text-muted)]">#{job.jobId}</span>
              </div>
              <span className="text-xs font-mono tracking-wider" style={{ color: isTaskOpen ? "var(--pulse)" : "var(--danger)" }}>
                {isTaskOpen ? "OPEN" : "DEADLINE REACHED"}
              </span>
            </div>

            <div className="flex items-start justify-between gap-6">
              <h1 className="text-heading-1 flex-1">{job.title}</h1>
              <div className="shrink-0 text-right">
                <div className="font-heading text-[var(--gold)]" style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700 }}>
                  {formatUsdc(job.rewardUSDC)} USDC
                </div>
                <div className="text-label mt-1 text-[var(--text-muted)]">Reward Pool</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-[var(--border)] pt-4">
              <div className="flex items-center gap-2"><span className="text-label">BY</span><span className="text-data text-[var(--arc)]">{shortAddress(job.client)}</span></div>
              <div className="flex items-center gap-2"><span className="text-label">DEADLINE</span><DeadlineCountdown deadline={job.deadline} /></div>
              <div className="flex items-center gap-2"><span className="text-label">SUBMISSIONS</span><span className="text-data">{job.submissionCount}</span></div>
              <div className="flex items-center gap-2"><span className="text-label">MAX WINNERS</span><span className="text-data">{maxApprovals}</span></div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
            <aside className="panel h-fit space-y-6">
              <div><div className="section-header">Description</div><p className="text-sm leading-relaxed text-[var(--text-secondary)]">{job.description}</p></div>
              <div>
                <div className="section-header">Metadata</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Creator</span><span className="text-data">{shortAddress(job.client)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Tasks posted</span><span className="font-mono text-[var(--text-primary)]">{creatorPostedCount}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Created</span><span className="font-mono text-[var(--text-primary)]">{formatTimestamp(job.createdAt)}</span></div>
                </div>
              </div>
              <div>
                <div className="section-header">Reward Breakdown</div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Total pool</span><span className="font-mono text-[var(--gold)]">{formatUsdc(job.rewardUSDC)} USDC</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Escrow locked</span><span className="font-mono text-[var(--text-primary)]">{formatUsdc(escrowLocked)} USDC</span></div>
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Platform fee</span><span className="font-mono text-[var(--text-muted)]">10%</span></div>
                </div>
              </div>
              <div>
                <div className="section-header">Approval Slots</div>
                <div className="flex items-center gap-2">
                  {Array.from({ length: maxApprovals }, (_, idx) => {
                    const used = idx < approvalsUsed;
                    return (
                      <div key={`slot-${idx}`} className="flex h-6 w-6 items-center justify-center border text-xs" style={{ borderColor: used ? "var(--pulse)" : "var(--border-bright)", background: used ? "rgba(0,255,163,0.1)" : "transparent", color: used ? "var(--pulse)" : "var(--text-muted)" }}>{used ? "?" : "·"}</div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">{approvalsUsed}/{maxApprovals} used</p>
              </div>
            </aside>

            <div className="space-y-4">
              <div className="panel-elevated flex flex-wrap gap-2">
                <button type="button" className={viewMode === "graph" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("graph")}>Graph</button>
                <button type="button" className={viewMode === "list" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("list")}>List</button>
                <button type="button" className={viewMode === "timeline" ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"} onClick={() => setViewMode("timeline")}>Timeline</button>
              </div>

              {viewMode === "graph" ? (
                <div className="panel space-y-3">
                  {isTaskOpen ? <div className="mb-3 flex items-center gap-2"><span className="live-dot" /><span className="text-xs font-mono tracking-wider text-[var(--pulse)]">LIVE — updates as submissions arrive</span></div> : null}
                  {graphLoading ? <p className="text-sm text-[var(--text-secondary)]">Rendering graph...</p> : <SubmissionGraph graph={graphData} onNodeClick={(node) => setSelectedNodeId(node.id)} selectedNodeId={selectedNodeId} />}
                  {selectedNode ? (
                    <div className="card-sharp space-y-2 p-4 text-sm">
                      <div className="flex items-center justify-between"><p className="font-heading text-base">Selected {selectedNode.type}</p><span className="badge badge-agent">{selectedNode.isAgent ? "Agent" : "Human"}</span></div>
                      <p className="text-xs text-[var(--text-secondary)]">From <span className="text-data">{shortAddress(selectedNode.submitterAddress)}</span></p>
                      <a href={mapToGateway(selectedNode.contentURI)} target="_blank" rel="noreferrer" className="text-xs font-mono text-[var(--arc)] underline">Open content ?</a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {viewMode === "list" ? (
                <div className="space-y-3">
                  {submissions.length === 0 ? <div className="panel text-sm text-[var(--text-secondary)]">No submissions yet.</div> : submissions.map((submission) => (
                    <article key={`${submission.agent}-${submission.submittedAt}`} className="card-sharp space-y-2 p-4">
                      <div className="flex items-center justify-between"><span className="text-data text-xs">{shortAddress(submission.agent)}</span><span className="badge badge-arc">{submission.status === 2 ? "APPROVED" : submission.status === 1 ? "SUBMITTED" : submission.status === 3 ? "REJECTED" : "PENDING"}</span></div>
                      <a href={submission.deliverableLink} target="_blank" rel="noreferrer" className="break-all text-xs font-mono text-[var(--arc)] underline">{submission.deliverableLink}</a>
                      <p className="text-xs text-[var(--text-muted)]">Submitted: {formatTimestamp(submission.submittedAt)}</p>
                    </article>
                  ))}
                </div>
              ) : null}

              {viewMode === "timeline" ? (
                <div className="panel space-y-2">
                  {timelineItems.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No timeline events yet.</p> : timelineItems.map((item) => (
                    <div key={item.id} className="card-sharp flex items-center justify-between px-3 py-2 text-xs">
                      <span className="text-[var(--text-primary)]">{item.label}</span>
                      <span className="font-mono text-[var(--text-muted)]">{formatTimestamp(item.at)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <aside className="panel h-fit space-y-4">
              {!isConnected ? (
                <>
                  <div className="section-header">Connect Wallet</div>
                  <p className="text-sm text-[var(--text-secondary)]">Connect your wallet to accept tasks, submit work, and claim rewards.</p>
                  <button type="button" className="btn-primary w-full" onClick={() => void connect()}>Connect Wallet</button>
                </>
              ) : null}

              {isConnected && !isCreator ? (
                <>
                  <div className="section-header">Your Actions</div>
                  {[{ step: 1, label: "Accept task", done: isAccepted, active: !isAccepted }, { step: 2, label: "Submit your work", done: hasSubmitted, active: isAccepted && !hasSubmitted }, { step: 3, label: "Await approval", done: isApproved, active: hasSubmitted && !isApproved }, { step: 4, label: "Claim reward", done: isClaimed, active: isApproved && !isClaimed }].map((item) => (
                    <div key={item.step} className="flex items-center gap-3 border p-3" style={{ borderColor: item.active ? "var(--arc)" : item.done ? "var(--pulse)" : "var(--border)", background: item.active ? "rgba(0,229,255,0.04)" : "transparent" }}>
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border text-xs font-mono" style={{ borderColor: item.done ? "var(--pulse)" : item.active ? "var(--arc)" : "var(--border-bright)", color: item.done ? "var(--pulse)" : item.active ? "var(--arc)" : "var(--text-muted)" }}>{item.done ? "?" : item.step}</div>
                      <span className="text-sm" style={{ color: item.active ? "var(--text-primary)" : item.done ? "var(--pulse)" : "var(--text-muted)" }}>{item.label}</span>
                    </div>
                  ))}

                  {!isAccepted ? <button type="button" className="btn-primary w-full" onClick={() => void handleAccept()} disabled={busyAction === "accept" || !isTaskOpen}>{busyAction === "accept" ? "Accepting..." : "Accept Task"}</button> : null}

                  {isAccepted && !hasSubmitted ? (
                    <form className="space-y-3" onSubmit={handleSubmitWork}>
                      <div>
                        <label className="label">Deliverable Link</label>
                        <input type="url" className="input-field" placeholder="https://github.com/... or ipfs://..." value={deliverableLink} onChange={(event) => setDeliverableLink(event.target.value)} />
                        <p className="mt-1 text-xs text-[var(--text-muted)]">GitHub PR, IPFS link, deployed URL, or any public deliverable.</p>
                      </div>
                      <button type="submit" className="btn-primary w-full" disabled={busyAction === "submit" || !deliverableLink.trim()}>{busyAction === "submit" ? "Submitting..." : "Submit Work"}</button>
                    </form>
                  ) : null}

                  {canClaim ? (
                    <div className="space-y-3">
                      <div className="panel border-[var(--pulse)]" style={{ padding: "16px" }}>
                        <div className="text-label mb-2">Your Reward</div>
                        <div className="font-heading text-2xl text-[var(--pulse)]">{formatUsdc(claimableNet)} USDC</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">After 10% platform fee</div>
                        <div className="mt-1 text-xs text-[var(--arc)]">+100 reputation pts</div>
                      </div>
                      {claimBlockedByCooldown ? <p className="text-xs text-[var(--warn)]">Claim available in: {formatRemainingDuration(claimCountdown)}</p> : null}
                      <button type="button" className="btn-primary w-full" onClick={() => void handleClaim()} disabled={busyAction === "claim" || claimBlockedByCooldown}>{busyAction === "claim" ? "Claiming..." : "Claim USDC + Credential"}</button>
                    </div>
                  ) : null}
                  {selectedNode?.type === "submission" ? (
                    <>
                      <button type="button" className="btn-ghost w-full" onClick={() => setShowResponsePanel((prev) => !prev)}>{showResponsePanel ? "Close Response Panel" : "Respond to Selected Submission"}</button>
                      {showResponsePanel ? (
                        <div className="card-sharp space-y-4 p-5">
                          <div className="flex items-center justify-between"><div className="section-header mb-0">Add Response</div><button type="button" onClick={() => setShowResponsePanel(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">?</button></div>
                          <div>
                            <div className="label mb-2">Response Type</div>
                            <div className="grid grid-cols-3 gap-1">
                              {[{ type: RESPONSE_TYPE.BuildsOn, label: "BUILDS ON", color: "var(--arc)", desc: "Extend this idea" }, { type: RESPONSE_TYPE.Critiques, label: "CRITIQUES", color: "var(--warn)", desc: "Identify a flaw" }, { type: RESPONSE_TYPE.Alternative, label: "ALTERNATIVE", color: "var(--agent)", desc: "Different approach" }].map((item) => (
                                <button key={item.type} type="button" onClick={() => setResponseType(item.type)} className="border p-3 text-center" style={{ borderColor: responseType === item.type ? item.color : "var(--border)", background: responseType === item.type ? `${item.color}10` : "transparent" }}>
                                  <div className="mb-1 text-[10px] font-mono font-bold tracking-wider" style={{ color: responseType === item.type ? item.color : "var(--text-muted)" }}>{item.label}</div>
                                  <div className="text-[10px] text-[var(--text-muted)]">{item.desc}</div>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div><div className="label">Your Response</div><textarea className="input-field resize-none" rows={4} placeholder="Describe your response..." value={responseContent} onChange={(event) => setResponseContent(event.target.value)} /></div>
                          <div className="flex items-center justify-between text-xs"><span className="text-[var(--text-muted)]">Stake required: <strong className="text-[var(--gold)]">2 USDC</strong></span><span className="text-[var(--text-muted)]">Returned after 7 days unless flagged</span></div>
                          <button type="button" className="btn-primary w-full" onClick={() => void handleSubmitResponse()} disabled={busyAction === "respond" || responseContent.trim().length < 20}>{busyAction === "respond" ? "Submitting..." : "Submit Response — Stake 2 USDC"}</button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}

              {isConnected && isCreator ? (
                <>
                  <div className="section-header">Review Submissions</div>
                  {pendingSubmissions.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No submissions awaiting review.</p> : pendingSubmissions.map((submission) => {
                    const key = submission.agent.toLowerCase();
                    return (
                      <div key={`${submission.agent}-${submission.submittedAt}`} className="card-sharp space-y-3 p-4">
                        <div className="flex items-center justify-between"><span className="text-data text-xs">{shortAddress(submission.agent)}</span><span className="badge badge-warn">PENDING</span></div>
                        <div><div className="label">Deliverable</div><a href={submission.deliverableLink} target="_blank" rel="noreferrer" className="break-all text-xs font-mono text-[var(--arc)] hover:underline">{submission.deliverableLink.slice(0, 50)}... ?</a></div>
                        <div>
                          <div className="label">Allocate reward (USDC)</div>
                          <input type="number" min={0} step="0.000001" className="input-field text-sm" placeholder={`Max: ${formatUsdc(remainingPool)} USDC`} value={rewardInputs[key] ?? ""} onChange={(event) => setRewardInputs((prev) => ({ ...prev, [key]: event.target.value }))} />
                          {rewardInputs[key] ? <p className="mt-1 text-xs text-[var(--text-muted)]">Agent receives: {(Number(rewardInputs[key]) * 0.9).toFixed(2)} USDC</p> : null}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className="btn-primary flex-1 px-2 py-2 text-xs" onClick={() => void handleApprove(submission.agent)} disabled={busyAction === `approve-${key}`}>{busyAction === `approve-${key}` ? "Approving..." : "? Approve"}</button>
                          <button type="button" className="btn-danger flex-1 px-2 py-2 text-xs" onClick={() => void handleReject(submission.agent)} disabled={busyAction === `reject-${key}`}>{busyAction === `reject-${key}` ? "Rejecting..." : "? Reject"}</button>
                        </div>
                        <textarea className="input-field min-h-20 resize-none text-xs" placeholder="Rejection note (required to reject)" value={rejectNotes[key] ?? ""} onChange={(event) => setRejectNotes((prev) => ({ ...prev, [key]: event.target.value }))} />
                      </div>
                    );
                  })}
                </>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}

      <div className="pt-2"><Link href="/" className="btn-ghost inline-flex">Back to task feed</Link></div>
    </section>
  );
}

