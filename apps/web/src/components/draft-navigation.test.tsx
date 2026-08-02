import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftNavigation, resolveDraftView } from "./draft-navigation";

describe("DraftNavigation", () => {
  it("redirects completed draft and table views to the final map", () => {
    expect(resolveDraftView("draft", true)).toBe("map");
    expect(resolveDraftView("table", true)).toBe("map");
    expect(resolveDraftView("activity", true)).toBe("activity");
    expect(resolveDraftView("draft", false)).toBe("draft");
  });

  it("shows only the final map and activity log after completion", () => {
    const markup = renderToStaticMarkup(
      <DraftNavigation view="draft" completed onViewChange={() => undefined} />,
    );

    expect(markup).toContain(">MAP<");
    expect(markup).toContain(">LOG<");
    expect(markup).not.toContain(">DRAFT<");
    expect(markup).not.toContain(">TABLE<");
    expect(markup).toContain('aria-current="page"');
  });

  it("keeps all working views available while the draft is active", () => {
    const markup = renderToStaticMarkup(
      <DraftNavigation view="draft" onViewChange={() => undefined} />,
    );

    expect(markup).toContain(">DRAFT<");
    expect(markup).toContain(">MAP<");
    expect(markup).toContain(">TABLE<");
    expect(markup).toContain(">LOG<");
  });
});
