import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Home from "./page";
import SearchPage from "./search/page";
import ContactsPage from "./contacts/page";
import MessagesPage from "./messages/page";
import ApplicationsPage from "./applications/page";
import SettingsPage from "./settings/page";

afterEach(cleanup);

describe("home page", () => {
  it("shows honest connection states rather than fabricated metrics", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/not connected to the job API yet/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not connected")).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: "Explore saved jobs" }),
    ).toHaveAttribute("href", "/jobs");
  });
});

describe("workspace pages", () => {
  it.each([
    ["Job search", SearchPage],
    ["Contacts", ContactsPage],
    ["Messages", MessagesPage],
    ["Application tracker", ApplicationsPage],
    ["Settings", SettingsPage],
  ])(
    "labels %s as an unfinished page with a working return link",
    (title, Page) => {
      render(<Page />);
      expect(
        screen.getByRole("heading", { name: title, level: 1 }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Not available yet" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/No data is loaded or changed/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Back to dashboard" }),
      ).toHaveAttribute("href", "/");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    },
  );
});
