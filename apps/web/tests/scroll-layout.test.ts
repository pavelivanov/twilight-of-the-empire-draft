import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

function declarationsFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule for ${selector}`);
  return match[1]!;
}

describe("Draft scroll layout", () => {
  it("keeps the overflow scroller outside a fixed WebKit containing block", () => {
    const shell = declarationsFor(".room-shell");
    const body = declarationsFor(".room-body");

    expect(shell).not.toMatch(/position\s*:\s*fixed/);
    expect(shell).toContain(
      "height: calc(100dvh - var(--app-content-inset-top) - var(--app-content-inset-bottom))",
    );
    expect(body).toMatch(/min-height\s*:\s*0/);
    expect(body).toMatch(/overscroll-behavior-y\s*:\s*contain/);
    expect(body).toMatch(/touch-action\s*:\s*pan-y/);
  });

  it("keeps the draft confirmation dock out of the scrolling list", () => {
    const dock = declarationsFor(".draft-confirm-dock");

    expect(dock).toMatch(/position\s*:\s*static/);
    expect(dock).toMatch(/flex\s*:\s*0\s+0\s+auto/);
  });
});
