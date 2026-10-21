// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const draft = {
  title: null,
  company: "Supplied",
  requisition_id: null,
  location: null,
  seniority: null,
  department: null,
  description: "Company: Supplied",
  technologies: null,
  experience_requirements: null,
  source_url: null,
  warnings: [],
};
const fetchMock = vi.fn<typeof fetch>();
const request = () =>
  new Request("http://localhost:3000/api/jobs/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ description: "Company: Supplied" }),
  });
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

describe("description preview boundary", () => {
  it("forwards only to parse and returns 200, not a created job", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8000/api/jobs/parse",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: '{"description":"Company: Supplied"}',
      cache: "no-store",
      redirect: "error",
    });
  });
  it.each([
    {},
    { ...draft, warnings: null },
    { ...draft, technologies: [12] },
    { ...draft, title: 12 },
    { ...draft, description: "" },
  ])("rejects invalid preview shapes", async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Nothing has been saved");
  });
  it.each([422, 503])(
    "reports parse %i without exposing upstream text",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ detail: "private description" }, { status }),
      );
      const response = await POST(request());
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain("private description");
    },
  );
  it("reports network failure as normalization failure, not an uncertain write", async () => {
    fetchMock.mockRejectedValue(new TypeError("private backend"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Your text has not been saved");
  });
  it("preserves cross-origin rejection", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/jobs/parse", {
        method: "POST",
        headers: {
          origin: "https://other.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
