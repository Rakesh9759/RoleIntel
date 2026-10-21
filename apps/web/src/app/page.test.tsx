import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("home page", () => {
  it("identifies the current scope as the project foundation", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Project foundation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/dashboard and job workflows begin in phase 1/i),
    ).toBeInTheDocument();
  });
});
