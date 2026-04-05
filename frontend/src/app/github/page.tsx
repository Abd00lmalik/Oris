"use client";

import Link from "next/link";

export default function GitHubPage() {
  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">GitHub Contributions</h1>
        <p className="mt-3 text-sm text-[#9CA3AF]">
          Submit GitHub contributions directly as a task deliverable. Browse open tasks on the home page, accept a
          task that requires GitHub work, and submit your PR or commit link as your deliverable.
        </p>
        <div className="mt-5">
          <Link href="/" className="archon-button-primary inline-flex px-4 py-2 text-sm">
            Browse Open Tasks
          </Link>
        </div>
      </div>
    </section>
  );
}

