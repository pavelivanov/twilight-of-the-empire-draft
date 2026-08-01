import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SetupScreen } from "./setup-screen";

describe("SetupScreen", () => {
  it("exposes labels, names, and toggle state to assistive technology", () => {
    const markup = renderToStaticMarkup(<SetupScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(markup).toContain('for="draft-title"');
    expect(markup).toContain('name="title"');
    expect(markup).toContain('for="player-0"');
    expect(markup).toContain('name="players[0]"');
    expect(markup).toContain('aria-label="Number of players"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("shows Prophecy of Kings as a required v1 ruleset", () => {
    const markup = renderToStaticMarkup(<SetupScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(markup).toContain("Required in v1 for the nine-slice system pool.");
    expect(markup).toContain("REQUIRED V1");
  });
});
