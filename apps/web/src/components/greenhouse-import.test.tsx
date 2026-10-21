import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";

const source = "https://my.greenhouse.io/jobs/fixture/123";
const draft = {
  title: "Provider title",
  company: null,
  requisition_id: null,
  location: "Remote",
  seniority: null,
  department: null,
  description: "Provider description\n\nSecond paragraph.",
  technologies: null,
  experience_requirements: null,
  source_url: source,
  warnings: ["Imported from Greenhouse. Review before saving."],
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
function enterUrl() {
  fireEvent.change(screen.getByLabelText("Greenhouse posting URL"), {
    target: { value: source },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Import Greenhouse job" }),
  );
}
async function preview() {
  render(<SearchPage />);
  enterUrl();
  await screen.findByRole("heading", { name: "Review normalized job" });
}

describe("Greenhouse posting import", () => {
  it("keeps reviewed import edits on save failure and allows explicit import retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Connection failed"))
      .mockResolvedValueOnce(Response.json(draft))
      .mockResolvedValueOnce(
        Response.json({ message: "Database unavailable" }, { status: 503 }),
      );
    render(<SearchPage />);
    enterUrl();
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Import Greenhouse job" }),
    );
    await screen.findByRole("heading", { name: "Review normalized job" });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Reviewed company" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed job" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Company")).toHaveValue("Reviewed company");
    expect(
      screen.queryByText("Reviewed job saved as Interested."),
    ).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does nothing on mount and requires a URL", () => {
    render(<SearchPage />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Import Greenhouse job" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a Greenhouse posting URL",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("imports an editable preview with unknown fields blank and no automatic save", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    await preview();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/jobs/import/greenhouse");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      source_url: source,
    });
    expect(screen.getByLabelText("Title")).toHaveValue("Provider title");
    expect(screen.getByLabelText("Company")).toHaveValue("");
    expect(screen.getByLabelText("Technologies (one per line)")).toHaveValue(
      "",
    );
    expect(screen.getByLabelText("Source URL")).toHaveValue(source);
    expect(screen.getByLabelText("Normalized description")).toHaveValue(
      draft.description,
    );
    expect(screen.getByText(draft.warnings[0])).toBeInTheDocument();
  });
  it("prevents duplicate imports and disables both input methods while pending", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    render(<SearchPage />);
    const form = screen
      .getByRole("button", { name: "Import Greenhouse job" })
      .closest("form")!;
    fireEvent.change(screen.getByLabelText("Greenhouse posting URL"), {
      target: { value: source },
    });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Importing..." })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Normalize description" }),
    ).toBeDisabled();
    await act(async () => complete(Response.json(draft)));
  });
  it.each([404, 422, 503, 504])(
    "keeps URL and manual fallback after failure %i",
    async (status) => {
      fetchMock.mockResolvedValue(
        Response.json({ message: "Greenhouse import failed" }, { status }),
      );
      render(<SearchPage />);
      fireEvent.change(screen.getByLabelText("Pasted job description"), {
        target: { value: "Retained manual input" },
      });
      enterUrl();
      await screen.findByRole("alert");
      expect(screen.getByLabelText("Greenhouse posting URL")).toHaveValue(
        source,
      );
      expect(screen.getByLabelText("Pasted job description")).toHaveValue(
        "Retained manual input",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Nothing has been saved",
      );
      expect(
        screen.queryByRole("button", { name: "Save reviewed job" }),
      ).not.toBeInTheDocument();
    },
  );
  it("saves only explicitly reviewed fields through the existing creation route", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(draft)).mockResolvedValueOnce(
      Response.json(
        {
          id: "00000000-0000-0000-0000-000000000001",
          title: "Reviewed provider role",
          company: null,
          location: "Remote",
          description: draft.description,
          application: { status: "interested" },
        },
        { status: 201 },
      ),
    );
    await preview();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Reviewed provider role" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed job" }));
    await screen.findByText("Reviewed job saved as Interested.");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      title: "Reviewed provider role",
      location: "Remote",
      source_url: source,
      description: draft.description,
    });
    fireEvent.click(screen.getByRole("button", { name: "Import another job" }));
    expect(screen.getByLabelText("Greenhouse posting URL")).toHaveValue("");
  });
  it("returns to retained URL and pasted text only after explicit discard", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    render(<SearchPage />);
    fireEvent.change(screen.getByLabelText("Pasted job description"), {
      target: { value: "Manual text" },
    });
    enterUrl();
    await screen.findByRole("heading", { name: "Review normalized job" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Back to posting URL (discard preview edits)",
      }),
    );
    expect(screen.getByLabelText("Greenhouse posting URL")).toHaveValue(source);
    expect(screen.getByLabelText("Pasted job description")).toHaveValue(
      "Manual text",
    );
  });
});
