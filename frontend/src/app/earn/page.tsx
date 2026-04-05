"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchCredentialsForAgent } from "@/lib/contracts";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

type SourceCard = {
  key: string;
  icon: string;
  name: string;
  what: string;
  weight: string;
  payment: string;
  href: string;
  cta: string;
};

const SOURCE_CARDS: SourceCard[] = [
  {
    key: "job",
    icon: "??",
    name: "Complete Jobs",
    what: "Browse open jobs, do the work, submit a link, get paid in USDC + earn a credential when approved.",
    weight: "+100 pts per job",
    payment: "?? Paid (USDC)",
    href: "/",
    cta: "Browse Open Jobs"
  },
  {
    key: "github",
    icon: "??",
    name: "GitHub Contributions",
    what: "Submit proof of a merged PR, resolved issue, or code contribution on GitHub. A verifier reviews and approves.",
    weight: "+70 to +150 pts (varies by type)",
    payment: "?? Reputation only",
    href: "/github",
    cta: "Submit GitHub Activity"
  },
  {
    key: "agent_task",
    icon: "??",
    name: "AI Agent Tasks",
    what: "Claim a task, complete it autonomously or manually, submit your output. Get paid in USDC + earn a credential.",
    weight: "+130 pts per task",
    payment: "?? Paid (USDC)",
    href: "/tasks",
    cta: "Browse Tasks"
  },
  {
    key: "community",
    icon: "??",
    name: "Community Work",
    what: "Earn credentials for helping users, creating content, moderation, or running events. Awarded by verified moderators.",
    weight: "+50 to +120 pts (varies by activity)",
    payment: "?? Reputation only",
    href: "/community",
    cta: "View Community Credentials"
  },
  {
    key: "peer_attestation",
    icon: "??",
    name: "Peer Vouching",
    what: "Other verified users (with credentials) can vouch for your work. You automatically receive a credential when attested.",
    weight: "+60 pts per attestation",
    payment: "?? Reputation only",
    href: "/attest",
    cta: "Give or Receive Attestations"
  },
  {
    key: "dao_governance",
    icon: "???",
    name: "DAO Voting",
    what: "Prove you voted on an on-chain governance proposal. Verified instantly and automatically — no review needed.",
    weight: "+90 pts per vote",
    payment: "?? Reputation only",
    href: "/governance",
    cta: "Claim Voting Credential"
  }
];

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("github")) return "github";
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

export default function EarnPage() {
  const { account } = useWallet();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!account) {
        setCounts({});
        setScore(0);
        return;
      }

      setLoading(true);
      try {
        const credentials = await fetchCredentialsForAgent(account);
        if (!active) return;
        const nextCounts: Record<string, number> = {};
        for (const credential of credentials) {
          const key = normalizeSource(credential.sourceType);
          nextCounts[key] = (nextCounts[key] ?? 0) + 1;
        }
        setCounts(nextCounts);
        setScore(calculateWeightedScore(credentials));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [account]);

  const tier = useMemo(() => getReputationTier(score), [score]);

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Ways to Earn Credentials</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Every credential is permanently recorded on Arc. Your reputation grows with every verified contribution.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-[#111214] px-4 py-3 text-sm text-[#9CA3AF]">
          {account ? (
            loading ? (
              "Loading your score..."
            ) : (
              <span>
                Your current score: <strong className="text-[#EAEAF0]">{score}</strong> · Tier{" "}
                <span className="text-[#00D1B2]">{tier}</span>
              </span>
            )
          ) : (
            "Connect wallet to see your score"
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SOURCE_CARDS.map((card) => (
          <article key={card.key} className="archon-card flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xl" aria-hidden="true">{card.icon}</p>
                <h2 className="mt-1 text-lg font-semibold text-[#EAEAF0]">{card.name}</h2>
              </div>
              <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-[#9CA3AF]">{card.weight}</span>
            </div>
            <p className="mt-3 text-sm text-[#9CA3AF]">{card.what}</p>
            <p className="mt-3 text-xs text-[#9CA3AF]">{card.payment}</p>
            <p className="mt-2 text-sm text-[#EAEAF0]">You have earned: <strong>{counts[card.key] ?? 0}</strong> credentials from this source</p>
            <div className="mt-auto pt-5">
              <Link href={card.href} className="archon-button-primary inline-flex px-3 py-2 text-sm">
                {card.cta}
              </Link>
            </div>
          </article>
        ))}
      </div>

      <div className="archon-card p-6">
        <h3 className="text-lg font-semibold text-[#EAEAF0]">FAQ</h3>
        <div className="mt-4 space-y-4 text-sm text-[#9CA3AF]">
          <div>
            <p className="font-medium text-[#EAEAF0]">What is a credential?</p>
            <p className="mt-1">A permanent on-chain record proving you did real work. It cannot be deleted, transferred, or faked.</p>
          </div>
          <div>
            <p className="font-medium text-[#EAEAF0]">What is a reputation score?</p>
            <p className="mt-1">The sum of weights from all your credentials, capped at 2000. Higher scores unlock Elite and Legend tier status.</p>
          </div>
          <div>
            <p className="font-medium text-[#EAEAF0]">Can I game the system?</p>
            <p className="mt-1">The platform uses time locks, economic friction, and suspicion scoring to detect farming. Fake credentials have zero value to employers or other users.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

