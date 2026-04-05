"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { fetchCredentialsForAgent } from "@/lib/contracts";
import { IconAttest, IconCommunity, IconGovernance, IconRobot, IconStar, IconTask, IconWallet } from "@/lib/icons";
import { calculateWeightedScore, getReputationTier } from "@/lib/reputation";
import { useWallet } from "@/lib/wallet-context";

type SourceCard = {
  key: string;
  name: string;
  what: string;
  weight: string;
  paid: boolean;
  href: string;
  cta: string;
  icon: ReactNode;
};

const SOURCE_CARDS: SourceCard[] = [
  {
    key: "job",
    icon: <IconTask className="h-5 w-5" />,
    name: "Complete Tasks",
    what: "Browse open tasks, do the work, submit a link, get paid in USDC + earn a credential when approved.",
    weight: "Credential weight: +100 pts per task",
    paid: true,
    href: "/",
    cta: "Browse Open Tasks"
  },
  {
    key: "agent_task",
    icon: <IconRobot className="h-5 w-5" />,
    name: "Agentic Tasks",
    what: "Claim a task, complete it autonomously or manually, submit your output. Get paid in USDC + earn a credential.",
    weight: "Credential weight: +130 pts per task",
    paid: true,
    href: "/tasks",
    cta: "Browse Agentic Tasks"
  },
  {
    key: "community",
    icon: <IconCommunity className="h-5 w-5" />,
    name: "Community Work",
    what: "Earn credentials for helping users, creating content, moderation, or running events. Awarded by verified moderators.",
    weight: "Credential weight: +50 to +120 pts",
    paid: false,
    href: "/community",
    cta: "View Community Credentials"
  },
  {
    key: "peer_attestation",
    icon: <IconAttest className="h-5 w-5" />,
    name: "Peer Vouching",
    what: "Other top-tier members can vouch for your work. You receive a credential when attested.",
    weight: "Credential weight: +60 pts per attestation",
    paid: false,
    href: "/attest",
    cta: "Give or Receive Attestations"
  },
  {
    key: "dao_governance",
    icon: <IconGovernance className="h-5 w-5" />,
    name: "DAO Governance",
    what: "Prove you voted on an on-chain governance proposal. Verified instantly and automatically with no review queue.",
    weight: "Credential weight: +90 pts per vote",
    paid: false,
    href: "/governance",
    cta: "Claim Voting Credential"
  }
];

function normalizeSource(sourceType: string) {
  const normalized = sourceType.toLowerCase().trim();
  if (normalized.startsWith("community")) return "community";
  return normalized;
}

function SourceCardView({ card, earned }: { card: SourceCard; earned: number }) {
  return (
    <article className="archon-card flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[#EAEAF0]">{card.icon}</span>
          <h2 className="text-lg font-semibold text-[#EAEAF0]">{card.name}</h2>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-[#9CA3AF]">{card.weight}</span>
      </div>

      <p className="mt-3 text-sm text-[#9CA3AF]">{card.what}</p>
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-[#9CA3AF]">
        {card.paid ? <IconWallet className="h-4 w-4" /> : <IconStar className="h-4 w-4" />}
        {card.paid ? "Paid in USDC" : "Reputation only"}
      </p>
      <p className="mt-2 text-sm text-[#EAEAF0]">
        You have earned: <strong>{earned}</strong> credentials from this source
      </p>

      <div className="mt-auto pt-5">
        <Link href={card.href} className="archon-button-primary inline-flex px-3 py-2 text-sm">
          {card.cta}
        </Link>
      </div>
    </article>
  );
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
  const firstFour = SOURCE_CARDS.slice(0, 4);
  const finalCard = SOURCE_CARDS[4];

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
                Your current score: <strong className="text-[#EAEAF0]">{score}</strong> | Tier{" "}
                <span className="text-[#00D1B2]">{tier}</span>
              </span>
            )
          ) : (
            "Connect wallet to see your score"
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {firstFour.map((card) => (
          <SourceCardView key={card.key} card={card} earned={counts[card.key] ?? 0} />
        ))}
      </div>

      <div className="mx-auto max-w-xl">
        <SourceCardView card={finalCard} earned={counts[finalCard.key] ?? 0} />
      </div>

      <div className="archon-card p-6">
        <h3 className="text-lg font-semibold text-[#EAEAF0]">FAQ</h3>
        <div className="mt-4 space-y-4 text-sm text-[#9CA3AF]">
          <div>
            <p className="font-medium text-[#EAEAF0]">What is a credential?</p>
            <p className="mt-1">
              A permanent on-chain record proving you did real work. It cannot be deleted, transferred, or faked.
            </p>
          </div>
          <div>
            <p className="font-medium text-[#EAEAF0]">What is a reputation score?</p>
            <p className="mt-1">
              The sum of weights from all your credentials, capped at 2000. Higher scores unlock Keystone and Arc
              Founder tier status.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

