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
import { JobDetails } from "./job-details";
import { applicationStatuses } from "@/lib/jobs";

const id = "00000000-0000-0000-0000-000000000001";
const timestamp = "2026-01-01T00:00:00Z";
const job = {
  id,
  title: "Supplied role",
  company: "Supplied company",
  location: "Remote",
  description: "Actual supplied description",
  requisition_id: "REQ-42",
  technologies: ["Python", "PostgreSQL"],
  experience_requirements: "Actual experience requirements",
  seniority: "Senior",
  department: "Engineering",
  source_url: "https://example.com/job/42",
  created_at: timestamp,
  updated_at: timestamp,
  application: {
    id: "00000000-0000-0000-0000-000000000002",
    job_id: id,
    status: "interested",
    created_at: timestamp,
    updated_at: timestamp,
  },
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
async function renderDetails() {
  render(<JobDetails id={id} />);
  await waitFor(() =>
    expect(screen.queryByText("Loading job...")).not.toBeInTheDocument(),
  );
}

describe("job details and status controls", () => {
  it("shows all persisted fields, safe source and tracking metadata", async () => {
    fetchMock.mockResolvedValue(Response.json(job));
    await renderDetails();
    for (const value of [
      "Supplied role",
      "Supplied company",
      "Remote",
      "REQ-42",
      "Python, PostgreSQL",
      "Actual experience requirements",
      "Senior",
      "Engineering",
      id,
      job.application.id,
      job.description,
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(screen.getAllByText(timestamp)).toHaveLength(4);
    expect(
      screen.getByRole("link", { name: /opens in new tab/ }),
    ).toHaveAttribute("href", job.source_url);
    expect(
      screen.getByRole("link", { name: /opens in new tab/ }),
    ).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByRole("link", { name: "Back to saved jobs" }),
    ).toHaveAttribute("href", "/jobs");
    expect(
      within(screen.getByLabelText("Application status")).getAllByRole(
        "option",
      ),
    ).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Save status" })).toBeDisabled();
  });
  it("shows loading before the read resolves", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    render(<JobDetails id={id} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading job");
    await act(async () => resolve(Response.json(job)));
    expect(
      screen.getByRole("heading", { name: job.title }),
    ).toBeInTheDocument();
  });
  it.each([
    null,
    "javascript:alert(1)",
    "https://user:password@example.com",
    "not a url",
  ])(
    "handles missing or unsafe source URL %s without a dangerous link",
    async (source_url) => {
      fetchMock.mockResolvedValue(
        Response.json({
          ...job,
          source_url,
          title: null,
          company: null,
          description: null,
          technologies: [],
          application: null,
        }),
      );
      await renderDetails();
      expect(
        screen.getByRole("heading", { name: "Title not available" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /opens in new tab/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Application tracking is not available/),
      ).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("renders user-supplied markup as inert text", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...job, description: "<img src=x onerror=alert(1)>" }),
    );
    await renderDetails();
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("shows missing jobs distinctly without a misleading retry", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "Not found" }, { status: 404 }),
    );
    await renderDetails();
    expect(screen.getByRole("alert")).toHaveTextContent("Saved job not found.");
    expect(
      screen.queryByRole("button", { name: "Retry loading job" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("rejects malformed IDs without an API request", async () => {
    render(<JobDetails id="not-a-uuid" />);
    await screen.findByText("Invalid job ID.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries service failures without claiming a job is missing", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ message: "Job service unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json(job));
    await renderDetails();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Job service unavailable",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry loading job" }));
    await screen.findByRole("heading", { name: job.title });
  });
  it.each([
    {},
    { ...job, id: job.application.id },
    { ...job, technologies: [12] },
  ])("reports invalid or mismatched detail responses", async (payload) => {
    fetchMock.mockResolvedValue(Response.json(payload));
    await renderDetails();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it.each(applicationStatuses)(
    "saves %s only on explicit submission and confirms the returned status",
    async (status, label) => {
      fetchMock
        .mockResolvedValueOnce(
          Response.json({
            ...job,
            application: {
              ...job.application,
              status: status === "interested" ? "rejected" : "interested",
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            ...job,
            application: { ...job.application, status },
          }),
        );
      await renderDetails();
      fireEvent.change(screen.getByLabelText("Application status"), {
        target: { value: status },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Save status" }));
      await screen.findByText("Application status saved.");
      expect(fetchMock.mock.calls[1]).toEqual([
        `/api/jobs/${id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      ]);
      expect(screen.getByText("Current saved status:")).toHaveTextContent(
        label,
      );
      expect(
        screen.getByRole("button", { name: "Save status" }),
      ).toBeDisabled();
    },
  );
  it("prevents duplicate saves and preserves the confirmed status while saving", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(Response.json(job)).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    await renderDetails();
    fireEvent.change(screen.getByLabelText("Application status"), {
      target: { value: "applied" },
    });
    const form = screen
      .getByRole("button", { name: "Save status" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Saving status..." }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Application status")).toBeDisabled();
    expect(screen.getByText("Current saved status:")).toHaveTextContent(
      "Interested",
    );
    await act(async () =>
      complete(
        Response.json({
          ...job,
          application: { ...job.application, status: "applied" },
        }),
      ),
    );
    expect(screen.getByText("Application status saved.")).toBeInTheDocument();
  });
  it.each([404, 422, 503])(
    "preserves selection and confirmed state on PATCH %i",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(Response.json(job))
        .mockResolvedValueOnce(
          Response.json({ message: "Status could not be saved" }, { status }),
        );
      await renderDetails();
      fireEvent.change(screen.getByLabelText("Application status"), {
        target: { value: "offer" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save status" }));
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Application status")).toHaveValue("offer");
      expect(screen.getByText("Current saved status:")).toHaveTextContent(
        "Interested",
      );
      expect(
        screen.queryByText("Application status saved."),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save status" })).toBeEnabled();
    },
  );
  it("does not report success for a mismatched status acknowledgement", async () => {
    fetchMock.mockImplementation(async () => Response.json(job));
    await renderDetails();
    fireEvent.change(screen.getByLabelText("Application status"), {
      target: { value: "offer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByText(/did not confirm the requested status/);
    expect(
      screen.queryByText("Application status saved."),
    ).not.toBeInTheDocument();
  });

  it("preserves selection after a network failure and never retries a write automatically", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(job))
      .mockRejectedValueOnce(new TypeError("Network unavailable"));
    await renderDetails();
    fireEvent.change(screen.getByLabelText("Application status"), {
      target: { value: "offer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save status" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Application status")).toHaveValue("offer");
    expect(screen.getByText("Current saved status:")).toHaveTextContent(
      "Interested",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Reload the page");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
