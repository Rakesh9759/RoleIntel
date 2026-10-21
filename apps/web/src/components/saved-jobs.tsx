"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  applicationStatuses,
  isSavedJob,
  statusLabel,
  type SavedJob,
} from "@/lib/jobs";

const pageSize = 20;
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 focus-visible:outline-2 focus-visible:outline-indigo-600";
const buttonClass =
  "rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

async function responseData(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
        ? data.message
        : "Job request failed. Check the service and try again.",
    );
  }
  return data;
}

export function SavedJobs() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const filterForm = useRef<HTMLFormElement>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState({
    q: "",
    company: "",
    status: "",
    offset: 0,
  });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setListError("");
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(query.offset),
      });
      for (const key of ["q", "company", "status"] as const) {
        if (query[key]) params.set(key, query[key]);
      }
      try {
        const response = await fetch(`/api/jobs?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await responseData(response);
        if (!Array.isArray(data) || !data.every(isSavedJob))
          throw new Error("Job service returned an invalid job list.");
        if (!controller.signal.aborted) setJobs(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setListError(
            error instanceof Error ? error.message : "Unable to load jobs.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [query, revision]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setQuery({
      q: String(fields.get("q") ?? "").trim(),
      company: String(fields.get("company") ?? "").trim(),
      status: String(fields.get("status") ?? ""),
      offset: 0,
    });
  }

  async function saveJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const body: Record<string, string> = {};
    for (const key of [
      "title",
      "company",
      "location",
      "description",
      "source_url",
    ]) {
      const value = String(fields.get(key) ?? "").trim();
      if (value) body[key] = value;
    }
    setSaved(false);
    setSaveError("");
    if (!body.description && !body.source_url) {
      setSaveError("Provide a job description or source URL.");
      return;
    }
    if (body.source_url) {
      try {
        const url = new URL(body.source_url);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new Error("Invalid source URL");
      } catch {
        setSaveError("Source URL must use HTTP(S) and contain no credentials.");
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await responseData(response);
      if (!isSavedJob(data))
        throw new Error(
          "Invalid save response. Check the list before resubmitting.",
        );
      form.reset();
      setSaved(true);
      filterForm.current?.reset();
      setQuery({ q: "", company: "", status: "", offset: 0 });
      setRevision((value) => value + 1);
    } catch (error) {
      setSaveError(
        `${error instanceof Error ? error.message : "Unable to save job."} Your input has been kept. For connection errors, check the list before resubmitting.`,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-indigo-700">Your workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Saved jobs
        </h1>
        <p className="mt-3 text-slate-600">
          Save user-supplied job information. URLs are stored only, never
          fetched or parsed.
        </p>
      </div>
      <section
        className="rounded-2xl border border-slate-200 bg-white p-6"
        aria-labelledby="save-job-heading"
      >
        <h2 id="save-job-heading" className="text-xl font-semibold">
          Save a job
        </h2>
        <p id="save-help" className="mt-2 text-sm text-slate-600">
          Provide a description or source URL. Other fields are optional. New
          jobs start as Interested.
        </p>
        <form
          onSubmit={saveJob}
          aria-describedby="save-help"
          className="mt-5 space-y-4"
        >
          <fieldset disabled={saving} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["title", "Title"],
                ["company", "Company"],
                ["location", "Location"],
              ].map(([name, label]) => (
                <label key={name} className="block text-sm font-medium">
                  {label}
                  <input name={name} maxLength={1000} className={inputClass} />
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium">
              Job description
              <textarea
                name="description"
                maxLength={100000}
                rows={5}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Source URL
              <input
                name="source_url"
                type="url"
                maxLength={2048}
                className={inputClass}
              />
            </label>
            <button type="submit" className={buttonClass}>
              {saving ? "Saving..." : "Save job"}
            </button>
          </fieldset>
          {saveError && (
            <p role="alert" className="text-sm text-red-700">
              {saveError}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-green-800">
              Job saved. Filters cleared to show the newest jobs.
            </p>
          )}
        </form>
      </section>
      <section aria-labelledby="job-list-heading" className="space-y-4">
        <h2 id="job-list-heading" className="text-xl font-semibold">
          Saved job list
        </h2>
        <form
          ref={filterForm}
          onSubmit={applyFilters}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Search jobs
              <input name="q" maxLength={1000} className={inputClass} />
            </label>
            <label className="text-sm font-medium">
              Company (exact match)
              <input name="company" maxLength={1000} className={inputClass} />
            </label>
            <label className="text-sm font-medium">
              Application status
              <select name="status" className={inputClass}>
                <option value="">All statuses</option>
                {applicationStatuses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className={buttonClass} type="submit">
              Apply filters
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={(event) => {
                event.currentTarget.form?.reset();
                setQuery({ q: "", company: "", status: "", offset: 0 });
              }}
            >
              Clear filters
            </button>
          </div>
        </form>
        {loading ? (
          <p role="status">Loading jobs...</p>
        ) : listError ? (
          <div role="alert" className="space-y-3 text-red-700">
            <p>{listError}</p>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry loading jobs
            </button>
          </div>
        ) : (
          <>
            {jobs.length === 0 ? (
              <p role="status">
                {query.offset > 0
                  ? "No more jobs on this page."
                  : query.q || query.company || query.status
                    ? "No jobs match these filters."
                    : "No saved jobs yet. Save your first job above."}
              </p>
            ) : (
              <ul className="space-y-4">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <h3 className="text-lg font-semibold wrap-anywhere">
                      {job.title ?? "Title not available"}
                    </h3>
                    <p className="mt-2 wrap-anywhere text-slate-600">
                      {job.company ?? "Company not available"} &middot;{" "}
                      {job.location ?? "Location not available"}
                    </p>
                    <p className="mt-3 text-sm font-medium text-indigo-800">
                      {job.application
                        ? statusLabel(job.application.status)
                        : "Tracking not available"}
                    </p>
                    {job.description && (
                      <p className="mt-3 line-clamp-3 text-sm wrap-anywhere whitespace-pre-wrap text-slate-600">
                        {job.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            disabled={loading || query.offset === 0}
            onClick={() =>
              setQuery({
                ...query,
                offset: Math.max(0, query.offset - pageSize),
              })
            }
          >
            Previous page
          </button>
          <span className="text-sm text-slate-600">
            Page {query.offset / pageSize + 1}
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={loading || !!listError || jobs.length < pageSize}
            onClick={() =>
              setQuery({ ...query, offset: query.offset + pageSize })
            }
          >
            Next page
          </button>
        </div>
      </section>
    </div>
  );
}
