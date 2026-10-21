import Link from "next/link";
import { ArrowRight, Bookmark, ListChecks, MessagesSquare } from "lucide-react";

const cards = [
  { label: "Saved jobs", icon: Bookmark },
  { label: "Applications", icon: ListChecks },
  { label: "Outreach drafts", icon: MessagesSquare },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-indigo-700">Your workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Dashboard
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          A clearer view of your next opportunity. Keep jobs, applications and
          thoughtful outreach in one place.
        </p>
      </div>
      <section
        aria-label="Workspace connection status"
        className="grid gap-4 sm:grid-cols-3"
      >
        {cards.map(({ label, icon: Icon }) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-5"
          >
            <Icon className="mb-5 size-5 text-indigo-600" aria-hidden="true" />
            <h2 className="text-sm font-medium text-slate-600">{label}</h2>
            <p className="mt-2 text-xl font-semibold">Not connected</p>
          </div>
        ))}
      </section>
      <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6 sm:p-8">
        <p className="text-sm font-semibold text-indigo-800">
          Dashboard preview
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          The foundation for your search
        </h2>
        <p className="mt-3 max-w-2xl leading-7 text-slate-700">
          Save jobs and browse real records on the Saved jobs page. Dashboard
          totals and activity are not connected to the job API yet, so no counts
          are shown here. Other workspace features remain clearly labeled
          previews.
        </p>
        <Link
          href="/jobs"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          Explore saved jobs
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
