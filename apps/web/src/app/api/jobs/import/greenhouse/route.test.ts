// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const source = "https://my.greenhouse.io/jobs/fixture/123";
const draft = {
  title: "Fixture role",
  company: null,
  requisition_id: null,
  location: null,
  seniority: null,
  department: null,
  description: "Provider description",
  technologies: null,
  experience_requirements: null,
  source_url: source,
  warnings: ["Review before saving."],
};
const fetchMock = vi.fn<typeof fetch>();
function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/jobs/import/greenhouse", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ source_url: source }),
  });
}
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

describe("Greenhouse import boundary", () => {
  it("forwards to fixed API import route, returns draft 200 and never saves", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8000/api/jobs/import/greenhouse",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ source_url: source }),
      redirect: "error",
      cache: "no-store",
    });
  });
  it.each([404, 422, 502, 503, 504])(
    "preserves explicit failure %i without exposing upstream details",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ detail: "private provider details" }, { status }),
      );
      const response = await POST(request());
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text.toLowerCase()).toContain("greenhouse");
      expect(text).not.toContain("private provider");
      expect(text).not.toContain("may have completed");
    },
  );
  it.each([{}, { ...draft, warnings: null }])(
    "rejects invalid draft response",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(await response.text()).toContain("Nothing has been saved");
    },
  );
  it("reports connection failures without implying a write", async () => {
    fetchMock.mockRejectedValue(new TypeError("private network detail"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Your text has not been saved");
  });
  it("rejects cross-origin requests before forwarding", async () => {
    const response = await POST(request("https://other.test"));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
