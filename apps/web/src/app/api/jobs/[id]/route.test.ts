// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { PATCH } from "./status/route";

const id = "00000000-0000-0000-0000-000000000001";
const trackingId = "00000000-0000-0000-0000-000000000002";
const timestamp = "2026-01-01T00:00:00Z";
const job = {
  id,
  title: null,
  company: null,
  location: null,
  description: "Supplied description",
  requisition_id: null,
  technologies: null,
  experience_requirements: null,
  seniority: null,
  department: null,
  source_url: null,
  created_at: timestamp,
  updated_at: timestamp,
  application: {
    id: trackingId,
    job_id: id,
    status: "applied",
    created_at: timestamp,
    updated_at: timestamp,
  },
};
const context = { params: Promise.resolve({ id }) };
const fetchMock = vi.fn<typeof fetch>();
const request = (method = "GET", body?: string) =>
  new Request(
    `http://localhost:3000/api/jobs/${id}${method === "PATCH" ? "/status" : ""}`,
    {
      method,
      ...(body === undefined ? {} : { body }),
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
    },
  );

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

describe("detail and status boundary", () => {
  it("forwards a direct detail request with no caching and validates the full response", async () => {
    fetchMock.mockResolvedValue(Response.json(job));
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(job);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:8000/api/jobs/${id}`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      cache: "no-store",
    });
  });
  it("forwards only the explicit status JSON to the status endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json(job));
    const response = await PATCH(
      request("PATCH", JSON.stringify({ status: "applied" })),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(job);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:8000/api/jobs/${id}/status`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: '{"status":"applied"}',
      redirect: "error",
    });
  });
  it.each(["../jobs", "not-a-uuid", id + "/status", "%2f"])(
    "rejects invalid IDs %s without contacting upstream",
    async (invalid) => {
      const ctx = { params: Promise.resolve({ id: invalid }) };
      expect((await GET(request(), ctx)).status).toBe(422);
      expect((await PATCH(request("PATCH", "{}"), ctx)).status).toBe(422);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(["GET", "PATCH"])(
    "preserves structured 404 for %s without leaking upstream content",
    async (method) => {
      fetchMock.mockResolvedValue(
        Response.json({ detail: "private" }, { status: 404 }),
      );
      const response =
        method === "GET"
          ? await GET(request(), context)
          : await PATCH(request("PATCH", "{}"), context);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("private");
    },
  );
  it("does not silently repair missing tracking", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...job, application: null }));
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ ...job, application: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...job, created_at: "not a date" },
    { ...job, technologies: [42] },
    { ...job, application: { ...job.application, job_id: trackingId } },
    { ...job, application: { ...job.application, updated_at: null } },
    { ...job, department: 123 },
    {
      id,
      title: null,
      company: null,
      location: null,
      description: null,
      application: null,
    },
  ])("rejects malformed detailed responses", async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    expect((await GET(request(), context)).status).toBe(502);
  });
  it("retains origin and JSON checks for status mutations", async () => {
    const crossOrigin = new Request(
      `http://localhost:3000/api/jobs/${id}/status`,
      {
        method: "PATCH",
        headers: {
          origin: "https://other.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    expect((await PATCH(crossOrigin, context)).status).toBe(403);
    expect((await PATCH(request("PATCH", "{"), context)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
