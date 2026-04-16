"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ActivityEvent } from "@/lib/activity";

const EVENT_STYLES: Record<ActivityEvent["type"], { icon: string; color: string; label: string }> = {
  task_created: { icon: "*", color: "var(--arc)", label: "NEW TASK" },
  task_accepted: { icon: "<>", color: "var(--text-secondary)", label: "ACCEPTED" },
  submission_made: { icon: "^", color: "var(--arc)", label: "SUBMITTED" },
  submission_approved: { icon: "v", color: "var(--pulse)", label: "APPROVED" },
  response_added: { icon: "->", color: "var(--warn)", label: "RESPONSE" },
  credential_minted: { icon: "[]", color: "var(--pulse)", label: "CREDENTIAL" },
  stake_slashed: { icon: "x", color: "var(--danger)", label: "SLASHED" },
  agent_joined: { icon: "()", color: "var(--agent)", label: "AGENT" },
  challenge_raised: { icon: "!", color: "var(--warn)", label: "CHALLENGE" },
  reward_claimed: { icon: "$", color: "var(--gold)", label: "REWARD" }
};

type Props = {
  events: ActivityEvent[];
  maxVisible?: number;
  terminal?: boolean;
};

export function LiveFeed({ events, maxVisible = 20, terminal = false }: Props) {
  const visible = events.slice(0, maxVisible);

  return (
    <div className={terminal ? "terminal space-y-0 overflow-hidden" : "space-y-0 overflow-hidden"}>
      <AnimatePresence initial={false}>
        {visible.map((eventItem, index) => {
          const style = EVENT_STYLES[eventItem.type] ?? EVENT_STYLES.submission_made;

          return (
            <motion.div
              key={eventItem.id}
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: index === 0 ? 1 : 0.75, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex items-start gap-3 border-b border-[var(--border)] px-3 py-2.5 transition-colors hover:bg-[var(--surface)]"
            >
              <span className="mono mt-0.5 shrink-0 text-xs" style={{ color: style.color }}>
                {style.icon}
              </span>

              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="mono text-[10px] font-semibold tracking-wider" style={{ color: style.color }}>
                    {style.label}
                  </span>
                  {eventItem.isAgent ? (
                    <span className="mono border border-[var(--agent-dim)] px-1 text-[9px]" style={{ color: "var(--agent)" }}>
                      AGENT
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs leading-relaxed text-[var(--text-secondary)]">{eventItem.description}</p>
              </div>

              <span className="mono mt-0.5 shrink-0 text-[10px] text-[var(--text-muted)]">{eventItem.timeAgo}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {events.length === 0 ? (
        <div className="py-8 text-center text-xs text-[var(--text-muted)]">
          <span className="mono">Watching for activity...</span>
        </div>
      ) : null}
    </div>
  );
}
