import { isJobDetail, isSavedJob } from "@/lib/jobs";
import { isJobDraft } from "@/lib/job-draft";

function failure(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function forwardJobRequest(request: Request, path = "/api/jobs") {
  const parsing = path === "/api/jobs/parse";
  const importProvider = {
    "/api/jobs/import/greenhouse": "Greenhouse",
    "/api/jobs/import/lever": "Lever",
    "/api/jobs/import/ashby": "Ashby",
  }[path];
  const importing = importProvider !== undefined;
  const preview = parsing || importing;
  const previewService = importing
    ? `${importProvider} import`
    : "Description normalization";
  const detail = path !== "/api/jobs" && !preview;
  let base: URL;
  try {
    base = new URL(process.env.ROLEINTEL_API_URL ?? "");
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    ) {
      throw new Error("Invalid API origin");
    }
  } catch {
    console.error("Job API configuration is missing or invalid");
    return failure(
      503,
      "Job service is not configured. Set ROLEINTEL_API_URL on the web server.",
    );
  }

  let body: string | undefined;
  if (request.method === "POST" || request.method === "PATCH") {
    const origin = request.headers.get("origin");
    // Next.js may normalize the request URL's loopback hostname.
    const expectedOrigin = new URL(request.url);
    expectedOrigin.host = request.headers.get("host") ?? expectedOrigin.host;
    if (origin && origin !== expectedOrigin.origin) {
      return failure(403, "Cross-origin submissions are not allowed.");
    }
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    ) {
      return failure(415, "Submit a JSON job.");
    }
    body = await request.text();
    if (body.length > 512_000)
      return failure(413, "Job submission is too large.");
    try {
      JSON.parse(body);
    } catch {
      return failure(400, "Job submission must be valid JSON.");
    }
  }

  const url = new URL(path, base);
  url.search = new URL(request.url).search;
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("Job API request failed or timed out");
    return failure(
      503,
      preview
        ? `${previewService} service could not be reached. Your text has not been saved.`
        : detail
          ? "Job service could not be reached. Reload the job before retrying a status update; it may have completed."
          : "Job service could not be reached. If saving, check the list before resubmitting; the save may have completed.",
    );
  }
  if (!response.ok) {
    console.error("Job API returned an error", response.status);
    if (importing) {
      const messages: Record<number, string> = {
        404: `${importProvider} posting was not found, is closed or unlisted. Check the URL or paste the description manually.`,
        422:
          importProvider === "Greenhouse"
            ? "Use an HTTPS boards.greenhouse.io or job-boards.greenhouse.io URL with /company/jobs/123, or my.greenhouse.io with /jobs/company/123."
            : importProvider === "Lever"
              ? "Use an HTTPS jobs.lever.co or jobs.eu.lever.co URL with /company/posting-uuid."
              : "Use an HTTPS jobs.ashbyhq.com URL with /company/posting-uuid.",
        502: `${importProvider} returned an unusable or oversized posting/board. Paste the description manually instead.`,
        503: `${importProvider} import is unavailable or rate limited. Try again later or paste manually.`,
        504: `${importProvider} request timed out. Try again or paste the description manually.`,
      };
      return failure(
        response.status in messages ? response.status : 503,
        messages[response.status] ??
          `${importProvider} import failed. Try again or paste manually.`,
      );
    }
    if (detail && response.status === 404)
      return failure(
        404,
        "Saved job or application tracking record not found.",
      );
    if (response.status === 422)
      return failure(
        422,
        parsing
          ? "Provide a nonblank plain-text description, at most 100,000 characters, without control characters."
          : detail
            ? "Check the job ID and select a documented application status."
            : "Check the job fields or filters. Provide a description or an HTTP(S) URL without credentials.",
      );
    return failure(
      503,
      parsing
        ? "Description normalization service is unavailable. Your text has not been saved."
        : detail
          ? "Job service is unavailable. Check the API and database; reload the job before retrying a status update."
          : "Job service is unavailable. Check the API and database. If saving, check the list before resubmitting.",
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    console.error("Job API returned invalid JSON");
    return failure(
      502,
      preview
        ? `${previewService} service returned an invalid preview. Nothing has been saved.`
        : detail
          ? "Job service returned an invalid response. Reload the job before retrying a status update."
          : "Job service returned an invalid response. If saving, check the list before resubmitting.",
    );
  }
  const valid = preview
    ? isJobDraft(data)
    : detail
      ? isJobDetail(data)
      : request.method === "GET"
        ? Array.isArray(data) && data.every(isSavedJob)
        : isSavedJob(data);
  if (!valid) {
    console.error("Job API returned an unexpected response shape");
    return failure(
      502,
      preview
        ? `${previewService} service returned an invalid preview. Nothing has been saved.`
        : detail
          ? "Job service returned an invalid response. Reload the job before retrying a status update."
          : "Job service returned an invalid response. If saving, check the list before resubmitting.",
    );
  }
  return Response.json(data, {
    status: request.method === "POST" && !preview ? 201 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
