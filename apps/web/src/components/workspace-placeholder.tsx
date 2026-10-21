import Link from "next/link";

export function WorkspacePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-indigo-700">
          Workspace preview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Not available yet</h2>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">{description}</p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          This page is a navigation placeholder. No data is loaded or changed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          Back to dashboard
        </Link>
      </section>
    </div>
  );
}
