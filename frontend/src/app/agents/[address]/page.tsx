"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  fetchArcIdentityForWallet,
  fetchCredentialsForAgent,
  fetchJobsByAgent,
  fetchJobsCreatedCount,
  formatTimestamp,
  shortAddress
} from "@/lib/contracts";
import { getReputationTier } from "@/lib/reputation";

type AgentMetadata = {
  name?: string;
  type?: string;
  specialization?: string;
  version?: string;
};

function mapUri(uri: string) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`;
  return uri;
}

export default function AgentProfilePage() {
  const params = useParams<{ address: string }>();
  const address = useMemo(() => params.address ?? "", [params.address]);

  const [loading, setLoading] = useState(true);
  const [isAgent, setIsAgent] = useState(false);
  const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
  const [jobCount, setJobCount] = useState(0);
  const [jobsCompleted, setJobsCompleted] = useState(0);
  const [score, setScore] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!address) return;
      setLoading(true);
      try {
        const [identity, credentials, jobs] = await Promise.all([
          fetchArcIdentityForWallet(address),
          fetchCredentialsForAgent(address),
          fetchJobsByAgent(address)
        ]);
        if (!active) return;

        setJobsCompleted(jobs.length);
        setJobCount(await fetchJobsCreatedCount(address));
        setScore(credentials.reduce((sum, item) => sum + item.weight, 0));

        if (!identity?.tokenURI) {
          setIsAgent(false);
          setMetadata(null);
          return;
        }

        try {
          const response = await fetch(mapUri(identity.tokenURI));
          const parsed = (await response.json()) as AgentMetadata;
          setMetadata(parsed);
          setIsAgent((parsed.type ?? "").toLowerCase() === "agent");
        } catch {
          setMetadata(null);
          setIsAgent(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLogs((prev) => {
        const next = [...prev, `[${new Date().toLocaleTimeString()}] observed wallet activity heartbeat`];
        return next.slice(-12);
      });
    }, 3000);
    return () => window.clearInterval(interval);
  }, []);

  if (!address) {
    return <div className="archon-card p-6 text-sm text-[#9CA3AF]">Invalid agent address.</div>;
  }

  if (loading) {
    return <div className="archon-card p-6 text-sm text-[#9CA3AF]">Loading profile...</div>;
  }

  if (!isAgent) {
    return (
      <section className="space-y-4">
        <div className="archon-card p-6">
          <h1 className="text-2xl font-semibold text-[#EAEAF0]">Human Profile</h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            {shortAddress(address)} is not registered as an Arc agent identity. Showing normal wallet profile.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#C9D0DB]">Jobs created: {jobCount}</div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#C9D0DB]">Jobs completed: {jobsCompleted}</div>
            <div className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-sm text-[#C9D0DB]">Score tier: {getReputationTier(score)}</div>
          </div>
          <Link href={`/verify/${address}`} className="archon-button-secondary mt-4 inline-flex px-3 py-2 text-xs">
            Open Public Verification
          </Link>
        </div>
      </section>
    );
  }

  const accent = (metadata?.specialization ?? "").includes("security") ? "#BF00FF" : "#00FF41";
  const border = accent === "#00FF41" ? "#1A3A1A" : "#2D0052";

  return (
    <section
      style={{
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
        background: "#060D14",
        color: accent,
        minHeight: "calc(100vh - 120px)",
        border: `1px solid ${border}`,
        borderRadius: "16px",
        padding: "20px"
      }}
    >
      <div style={{ border: `1px solid ${border}`, padding: "14px", marginBottom: "16px" }}>
        <p style={{ margin: 0, fontSize: "14px" }}>AGENT IDENTITY TERMINAL</p>
        <p style={{ margin: "8px 0 0", fontSize: "22px", fontWeight: 700 }}>{metadata?.name ?? "Unnamed Agent"}</p>
        <p style={{ margin: "6px 0 0", fontSize: "12px", opacity: 0.85 }}>
          {address} | version {metadata?.version ?? "n/a"} | specialization {metadata?.specialization ?? "general"}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px" }}>
        <div style={{ border: `1px solid ${border}`, padding: "12px", minHeight: "360px" }}>
          <p style={{ marginTop: 0, marginBottom: "10px", fontSize: "13px" }}>LIVE ACTIVITY LOG</p>
          <div style={{ fontSize: "12px", lineHeight: 1.65, maxHeight: "310px", overflowY: "auto" }}>
            {logs.length === 0 ? "[waiting for events...]" : logs.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
          </div>
        </div>

        <div style={{ border: `1px solid ${border}`, padding: "12px" }}>
          <p style={{ marginTop: 0, marginBottom: "10px", fontSize: "13px" }}>SYSTEM STATS</p>
          <div style={{ display: "grid", gap: "8px", fontSize: "12px" }}>
            <div style={{ border: `1px solid ${border}`, padding: "8px" }}>Jobs completed: {jobsCompleted}</div>
            <div style={{ border: `1px solid ${border}`, padding: "8px" }}>Jobs posted: {jobCount}</div>
            <div style={{ border: `1px solid ${border}`, padding: "8px" }}>Reputation score: {score}</div>
            <div style={{ border: `1px solid ${border}`, padding: "8px" }}>Tier: {getReputationTier(score)}</div>
            <div style={{ border: `1px solid ${border}`, padding: "8px" }}>Last sync: {formatTimestamp(Math.floor(Date.now() / 1000))}</div>
          </div>
          <a href={`/verify/${address}`} style={{ display: "inline-block", marginTop: "12px", color: accent, textDecoration: "underline" }}>
            Open credential verification page
          </a>
        </div>
      </div>
    </section>
  );
}
