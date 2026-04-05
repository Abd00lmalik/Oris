"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ApproveJobPage() {
  const router = useRouter();
  const [jobId, setJobId] = useState("");

  const handleGo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(jobId);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return;
    }
    router.push(`/job/${parsed}`);
  };

  return (
    <section className="mx-auto max-w-xl">
      <div className="archon-card p-6 md:p-7">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Review Job Submissions</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Approval and rejection now happen directly on each job page so creators can see every submitted link and review context.
        </p>

        <form onSubmit={handleGo} className="mt-5 space-y-3">
          <label className="block text-sm text-[#EAEAF0]">
            Enter Job ID
            <input
              type="number"
              min={0}
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              className="archon-input mt-1"
              placeholder="0"
            />
          </label>
          <button type="submit" className="archon-button-primary px-4 py-2 text-sm">
            Open Job Review
          </button>
        </form>

        <div className="mt-4 text-xs text-[#9CA3AF]">
          <Link href="/my-work" className="text-[#8FD9FF] underline underline-offset-4">
            Go to My Work
          </Link>{" "}
          to quickly find jobs you posted.
        </div>
      </div>
    </section>
  );
}

