"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  applicationStatuses,
  isJobDetail,
  isJobId,
  safeSourceUrl,
  statusLabel,
  type ApplicationStatus,
  type JobDetail,
} from "@/lib/jobs";

const buttonClass =
  "rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

async function readJob(response: Response): Promise<JobDetail> {
  const data: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
        ? data.message
        : "Job request failed. Try loading the job again.",
    );
  }
  if (!isJobDetail(data))
    throw new Error("Job service returned invalid job details.");
  return data;
}

export function JobDetails({ id }: { id: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<ApplicationStatus>("interested");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError("");
      setNotFound(false);
      try {
        if (!isJobId(id)) {
          setNotFound(true);
          setLoadError("Invalid job ID.");
          return;
        }
        const response = await fetch(`/api/jobs/${id}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setNotFound(true);
          setLoadError("Saved job not found.");
          return;
        }
        const value = await readJob(response);
        if (value.id.toLowerCase() !== id.toLowerCase())
          throw new Error("Job service returned a different job.");
        if (!controller.signal.aborted) {
          setJob(value);
          setSelected(value.application?.status ?? "interested");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "Unable to load job.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [id, revision]);

  async function saveStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      savingRef.current ||
      !job?.application ||
      selected === job.application.status
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/jobs/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: selected }),
      });
      const value = await readJob(response);
      if (
        value.id.toLowerCase() !== id.toLowerCase() ||
        value.application?.status !== selected
      )
        throw new Error("Job service did not confirm the requested status.");
      setJob(value);
      setSaved(true);
    } catch (error) {
      setSaveError(
        `${error instanceof Error ? error.message : "Unable to save status."} Your selection has been kept. Reload the page to check persisted status after a connection failure.`,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const source = job ? safeSourceUrl(job.source_url) : null;
  return (
    <div className="space-y-6">
      <Link
        href="/jobs"
        className="rounded font-semibold text-indigo-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Back to saved jobs
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Job details</h1>
      {loading ? (
        <p role="status">Loading job...</p>
      ) : loadError ? (
        <div role="alert" className="space-y-3 text-red-700">
          <p>{loadError}</p>
          {!notFound && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry loading job
            </button>
          )}
        </div>
      ) : (
        job && (
          <>
            <section
              aria-labelledby="job-title"
              className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h2
                id="job-title"
                className="text-2xl font-semibold wrap-anywhere"
              >
                {job.title ?? "Title not available"}
              </h2>
              <dl className="grid gap-5 sm:grid-cols-2">
                {(
                  [
                    ["Company", job.company],
                    ["Location", job.location],
                    ["Requisition ID", job.requisition_id],
                    ["Seniority", job.seniority],
                    ["Department", job.department],
                    [
                      "Technologies",
                      job.technologies?.length
                        ? job.technologies.join(", ")
                        : null,
                    ],
                    ["Experience requirements", job.experience_requirements],
                    ["Job ID", job.id],
                    ["Created", job.created_at],
                    ["Job updated", job.updated_at],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm font-medium text-slate-600">
                      {label}
                    </dt>
                    <dd className="mt-1 wrap-anywhere whitespace-pre-wrap">
                      {value ?? "Not available"}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt className="text-sm font-medium text-slate-600">
                    Source URL
                  </dt>
                  <dd className="mt-1 wrap-anywhere">
                    {source ? (
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                      >
                        {source} (opens in new tab)
                      </a>
                    ) : job.source_url ? (
                      "Source URL unavailable: invalid or unsafe link."
                    ) : (
                      "Not available"
                    )}
                  </dd>
                </div>
              </dl>
              <div>
                <h3 className="font-semibold">Job description</h3>
                <p className="mt-2 wrap-anywhere whitespace-pre-wrap text-slate-700">
                  {job.description ?? "Not available"}
                </p>
              </div>
            </section>
            <section
              aria-labelledby="tracking-heading"
              className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h2 id="tracking-heading" className="text-xl font-semibold">
                Application tracking
              </h2>
              {job.application ? (
                <>
                  <p>
                    Current saved status:{" "}
                    <strong>{statusLabel(job.application.status)}</strong>
                  </p>
                  <dl className="grid gap-4 text-sm sm:grid-cols-2">
                    {(
                      [
                        ["Tracking ID", job.application.id],
                        ["Tracking created", job.application.created_at],
                        ["Tracking updated", job.application.updated_at],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label}>
                        <dt className="font-medium text-slate-600">{label}</dt>
                        <dd className="mt-1 wrap-anywhere">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <form onSubmit={saveStatus} className="space-y-4">
                    <label className="block text-sm font-medium">
                      Application status
                      <select
                        disabled={saving}
                        value={selected}
                        onChange={(event) => {
                          const value = applicationStatuses.find(
                            ([status]) => status === event.target.value,
                          )?.[0];
                          if (value) {
                            setSelected(value);
                            setSaved(false);
                            setSaveError("");
                          }
                        }}
                        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-indigo-600 sm:max-w-sm"
                      >
                        {applicationStatuses.map(([value, label]) => (
                          <option value={value} key={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-sm text-slate-600">
                      Any listed status is allowed. Changes are saved only when
                      you select Save status.
                    </p>
                    <button
                      type="submit"
                      disabled={saving || selected === job.application.status}
                      className={buttonClass}
                    >
                      {saving ? "Saving status..." : "Save status"}
                    </button>
                    {saved && (
                      <p role="status" className="text-green-800">
                        Application status saved.
                      </p>
                    )}
                    {saveError && (
                      <p role="alert" className="text-red-700">
                        {saveError}
                      </p>
                    )}
                  </form>
                </>
              ) : (
                <p role="status">
                  Application tracking is not available for this job. Status
                  changes are unavailable; no tracking record will be created
                  automatically.
                </p>
              )}
            </section>
          </>
        )
      )}
    </div>
  );
}
