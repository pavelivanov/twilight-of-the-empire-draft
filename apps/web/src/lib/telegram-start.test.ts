import { describe, expect, it } from "vitest";

import { telegramStartTarget } from "./telegram-start";

describe("telegramStartTarget", () => {
  it("opens setup for a group launch parameter", () => {
    expect(telegramStartTarget("group_1234", "?draft=old-draft")).toEqual({
      telegramLaunchToken: "1234",
    });
  });

  it("opens an existing draft for ordinary start parameters", () => {
    expect(telegramStartTarget("friday-table", "")).toEqual({ initialDraftId: "friday-table" });
  });

  it("supports the browser fallback group query", () => {
    expect(telegramStartTarget(undefined, "?groupLaunch=1234")).toEqual({ telegramLaunchToken: "1234" });
  });

  it("keeps deployed channel-prefixed launch links compatible", () => {
    expect(telegramStartTarget("channel_1234", "")).toEqual({ telegramLaunchToken: "1234" });
  });
});
