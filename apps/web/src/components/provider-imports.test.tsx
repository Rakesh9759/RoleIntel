import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";

const id = "11111111-2222-3333-4444-555555555555";
const draft = {
  title: "Provider role",
  company: null,
  requisition_id: null,
  location: "Remote",
  seniority: null,
  department: null,
  description: "Complete description\n\nNext paragraph.",
  technologies: null,
  experience_requirements: null,
  source_url: null,
  warnings: ["Review supplied fields before saving."],
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
describe.each([
  ["lever", "Lever", "jobs.lever.co"],
  ["ashby", "Ashby", "jobs.ashbyhq.com"],
] as const)("%s import workflow", (provider, name, host) => {
  const url = `https://${host}/fixture/${id}`;
  function select() {
    fireEvent.change(screen.getByRole("combobox", { name: "Job provider" }), {
      target: { value: provider },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: `${name} posting URL` }),
      { target: { value: url } },
    );
  }
  async function preview() {
    render(<SearchPage />);
    select();
    fireEvent.click(screen.getByRole("button", { name: `Import ${name} job` }));
    await screen.findByRole("heading", { name: "Review normalized job" });
  }
  it("requests only selected provider and shows editable supplied facts without autosave", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...draft, source_url: url }));
    await preview();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/jobs/import/${provider}`);
    expect(screen.getByLabelText("Company")).toHaveValue("");
    expect(screen.getByLabelText("Source URL")).toHaveValue(url);
    expect(screen.getByLabelText("Normalized description")).toHaveValue(
      draft.description,
    );
    expect(screen.getByLabelText("Title")).toHaveValue(draft.title);
  });
  it("retains provider and URL on error and offers manual fallback", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: "Provider unavailable" }, { status: 503 }),
    );
    render(<SearchPage />);
    select();
    fireEvent.click(screen.getByRole("button", { name: `Import ${name} job` }));
    await screen.findByRole("alert");
    expect(screen.getByRole("combobox", { name: "Job provider" })).toHaveValue(
      provider,
    );
    expect(screen.getByLabelText(`${name} posting URL`)).toHaveValue(url);
    expect(screen.getByLabelText("Pasted job description")).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nothing has been saved",
    );
  });
  it("locks provider changes and duplicate requests while pending", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    render(<SearchPage />);
    select();
    const form = screen
      .getByRole("button", { name: `Import ${name} job` })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("combobox", { name: "Job provider" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Normalize description" }),
    ).toBeDisabled();
    await act(async () =>
      complete(Response.json({ ...draft, source_url: url })),
    );
  });
  it("saves only after review and keeps edits on failed save", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ ...draft, source_url: url }))
      .mockResolvedValueOnce(
        Response.json({ message: "Database unavailable" }, { status: 503 }),
      );
    await preview();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Reviewed company" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed job" }));
    await screen.findByRole("alert");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      company: "Reviewed company",
      source_url: url,
      description: draft.description,
    });
    expect(screen.getByLabelText("Company")).toHaveValue("Reviewed company");
    expect(
      screen.queryByText("Reviewed job saved as Interested."),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Back to posting URL (discard preview edits)",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Job provider" })).toHaveValue(
      provider,
    );
    expect(screen.getByLabelText(`${name} posting URL`)).toHaveValue(url);
  });
});
