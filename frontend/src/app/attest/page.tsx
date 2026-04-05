"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  expectedChainId,
  fetchCredentialsForAgent,
  fetchPeerAttestationsForRecipient,
  fetchPeerAttestationsGiven,
  getSourceReadContract,
  shortAddress,
  txPeerAttest
} from "@/lib/contracts";
import { calculateWeightedScore } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

type Tab = "give" | "received" | "given";

export default function AttestPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<Tab>("give");
  const [score, setScore] = useState(0);
  const [remainingGiven, setRemainingGiven] = useState(2);
  const [remainingReceived, setRemainingReceived] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [category, setCategory] = useState("Technical Work");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [received, setReceived] = useState<Array<{ id: number; from: string; category: string; note: string; issuedAt: number }>>([]);
  const [given, setGiven] = useState<Array<{ id: number; to: string; category: string; note: string; issuedAt: number }>>([]);

  const canAttest = score >= 300;
  const noteLength = note.trim().length;

  const load = useCallback(async () => {
    if (!account) {
      setScore(0);
      setReceived([]);
      setGiven([]);
      return;
    }
    try {
      const [credentials, receivedRows, givenRows] = await Promise.all([
        fetchCredentialsForAgent(account),
        fetchPeerAttestationsForRecipient(account),
        fetchPeerAttestationsGiven(account)
      ]);
      setScore(calculateWeightedScore(credentials));
      setReceived(
        receivedRows.map((item) => ({
          id: item.attestationId,
          from: item.attester,
          category: item.category,
          note: item.note,
          issuedAt: item.issuedAt
        }))
      );
      setGiven(
        givenRows.map((item) => ({
          id: item.attestationId,
          to: item.recipient,
          category: item.category,
          note: item.note,
          issuedAt: item.issuedAt
        }))
      );

      const peer = getSourceReadContract("peer_attestation");
      const [givenCount, receivedCount] = (await Promise.all([
        peer.attestationsGivenThisWeek(account),
        peer.attestationsReceivedThisWeek(account)
      ])) as [bigint, bigint];

      setRemainingGiven(Math.max(0, 2 - Number(givenCount)));
      setRemainingReceived(Math.max(0, 1 - Number(receivedCount)));
    } catch {
      setRemainingGiven(0);
      setRemainingReceived(0);
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

  const handleAttest = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setError("");
    setSubmitting(true);

    try {
      const provider = await withProvider();
      if (!canAttest) {
        throw new Error("Reach Architect tier (300 pts) to give attestations.");
      }
      if (noteLength < 50) {
        throw new Error("Note must be at least 50 characters.");
      }
      if (noteLength > 200) {
        throw new Error("Note must be 200 characters or fewer.");
      }
      const tx = await txPeerAttest(provider, recipient.trim(), category, note.trim());
      setStatus(`Attestation transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Attestation recorded and credential minted to recipient.");
      setRecipient("");
      setNote("");
      await load();
    } catch (attestError) {
      setError(attestError instanceof Error ? attestError.message : "Failed to attest.");
    } finally {
      setSubmitting(false);
    }
  };

  const eligibilityText = useMemo(() => {
    if (canAttest) {
      return `Your current score: ${score} pts. You can give attestations.`;
    }
    return `Your current score: ${score} pts. You need 300 pts (Architect tier) to give attestations. Earn more credentials to unlock this.`;
  }, [canAttest, score]);

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Peer Attestations</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Vouch for real contributions from people you have worked with. Attestations are weighted and rare.
        </p>

        <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          To give attestations, you must reach Architect tier (300 reputation points). This prevents newly created
          accounts from gaming the attestation system.
        </div>
        <div className="mt-2 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          {eligibilityText}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("give")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "give" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Give Attestation
          </button>
          <button
            type="button"
            onClick={() => setTab("received")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "received" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Received
          </button>
          <button
            type="button"
            onClick={() => setTab("given")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "given" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Given
          </button>
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

      {tab === "give" ? (
        <div className="archon-card p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Weekly remaining (give): <span className="text-[#EAEAF0]">{remainingGiven}</span> of 2
            </div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
              Weekly received room: <span className="text-[#EAEAF0]">{remainingReceived}</span> of 1
            </div>
          </div>

          {!canAttest ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">
              You cannot give attestations yet. Reach Architect tier first.
            </p>
          ) : (
            <form onSubmit={handleAttest} className="mt-4 space-y-3">
              <label className="block text-sm text-[#9CA3AF]">
                Recipient wallet address
                <input
                  className="archon-input mt-1"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Category
                <select className="archon-input mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="Technical Work">Technical Work</option>
                  <option value="Community Help">Community Help</option>
                  <option value="Reliability">Reliability</option>
                  <option value="Creative Work">Creative Work</option>
                  <option value="Leadership">Leadership</option>
                </select>
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Note (minimum 50 characters)
                <textarea
                  className="archon-input mt-1 min-h-24"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={200}
                  placeholder="Describe specifically what this person did, why it was valuable, and how you interacted with them."
                  required
                />
                <p className="mt-1 text-xs text-[#9CA3AF]">{noteLength}/200 characters</p>
              </label>
              <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Attestations are permanent and public. Your wallet address will be linked to this attestation forever.
              </div>
              <button
                type="submit"
                disabled={submitting || remainingGiven <= 0}
                className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Send Attestation"}
              </button>
            </form>
          )}
        </div>
      ) : null}

      {tab === "received" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Received Attestations</h2>
          {received.length === 0 ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">No attestations received yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {received.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      #{item.id} | {item.category} | from {shortAddress(item.from)}
                    </span>
                    <span className="rounded-full bg-[#EC4899]/20 px-2 py-0.5 text-[11px] text-[#F9A8D4]">+60 pts</span>
                  </div>
                  <p className="mt-1">{item.note}</p>
                  <p className="mt-1 text-[11px] text-[#808894]">{new Date(item.issuedAt * 1000).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "given" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Given Attestations</h2>
          {given.length === 0 ? (
            <p className="mt-3 text-sm text-[#9CA3AF]">No attestations given yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {given.map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                  <p>
                    #{item.id} | {item.category} | to {shortAddress(item.to)}
                  </p>
                  <p className="mt-1">{item.note}</p>
                  <p className="mt-1 text-[11px] text-[#808894]">{new Date(item.issuedAt * 1000).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

