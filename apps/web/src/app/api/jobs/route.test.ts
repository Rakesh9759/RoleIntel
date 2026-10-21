// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const job = {
  id: "job-1",
  title: null,
  company: null,
  location: null,
  description: "Actual input",
  application: { status: "interested" },
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("ROLEINTEL_API_URL", "http://127.0.0.1:8000");
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

function submission(
  body = JSON.stringify({ description: "Actual input" }),
  headers: Record<string, string> = {},
) {
  return new Request("http://localhost:3000/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost:3000",
      ...headers,
    },
    body,
  });
}

describe("same-origin job API boundary", () => {
  it("forwards the exact query without cookies, credentials, caching or redirects", async () => {
    fetchMock.mockResolvedValue(Response.json([job]));
    const response = await GET(
      new Request(
        "http://localhost:3000/api/jobs?q=100%25&limit=20&offset=20&company=Acme&status=applied",
        { headers: { cookie: "private=value" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([job]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "http://127.0.0.1:8000/api/jobs?q=100%25&limit=20&offset=20&company=Acme&status=applied",
    );
    expect(options).toMatchObject({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
    });
    expect(options?.headers).not.toHaveProperty("cookie");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards JSON submission and returns a created job", async () => {
    fetchMock.mockResolvedValue(Response.json(job, { status: 201 }));
    const response = await POST(submission());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(job);
    expect(fetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ description: "Actual input" }),
    );
  });

  it("uses the browser Host when Next normalizes a loopback request URL", async () => {
    fetchMock.mockResolvedValue(Response.json(job, { status: 201 }));
    const request = submission(undefined, {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    });
    expect((await POST(request)).status).toBe(201);
  });

  it.each([
    "",
    "invalid",
    "ftp://example.com",
    "http://user:password@example.com",
    "http://example.com/path",
    "http://example.com/?secret=key",
  ])(
    "rejects invalid server configuration %s without leaking it",
    async (origin) => {
      vi.stubEnv("ROLEINTEL_API_URL", origin);
      const response = await GET(new Request("http://localhost:3000/api/jobs"));
      expect(response.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        "Job API configuration is missing or invalid",
      );
    },
  );

  it.each([
    ["bad JSON", "{", {}, 400],
    ["non-JSON", "description=input", { "Content-Type": "text/plain" }, 415],
    ["cross-origin", "{}", { origin: "https://other.example" }, 403],
    ["oversized", JSON.stringify({ description: "x".repeat(512001) }), {}, 413],
  ] as const)("rejects %s locally", async (_name, body, headers, status) => {
    const response = await POST(submission(body, headers));
    expect(response.status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([422, 500, 503])(
    "redacts upstream %i error payloads",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ detail: "sensitive submitted content" }, { status }),
      );
      const response = await POST(submission());
      expect(response.status).toBe(status === 422 ? 422 : 503);
      expect(await response.text()).not.toContain(
        "sensitive submitted content",
      );
      expect(console.error).toHaveBeenCalledWith(
        "Job API returned an error",
        status,
      );
    },
  );

  it.each([
    new TypeError("private URL"),
    new DOMException("Timeout", "TimeoutError"),
  ])(
    "reports network and timeout failures without leaking details",
    async (error) => {
      fetchMock.mockRejectedValue(error);
      const response = await POST(submission());
      expect(response.status).toBe(503);
      expect(await response.text()).toContain(
        "check the list before resubmitting",
      );
      expect(console.error).toHaveBeenCalledWith(
        "Job API request failed or timed out",
      );
    },
  );

  it.each([{}, [null], [{ ...job, application: { status: "made_up" } }]])(
    "rejects malformed successful list payloads",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      expect(
        (await GET(new Request("http://localhost:3000/api/jobs"))).status,
      ).toBe(502);
    },
  );

  it("rejects non-JSON successes and malformed creation responses", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("<html>private</html>"))
      .mockResolvedValueOnce(Response.json([]));
    expect(
      (await GET(new Request("http://localhost:3000/api/jobs"))).status,
    ).toBe(502);
    expect((await POST(submission())).status).toBe(502);
  });

  it("accepts an empty list and missing tracking without invented data", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ ...job, application: null }]));
    expect(
      await (await GET(new Request("http://localhost:3000/api/jobs"))).json(),
    ).toEqual([]);
    expect(
      await (await GET(new Request("http://localhost:3000/api/jobs"))).json(),
    ).toEqual([{ ...job, application: null }]);
  });
});
