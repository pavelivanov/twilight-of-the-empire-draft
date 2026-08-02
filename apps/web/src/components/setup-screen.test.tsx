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
    expect(markup).toContain("Post every action to a group");
    expect(markup).toContain('name="notifyTelegramChannel"');
  });

  it("shows Prophecy of Kings as a required v1 ruleset", () => {
    const markup = renderToStaticMarkup(<SetupScreen onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(markup).toContain("Required in v1 for the nine-slice system pool.");
    expect(markup).toContain("REQUIRED V1");
  });

  it("locks group notifications on for a group command launch", () => {
    const markup = renderToStaticMarkup(
      <SetupScreen telegramLaunchToken="00000000-0000-4000-8000-000000000000" onCreated={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(markup).toContain("CONNECTED");
    expect(markup).toContain("where /newdraft was sent");
    expect(markup).toContain('name="notifyTelegramChannel"');
    expect(markup).toContain("disabled");
  });
});
