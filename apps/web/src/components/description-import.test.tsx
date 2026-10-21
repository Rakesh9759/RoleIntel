import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";

const draft = {
  title: "Supplied role",
  company: null,
  requisition_id: null,
  location: null,
  seniority: null,
  department: null,
  description: "Title: Supplied role\n\nActual duties.",
  technologies: ["C++, SQL", "Python"],
  experience_requirements: null,
  source_url: null,
  warnings: ["company: blank or conflicting labels; review manually."],
};
const saved = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Reviewed title",
  company: null,
  location: null,
  description: draft.description,
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
async function preview() {
  render(<SearchPage />);
  fireEvent.change(screen.getByLabelText("Pasted job description"), {
    target: { value: draft.description },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Normalize description" }),
  );
  await screen.findByRole("heading", { name: "Review normalized job" });
}

describe("manual description normalization", () => {
  it("does not call the API on mount and requires pasted text", () => {
    render(<SearchPage />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Normalize description" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Paste a job description",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows an editable honest preview and warnings, never saving automatically", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    await preview();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/jobs/parse");
    expect(screen.getByLabelText("Company")).toHaveValue("");
    expect(screen.getByLabelText("Company")).toHaveAttribute(
      "placeholder",
      "Not available",
    );
    expect(screen.getByLabelText("Title")).toHaveValue(draft.title);
    expect(screen.getByLabelText("Normalized description")).toHaveValue(
      draft.description,
    );
    expect(screen.getByText(draft.warnings[0])).toBeInTheDocument();
    expect(screen.getByLabelText("Technologies (one per line)")).toHaveValue(
      "C++, SQL\nPython",
    );
  });
  it("saves only reviewed values, strips warnings and null placeholders, and prevents duplicate saves", async () => {
    let complete!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(Response.json(draft)).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
    );
    await preview();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: " Reviewed title " },
    });
    const form = screen
      .getByRole("button", { name: "Save reviewed job" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual({
      title: "Reviewed title",
      description: draft.description,
      technologies: ["C++, SQL", "Python"],
    });
    await act(async () => complete(Response.json(saved, { status: 201 })));
    await screen.findByText("Reviewed job saved as Interested.");
    expect(
      screen.getByRole("link", { name: "View saved job" }),
    ).toHaveAttribute("href", `/jobs/${saved.id}`);
    expect(
      screen.getByRole("button", { name: "Save reviewed job" }),
    ).toBeDisabled();
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Import another description" }),
    );
    expect(screen.getByLabelText("Pasted job description")).toHaveValue("");
  });
  it("retains original pasted text after parse failure and permits explicit retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Service unavailable"))
      .mockResolvedValueOnce(Response.json(draft));
    render(<SearchPage />);
    fireEvent.change(screen.getByLabelText("Pasted job description"), {
      target: { value: draft.description },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Normalize description" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Pasted job description")).toHaveValue(
      draft.description,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your pasted text has been kept",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Normalize description" }),
    );
    await screen.findByRole("heading", { name: "Review normalized job" });
  });
  it("retains preview edits and avoids success after a failed save", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(draft))
      .mockResolvedValueOnce(
        Response.json({ message: "Database unavailable" }, { status: 503 }),
      );
    await preview();
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Reviewed company" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed job" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Company")).toHaveValue("Reviewed company");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your edits have been kept",
    );
    expect(
      screen.queryByText("Reviewed job saved as Interested."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save reviewed job" }),
    ).toBeEnabled();
  });
  it("returns to the original pasted text without silently replacing it with edited preview", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    await preview();
    fireEvent.change(screen.getByLabelText("Normalized description"), {
      target: { value: "Preview edit" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Back to pasted text (discard preview edits)",
      }),
    );
    expect(screen.getByLabelText("Pasted job description")).toHaveValue(
      draft.description,
    );
  });
  it.each([{}, { ...draft, warnings: null }])(
    "rejects invalid previews with no save controls",
    async (payload) => {
      fetchMock.mockResolvedValue(Response.json(payload));
      render(<SearchPage />);
      fireEvent.change(screen.getByLabelText("Pasted job description"), {
        target: { value: "Actual input" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Normalize description" }),
      );
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("button", { name: "Save reviewed job" }),
      ).not.toBeInTheDocument();
    },
  );
  it("does not post invalid reviewed descriptions, technology counts or unsafe URLs", async () => {
    fetchMock.mockResolvedValue(Response.json(draft));
    await preview();
    const form = screen
      .getByRole("button", { name: "Save reviewed job" })
      .closest("form")!;
    fireEvent.change(screen.getByLabelText("Normalized description"), {
      target: { value: " " },
    });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("must not be blank");
    fireEvent.change(screen.getByLabelText("Normalized description"), {
      target: { value: draft.description },
    });
    fireEvent.change(screen.getByLabelText("Technologies (one per line)"), {
      target: {
        value: Array.from({ length: 101 }, (_, i) => String(i)).join("\n"),
      },
    });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "at most 100 technologies",
    );
    fireEvent.change(screen.getByLabelText("Technologies (one per line)"), {
      target: { value: "Python" },
    });
    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP(S)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("prevents duplicate normalization requests", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    render(<SearchPage />);
    fireEvent.change(screen.getByLabelText("Pasted job description"), {
      target: { value: draft.description },
    });
    const form = screen
      .getByRole("button", { name: "Normalize description" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Pasted job description")).toBeDisabled();
    await act(async () => resolve(Response.json(draft)));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save reviewed job" }),
      ).toBeEnabled(),
    );
  });
});
