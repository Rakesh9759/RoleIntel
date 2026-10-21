"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { draftFields, isJobDraft, type JobDraft } from "@/lib/job-draft";
import { isSavedJob, safeSourceUrl } from "@/lib/jobs";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-indigo-600";
const buttonClass =
  "rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

async function readResponse(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
        ? data.message
        : "Request failed. Check the service and try again.",
    );
  }
  return data;
}

export function DescriptionImport() {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState("");
  const preview = useRef<HTMLHeadingElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);

  async function normalize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setError("");
    if (!text.trim()) {
      setError("Paste a job description before normalizing.");
      return;
    }
    lock.current = true;
    setBusy("parse");
    setDraft(null);
    setSavedId("");
    try {
      const data = await readResponse(
        await fetch("/api/jobs/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: text }),
        }),
      );
      if (!isJobDraft(data))
        throw new Error("Normalization returned an invalid preview.");
      setDraft(data);
      requestAnimationFrame(() => preview.current?.focus());
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : "Unable to normalize description."} Your pasted text has been kept.`,
      );
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !draft || savedId) return;
    const fields = new FormData(event.currentTarget);
    const body: Record<string, string | string[]> = {};
    for (const field of [
      ...draftFields.map(([key]) => key),
      "description",
      "experience_requirements",
      "source_url",
    ]) {
      const value = String(fields.get(field) ?? "").trim();
      if (value) body[field] = value;
    }
    const technologies = String(fields.get("technologies") ?? "").trim();
    if (technologies) {
      const items = technologies
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length > 100 || items.some((item) => item.length > 1000)) {
        setError(
          "Enter at most 100 technologies, one per line, each at most 1,000 characters.",
        );
        return;
      }
      body.technologies = [...new Set(items)];
    }
    setError("");
    if (!body.description) {
      setError("The normalized description must not be blank.");
      return;
    }
    if (
      typeof body.source_url === "string" &&
      !safeSourceUrl(body.source_url)
    ) {
      setError("Source URL must use HTTP(S) and contain no credentials.");
      return;
    }
    lock.current = true;
    setBusy("save");
    try {
      const data = await readResponse(
        await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      if (!isSavedJob(data))
        throw new Error(
          "Invalid save response. Check Saved jobs before resubmitting.",
        );
      setSavedId(data.id);
    } catch (error) {
      setError(
        `${error instanceof Error ? error.message : "Unable to save job."} Your edits have been kept. After a connection failure, check Saved jobs before resubmitting; the save may have completed.`,
      );
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Job search</h1>
      <p className="max-w-3xl leading-7 text-slate-600">
        Paste a job description to prepare a draft. Only explicit labeled facts
        are extracted, not verified or inferred. Review every field before
        saving. External discovery and provider URL imports are not available
        yet.
      </p>
      <Link
        href="/jobs"
        className="rounded font-semibold text-indigo-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        Browse saved jobs
      </Link>
      {!draft && !savedId && (
        <form
          onSubmit={normalize}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <label className="block text-sm font-medium">
            Pasted job description
            <textarea
              ref={textInput}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={100000}
              rows={12}
              disabled={busy !== null}
              className={inputClass}
            />
          </label>
          <p className="text-sm leading-6 text-slate-600">
            Up to 100,000 characters. Supported single-line labels: Company /
            Company name, Title / Job title, Job ID / Requisition ID, Location,
            Technologies / Required technologies, Experience requirements,
            Seniority, Department / Team. Use a colon after the label.
            Technology lists use commas or semicolons. Unlabeled or conflicting
            facts stay unavailable. URLs are never fetched.
          </p>
          <button
            className={buttonClass}
            type="submit"
            disabled={busy !== null}
          >
            {busy === "parse" ? "Normalizing..." : "Normalize description"}
          </button>
        </form>
      )}
      {draft && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
          <h2
            ref={preview}
            tabIndex={-1}
            className="text-xl font-semibold outline-none"
          >
            Review normalized job
          </h2>
          <p className="text-sm text-slate-600">
            Nothing is saved until you select Save reviewed job. Blank fields
            represent Not available. Extracted text is user-supplied, not
            verified. The complete description is retained below.
          </p>
          {draft.warnings.length > 0 && (
            <div
              role="status"
              className="rounded-lg bg-amber-50 p-4 text-amber-900"
            >
              <p className="font-semibold">Review needed</p>
              <ul className="list-inside list-disc">
                {draft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <form onSubmit={save} className="space-y-4">
            <fieldset
              disabled={busy !== null || !!savedId}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {draftFields.map(([field, label]) => (
                  <label key={field} className="block text-sm font-medium">
                    {label}
                    <input
                      name={field}
                      defaultValue={draft[field] ?? ""}
                      placeholder="Not available"
                      maxLength={1000}
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>
              <label className="block text-sm font-medium">
                Technologies (one per line)
                <textarea
                  name="technologies"
                  defaultValue={draft.technologies?.join("\n") ?? ""}
                  placeholder="Not available"
                  rows={3}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium">
                Experience requirements
                <textarea
                  name="experience_requirements"
                  defaultValue={draft.experience_requirements ?? ""}
                  placeholder="Not available"
                  maxLength={100000}
                  rows={3}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium">
                Source URL
                <input
                  type="url"
                  name="source_url"
                  defaultValue={draft.source_url ?? ""}
                  placeholder="Not available"
                  maxLength={2048}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium">
                Normalized description
                <textarea
                  name="description"
                  defaultValue={draft.description}
                  required
                  maxLength={100000}
                  rows={12}
                  className={inputClass}
                />
              </label>
              <button className={buttonClass} type="submit">
                {busy === "save" ? "Saving..." : "Save reviewed job"}
              </button>
            </fieldset>
          </form>
          {!savedId && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => {
                setDraft(null);
                setError("");
                requestAnimationFrame(() => textInput.current?.focus());
              }}
            >
              Back to pasted text (discard preview edits)
            </button>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {savedId && (
        <div
          role="status"
          className="space-y-3 rounded-xl bg-green-50 p-5 text-green-900"
        >
          <p>Reviewed job saved as Interested.</p>
          <Link
            href={`/jobs/${encodeURIComponent(savedId)}`}
            className="font-semibold underline"
          >
            View saved job
          </Link>
          <button
            type="button"
            className={`${buttonClass} ml-4`}
            onClick={() => {
              setDraft(null);
              setSavedId("");
              setText("");
              setError("");
              requestAnimationFrame(() => textInput.current?.focus());
            }}
          >
            Import another description
          </button>
        </div>
      )}
    </div>
  );
}
