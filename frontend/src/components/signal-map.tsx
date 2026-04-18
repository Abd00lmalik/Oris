"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PersonSignal, TaskHeatmap } from "@/lib/signal-map";

function interpolateColor(ratio: number): string {
  if (ratio >= 0.75) return "#00FFA3";
  if (ratio >= 0.55) return "#52C41A";
  if (ratio >= 0.45) return "#F5A623";
  if (ratio >= 0.25) return "#FF6B35";
  return "#FF3366";
}

function PersonAvatar({ person, size = 48 }: { person: PersonSignal; size?: number }) {
  const color = interpolateColor(person.colorRatio);
  const initials = (person.username ?? person.address).replace("0x", "").slice(0, 2).toUpperCase();

  return (
    <div
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-none border-2"
      style={{
        width: size,
        height: size,
        borderColor: color,
        background: `${color}15`
      }}
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt={person.username ?? person.address}
          className="h-full w-full object-cover"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="select-none font-mono font-bold" style={{ color, fontSize: size * 0.35 }}>
          {initials}
        </span>
      )}

      <div className="absolute bottom-0.5 right-0.5 h-2 w-2" style={{ background: color }} />
    </div>
  );
}

function PersonCell({
  person,
  isSelected,
  onClick
}: {
  person: PersonSignal;
  isSelected: boolean;
  onClick: () => void;
}) {
  const color = interpolateColor(person.colorRatio);
  const size = Math.max(80, Math.min(160, 60 + person.activityWeight * 1.0));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.06, zIndex: 10 }}
      transition={{ duration: 0.25 }}
      onClick={onClick}
      className="cursor-pointer"
      style={{ width: size, height: size + 24 }}
    >
      <div
        className="flex h-full w-full flex-col items-center justify-center border-2 p-2 transition-all duration-200"
        style={{
          borderColor: isSelected ? color : `${color}50`,
          background: isSelected ? `${color}15` : `${color}08`,
          boxShadow: isSelected ? `0 0 16px ${color}30` : "none"
        }}
      >
        <PersonAvatar person={person} size={Math.max(32, size * 0.4)} />

        <div className="mt-1.5 w-full truncate px-1 text-center text-[9px] font-mono font-semibold" style={{ color }}>
          {person.username ?? `${person.address.slice(0, 4)}..${person.address.slice(-3)}`}
        </div>

        <div className="mt-0.5 text-[10px] font-mono font-bold" style={{ color }}>
          {person.activityWeight}%
        </div>

        <div className="mt-1 flex gap-0.5">
          {person.buildsOnGiven > 0 ? (
            <span className="text-[8px] font-mono" style={{ color: "#00FFA3" }}>
              +{person.buildsOnGiven}
            </span>
          ) : null}
          {person.critiquesGiven > 0 ? (
            <span className="text-[8px] font-mono" style={{ color: "#FF3366" }}>
              -{person.critiquesGiven}
            </span>
          ) : null}
          {person.submissionCount > 0 ? (
            <span className="text-[8px] font-mono" style={{ color }}>
              ↑{person.submissionCount}
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

interface Props {
  heatmap: TaskHeatmap;
  loading?: boolean;
}

export default function SignalMap({ heatmap, loading = false }: Props) {
  const [selected, setSelected] = useState<PersonSignal | null>(null);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center font-mono text-xs text-[var(--text-muted)]">
        Loading signal map...
      </div>
    );
  }

  if (heatmap.people.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center p-6 text-center">
        <div className="mb-2 font-mono text-xs text-[var(--text-muted)]">NO SIGNALS YET</div>
        <div className="max-w-xs text-[10px] text-[var(--text-muted)]">
          The signal map appears after reveal phase opens and participants begin critiquing and building on finalists.
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="mb-4 flex items-center gap-4 text-[10px] font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#00FFA3" }} />
            BUILD-ONS
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#FF3366" }} />
            CRITIQUES
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3" style={{ background: "#F5A623" }} />
            MIXED
          </div>
          <span className="ml-auto">
            {heatmap.totalActivity} total interactions · {heatmap.people.length} participants
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {heatmap.people.map((person) => (
            <PersonCell
              key={person.address}
              person={person}
              isSelected={selected?.address.toLowerCase() === person.address.toLowerCase()}
              onClick={() =>
                setSelected((current) =>
                  current?.address.toLowerCase() === person.address.toLowerCase() ? null : person
                )
              }
            />
          ))}
        </div>
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0, x: 20, width: 0 }}
            animate={{ opacity: 1, x: 0, width: 280 }}
            exit={{ opacity: 0, x: 20, width: 0 }}
            className="shrink-0 overflow-hidden border border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-3">
                <PersonAvatar person={selected} size={48} />
                <div>
                  <div className="font-heading text-sm font-semibold">{selected.username ?? "Anonymous"}</div>
                  <div className="text-[10px] font-mono text-[var(--text-muted)]">
                    {selected.address.slice(0, 10)}...{selected.address.slice(-6)}
                  </div>
                  <div
                    className="mt-0.5 text-[10px] font-mono uppercase"
                    style={{ color: interpolateColor(selected.colorRatio) }}
                  >
                    {selected.role}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "SUBMISSIONS", value: selected.submissionCount, color: "var(--arc)" },
                  {
                    label: "ACTIVITY WT.",
                    value: `${selected.activityWeight}%`,
                    color: interpolateColor(selected.colorRatio)
                  },
                  { label: "BUILDS GIVEN", value: selected.buildsOnGiven, color: "#00FFA3" },
                  { label: "CRITIQUES", value: selected.critiquesGiven, color: "#FF3366" },
                  { label: "BUILDS REC.", value: selected.buildsOnReceived, color: "#00FFA3" },
                  { label: "CRITIQUES REC.", value: selected.critiquesReceived, color: "#FF3366" }
                ].map((stat) => (
                  <div key={stat.label} className="border border-[var(--border)] p-2 text-center">
                    <div className="font-mono text-base font-bold" style={{ color: stat.color }}>
                      {stat.value}
                    </div>
                    <div className="mt-0.5 text-[8px] font-mono text-[var(--text-muted)]">{stat.label}</div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => window.open(`/profile?address=${selected.address}`, "_blank")}
                className="btn-ghost w-full text-xs"
              >
                View Full Profile ↗
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
