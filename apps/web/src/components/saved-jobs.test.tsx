import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobsPage from "@/app/jobs/page";

const job = {
  id: "job-1",
  title: "User entered role",
  company: "User company",
  location: null,
  description: "Actual description",
  application: { status: "interested" },
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

async function renderJobs() {
  render(<JobsPage />);
  await waitFor(() =>
    expect(screen.queryByText("Loading jobs...")).not.toBeInTheDocument(),
  );
}

describe("saved job workflow", () => {
  it("shows loading, then an honest empty state", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    render(<JobsPage />);
    expect(screen.getByText("Loading jobs...")).toBeInTheDocument();
    resolve(Response.json([]));
    await screen.findByText("No saved jobs yet. Save your first job above.");
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("renders real data safely, keeps nulls honest, and does not offer status edits or detail links", async () => {
    fetchMock.mockResolvedValue(
      Response.json([
        {
          ...job,
          title: "<script>not executed</script>",
          company: null,
          application: null,
        },
      ]),
    );
    await renderJobs();
    expect(
      screen.getByRole("heading", { name: "<script>not executed</script>" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Company not available/)).toBeInTheDocument();
    expect(screen.getByText("Tracking not available")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
  });

  it("reports unavailable service without an empty-success fallback and supports retry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { message: "Job service is unavailable." },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json([job]));
    await renderJobs();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Job service is unavailable.",
    );
    expect(screen.queryByText(/No saved jobs yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading jobs" }));
    await screen.findByRole("heading", { name: job.title });
  });

  it.each([null, {}, [{ ...job, application: { status: "invalid" } }]])(
    "reports malformed list payloads",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      await renderJobs();
      expect(screen.getByRole("alert")).toHaveTextContent("invalid job list");
    },
  );

  it("encodes combined filters, paginates by 20, and resets offset on clear", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        Array.from({ length: 20 }, (_, index) => ({
          ...job,
          id: String(index),
        })),
      ),
    );
    await renderJobs();
    fireEvent.change(screen.getByLabelText("Search jobs"), {
      target: { value: "  100% & role  " },
    });
    fireEvent.change(screen.getByLabelText("Company (exact match)"), {
      target: { value: "  User company  " },
    });
    fireEvent.change(screen.getByLabelText("Application status"), {
      target: { value: "applied" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/jobs?limit=20&offset=0&q=100%25+%26+role&company=User+company&status=applied",
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("offset=20"),
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        expect.stringContaining("offset=0"),
        expect.any(Object),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/jobs?limit=20&offset=0",
        expect.any(Object),
      ),
    );
    expect(screen.getByLabelText("Search jobs")).toHaveValue("");
    expect(screen.getByLabelText("Application status")).toHaveValue("");
  });

  it("ignores an older request that finishes after new filters", async () => {
    let old!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          old = resolve;
        }),
      )
      .mockResolvedValueOnce(Response.json([job]));
    render(<JobsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await screen.findByRole("heading", { name: job.title });
    await act(async () => old(Response.json([])));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("heading", { name: job.title }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("requires description or URL and rejects unsafe URL schemes or credentials without a POST", async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    await renderJobs();
    const form = screen
      .getByRole("button", { name: "Save job" })
      .closest("form")!;
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provide a job description or source URL.",
    );
    for (const value of [
      "ftp://example.com",
      "https://user:pass@example.com",
    ]) {
      fireEvent.change(screen.getByLabelText("Source URL"), {
        target: { value },
      });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("HTTP(S)");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves trimmed optional fields atomically, disables duplicate submissions, clears filters and reloads", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? new Promise<Response>((resolve) => {
            complete = resolve;
          })
        : Response.json([job]),
    );
    await renderJobs();
    fireEvent.change(screen.getByLabelText("Search jobs"), {
      target: { value: "old" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "  User entered role  " },
    });
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "  Actual description  " },
    });
    const form = screen
      .getByRole("button", { name: "Save job" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    const posts = fetchMock.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toEqual({
      title: job.title,
      description: job.description,
    });
    complete(Response.json(job, { status: 201 }));
    await screen.findByText(/Job saved. Filters cleared/);
    expect(screen.getByLabelText("Job description")).toHaveValue("");
    expect(screen.getByLabelText("Search jobs")).toHaveValue("");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/jobs?limit=20&offset=0",
        expect.any(Object),
      ),
    );
  });

  it("allows URL-only jobs and retains input on a failed save", async () => {
    fetchMock.mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? Response.json(
            { message: "Job service is unavailable." },
            { status: 503 },
          )
        : Response.json([]),
    );
    await renderJobs();
    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.com/job/1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Your input has been kept",
      ),
    );
    expect(screen.getByLabelText("Source URL")).toHaveValue(
      "https://example.com/job/1",
    );
    expect(screen.getByRole("button", { name: "Save job" })).toBeEnabled();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    expect(screen.queryByText(/Job saved/)).not.toBeInTheDocument();
  });

  it("handles an empty page after an exactly full last page without inventing totals", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          Array.from({ length: 20 }, (_, index) => ({
            ...job,
            id: String(index),
          })),
        ),
      )
      .mockResolvedValueOnce(Response.json([]));
    await renderJobs();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("No more jobs on this page.");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("distinguishes an acknowledged save from a subsequent list reload failure", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(job, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          { message: "List temporarily unavailable" },
          { status: 503 },
        ),
      );
    await renderJobs();
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "Actual description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await screen.findByText(
      "Job saved. Filters cleared to show the newest jobs.",
    );
    await screen.findByText("List temporarily unavailable");
    expect(screen.getByLabelText("Job description")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Retry loading jobs" }),
    ).toBeEnabled();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
  });
  it("exposes all seven documented statuses for filtering, not editing", async () => {
    fetchMock.mockResolvedValue(Response.json([]));
    await renderJobs();
    expect(
      within(screen.getByLabelText("Application status")).getAllByRole(
        "option",
      ),
    ).toHaveLength(8);
  });
});
