"use client";

import { ethers } from "ethers";
import { useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  formatTimestamp,
  getJobReadContract,
  getJobWriteContract,
  parseSubmission,
  submissionStatusLabel,
  SubmissionRecord
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type EstimateState = "idle" | "loading" | "ready" | "error";

function submissionStatusClass(status: number) {
  if (status === 2) return "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (status === 3) return "border border-rose-400/30 bg-rose-500/10 text-rose-200";
  if (status === 1) return "border border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
  return "border border-white/10 bg-white/5 text-[#9CA3AF]";
}

export default function SubmitWorkPage() {
  const { account, browserProvider, connect } = useWallet();
  const [jobId, setJobId] = useState("");
  const [deliverableLink, setDeliverableLink] = useState("");
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [estimateState, setEstimateState] = useState<EstimateState>("idle");
  const [estimateMessage, setEstimateMessage] = useState("Enter a job ID and link to estimate gas.");
  const [estimatedUnits, setEstimatedUnits] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");

  const trimmedDeliverable = deliverableLink.trim();
  const parsedJobId = Number(jobId);
  const costSymbol = expectedChainId === 5042002 ? "USDC" : "ETH";

  const refreshSubmission = async () => {
    if (!account || !Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setSubmission(null);
      return;
    }

    try {
      const readContract = getJobReadContract();
      const raw = await readContract.getSubmission(parsedJobId, account);
      const parsed = parseSubmission(raw);
      if (!parsed.agent || parsed.agent === "0x0000000000000000000000000000000000000000") {
        setSubmission(null);
      } else {
        setSubmission(parsed);
      }
    } catch {
      setSubmission(null);
    }
  };

  useEffect(() => {
    void refreshSubmission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, parsedJobId]);

  useEffect(() => {
    let active = true;

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0 || !trimmedDeliverable) {
      setEstimateState("idle");
      setEstimateMessage("Enter a job ID and link to estimate gas.");
      setEstimatedUnits("");
      setEstimatedCost("");
      return () => {
        active = false;
      };
    }

    setEstimateState("loading");
    setEstimateMessage("Estimating...");

    const timer = setTimeout(() => {
      void (async () => {
        if (!browserProvider) {
          if (!active) return;
          setEstimateState("error");
          setEstimateMessage("Unable to estimate (wallet not connected).");
          return;
        }

        try {
          const jobContract = await getJobWriteContract(browserProvider);
          const gas = (await jobContract.submitDeliverable.estimateGas(parsedJobId, trimmedDeliverable)) as bigint;
          const feeData = await browserProvider.getFeeData();
          const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
          const totalCost = gasPrice ? ethers.formatEther(gas * gasPrice) : "";
          if (!active) return;
          setEstimateState("ready");
          setEstimatedUnits(gas.toString());
          setEstimatedCost(totalCost);
          setEstimateMessage("Estimate ready");
        } catch {
          if (!active) return;
          setEstimateState("error");
          setEstimateMessage("Unable to estimate");
          setEstimatedUnits("");
          setEstimatedCost("");
        }
      })();
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [browserProvider, parsedJobId, trimmedDeliverable]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");

    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setError("Enter a valid numeric job ID.");
      return;
    }
    if (!trimmedDeliverable) {
      setError("Deliverable link is required.");
      return;
    }

    setSubmitting(true);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();
      const jobContract = await getJobWriteContract(provider);

      const accepted = (await jobContract.isAccepted(parsedJobId, walletAddress)) as boolean;
      if (!accepted) {
        const acceptTx = await jobContract.acceptJob(parsedJobId);
        setStatus(`Accept transaction submitted: ${acceptTx.hash}`);
        await acceptTx.wait();
      }

      const submitTx = await jobContract.submitDeliverable(parsedJobId, trimmedDeliverable);
      setStatus(`Submit transaction submitted: ${submitTx.hash}`);
      await submitTx.wait();
      setStatus(`Deliverable submitted for job #${parsedJobId}.`);
      setDeliverableLink("");
      await refreshSubmission();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit deliverable.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaimCredential = async () => {
    setError("");
    setStatus("");
    if (!Number.isInteger(parsedJobId) || parsedJobId < 0) {
      setError("Enter a valid job ID to claim credential.");
      return;
    }

    setClaiming(true);
    try {
      const provider = browserProvider ?? (await connect());
      if (!provider) throw new Error("Wallet connection was not established.");

      const network = await provider.getNetwork();
      if (Number(network.chainId) !== expectedChainId) {
        throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
      }

      const jobContract = await getJobWriteContract(provider);
      const tx = await jobContract.claimCredential(parsedJobId);
      setStatus(`Claim transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Credential minted for job #${parsedJobId}.`);
      await refreshSubmission();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim credential.");
    } finally {
      setClaiming(false);
    }
  };

  const canClaim = useMemo(
    () => submission?.status === 2 && !submission.credentialClaimed,
    [submission]
  );

  return (
    <section className="mx-auto max-w-[560px]">
      <div className="archon-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Submit Work</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Multiple users can submit for a job before the creator deadline.</p>

        {status ? <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#EAEAF0]">Deliverable Link</span>
            <input
              aria-label="Deliverable link"
              className="archon-input"
              value={deliverableLink}
              onChange={(event) => setDeliverableLink(event.target.value)}
              placeholder="https://github.com/... or ipfs://..."
              required
            />
          </label>

          <div className="arc-glass arc-mono px-3 py-2 text-xs text-[#C9D0DB]">
            <div className="font-semibold text-[#EAEAF0]">Gas Estimate</div>
            {estimateState === "loading" ? (
              <div>Estimating...</div>
            ) : estimateState === "ready" ? (
              <div>
                {estimatedUnits} units{estimatedCost ? ` (~${estimatedCost} ${costSymbol})` : ""}
              </div>
            ) : (
              <div>{estimateMessage}</div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="archon-button-primary w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Accept & Submit Work"}
          </button>
        </form>

        {submission ? (
          <div className={`mt-5 rounded-xl px-4 py-3 text-sm ${submissionStatusClass(submission.status)}`}>
            <p>
              Current submission status: <strong>{submissionStatusLabel(submission.status)}</strong>
            </p>
            <p className="mt-1">Submitted at: {formatTimestamp(submission.submittedAt)}</p>
            {submission.reviewerNote ? <p className="mt-1">Reviewer note: {submission.reviewerNote}</p> : null}
            {submission.status === 2 ? (
              <p className="mt-1">Credential claimed: {submission.credentialClaimed ? "Yes" : "No"}</p>
            ) : null}
          </div>
        ) : null}

        {canClaim ? (
          <button
            type="button"
            onClick={() => void handleClaimCredential()}
            disabled={claiming}
            className="archon-button-secondary mt-4 w-full px-4 py-2.5 text-sm transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {claiming ? "Minting Credential..." : "Mint Credential For This Job"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
