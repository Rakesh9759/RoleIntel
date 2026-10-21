import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";

const router = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => router.pathname }));

afterEach(() => {
  cleanup();
  router.pathname = "/";
});

describe("workspace navigation", () => {
  it("provides a skip target and all seven real route links", () => {
    render(
      <AppShell>
        <h1>Page content</h1>
      </AppShell>,
    );
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav.id).toBe(menu.getAttribute("aria-controls"));
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/",
      "/search",
      "/jobs",
      "/contacts",
      "/messages",
      "/applications",
      "/settings",
    ]);
    expect(
      within(nav).getByRole("link", { name: "Dashboard" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("closes mobile navigation on selection and can reopen", () => {
    render(<AppShell>Page content</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const link = screen.getByRole("link", { name: "Saved jobs" });
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    fireEvent.click(link);
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(
      screen.getByRole("button", { name: "Close navigation" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and restores focus to the mobile menu button", () => {
    render(<AppShell>Page content</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const link = screen.getByRole("link", { name: "Saved jobs" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it.each(["/jobs", "/jobs/example"])(
    "marks saved jobs active at %s",
    (pathname) => {
      router.pathname = pathname;
      render(<AppShell>Page content</AppShell>);
      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
      const nav = screen.getByRole("navigation");
      expect(
        within(nav).getByRole("link", { name: "Saved jobs" }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        within(nav).getByRole("link", { name: "Dashboard" }),
      ).not.toHaveAttribute("aria-current");
    },
  );
});
