import { isJobDetail, isSavedJob } from "@/lib/jobs";

function failure(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function forwardJobRequest(request: Request, path = "/api/jobs") {
  const detail = path !== "/api/jobs";
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
      detail
        ? "Job service could not be reached. Reload the job before retrying a status update; it may have completed."
        : "Job service could not be reached. If saving, check the list before resubmitting; the save may have completed.",
    );
  }
  if (!response.ok) {
    console.error("Job API returned an error", response.status);
    if (detail && response.status === 404)
      return failure(
        404,
        "Saved job or application tracking record not found.",
      );
    if (response.status === 422)
      return failure(
        422,
        detail
          ? "Check the job ID and select a documented application status."
          : "Check the job fields or filters. Provide a description or an HTTP(S) URL without credentials.",
      );
    return failure(
      503,
      detail
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
      detail
        ? "Job service returned an invalid response. Reload the job before retrying a status update."
        : "Job service returned an invalid response. If saving, check the list before resubmitting.",
    );
  }
  const valid = detail
    ? isJobDetail(data)
    : request.method === "GET"
      ? Array.isArray(data) && data.every(isSavedJob)
      : isSavedJob(data);
  if (!valid) {
    console.error("Job API returned an unexpected response shape");
    return failure(
      502,
      detail
        ? "Job service returned an invalid response. Reload the job before retrying a status update."
        : "Job service returned an invalid response. If saving, check the list before resubmitting.",
    );
  }
  return Response.json(data, {
    status: request.method === "POST" ? 201 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
