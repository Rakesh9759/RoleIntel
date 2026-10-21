// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as lever } from "./lever/route";
import { POST as ashby } from "./ashby/route";

const id = "11111111-2222-3333-4444-555555555555";
const draft = {
  title: "Fixture role",
  company: null,
  requisition_id: null,
  location: "Remote",
  seniority: null,
  department: null,
  description: "Complete description",
  technologies: null,
  experience_requirements: null,
  source_url: null,
  warnings: [],
};
const fetchMock = vi.fn<typeof fetch>();
function request(provider: string, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/jobs/import/${provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({
      source_url: `https://jobs.${provider === "lever" ? "lever.co" : "ashbyhq.com"}/fixture/${id}`,
    }),
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
describe.each([
  ["lever", lever],
  ["ashby", ashby],
] as const)("%s import boundary", (provider, post) => {
  it("returns draft 200 from a fixed import path, never a created record", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    const response = await post(request(provider));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(draft);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://127.0.0.1:8000/api/jobs/import/${provider}`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
    });
  });
  it.each([404, 422, 502, 503, 504])(
    "preserves explicit redacted error %i",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ detail: "private content" }, { status }),
      );
      const response = await post(request(provider));
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text.toLowerCase()).toContain(provider);
      expect(text).not.toContain("private");
      expect(text).not.toContain("may have completed");
    },
  );
  it("rejects invalid payloads from upstream and connection failures", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}));
    expect((await post(request(provider))).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new TypeError("private connection"));
    const response = await post(request(provider));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("has not been saved");
  });
  it("rejects cross-origin writes", async () => {
    expect((await post(request(provider, "https://evil.test"))).status).toBe(
      403,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
