"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { OPEN_TUTORIAL_EVENT } from "@/components/global-overlays";
import { RouteAnnouncer } from "@/components/route-announcer";
import { WrongNetworkBanner } from "@/components/wrong-network-banner";
import { expectedChainId, shortAddress } from "@/lib/contracts";
import { IconCheck } from "@/lib/icons";
import { useWallet } from "@/lib/wallet-context";

type NavItem = {
  href: string;
  label: string;
};

const NAV_LINKS: NavItem[] = [
  { href: "/", label: "Tasks" },
  { href: "/earn", label: "Earn" },
  { href: "/milestones", label: "Contracts" },
  { href: "/profile", label: "Profile" }
];

export function NavBar() {
  const pathname = usePathname();
  const { account, chainId, openWalletPicker, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isWrongNetwork = chainId !== null && chainId !== expectedChainId;

  return (
    <>
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="sticky top-0 z-50 h-14 border-b border-[var(--border)] bg-[rgba(6,13,20,0.95)] backdrop-blur-md"
      >
        <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo-icon.svg" alt="Archon" className="h-8 w-auto" />
            <div>
              <div className="font-heading text-xs font-bold tracking-[0.15em] text-[var(--text-primary)]">ARCHON</div>
              <div className="mono text-[10px] text-[var(--text-muted)]">ARC TESTNET</div>
            </div>
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              return (
                <Link key={link.href} href={link.href} className={`nav-link ${active ? "active" : ""}`}>
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/skill.md"
              className="badge badge-agent ml-2 transition-opacity hover:opacity-90"
              title="Agent API"
            >
              For Agents
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <span className="badge badge-arc hidden sm:inline-flex">
              <span className="live-dot" /> ARC
            </span>

            {account ? (
              <Link
                href={`/verify/${account}`}
                title="View your public credential page"
                className="btn-ghost inline-flex items-center px-2 py-1.5 text-xs"
                aria-label="View public verification page"
              >
                <IconCheck className="h-4 w-4" />
              </Link>
            ) : null}

            <button
              type="button"
              title="How to use Archon"
              aria-label="How to use Archon"
              onClick={() => window.dispatchEvent(new Event(OPEN_TUTORIAL_EVENT))}
              className="btn-ghost px-2 py-1.5 text-xs"
            >
              ?
            </button>

            {account ? (
              <button type="button" className="btn-ghost px-2 py-1.5 text-xs mono" onClick={disconnect}>
                {shortAddress(account)}
              </button>
            ) : (
              <button type="button" onClick={openWalletPicker} className="btn-primary px-3 py-1.5 text-xs">
                Connect
              </button>
            )}

            <button
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              className="btn-ghost px-2 py-1.5 text-xs md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? "X" : "Menu"}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileOpen ? (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="border-t border-[var(--border)] bg-[var(--surface)] p-3 md:hidden"
            >
              <div className="grid gap-1">
                {NAV_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="nav-link" onClick={() => setMobileOpen(false)}>
                    {link.label}
                  </Link>
                ))}
                <Link href="/skill.md" className="badge badge-agent mt-2 w-fit" onClick={() => setMobileOpen(false)}>
                  For Agents
                </Link>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.nav>
      <WrongNetworkBanner isWrongNetwork={isWrongNetwork} />
      <RouteAnnouncer />
    </>
  );
}
