import { describe, expect, it } from "vitest";

import { groupDraftLaunchReplyMarkup, groupPickerReplyMarkup, resolveNewDraftTarget } from "./telegram.js";

describe("Telegram group integration", () => {
  it("requests only groups where the user and bot can be administrators", () => {
    const markup = groupPickerReplyMarkup(42) as {
      keyboard: Array<
        Array<{
          request_chat: {
            request_id: number;
            chat_is_channel: boolean;
            user_administrator_rights: { can_manage_chat: boolean };
            bot_administrator_rights: { can_manage_chat: boolean };
            request_title: boolean;
            request_username: boolean;
          };
        }>
      >;
    };
    const request = markup.keyboard[0]![0]!.request_chat;

    expect(request).toMatchObject({
      request_id: 42,
      chat_is_channel: false,
      request_title: true,
      request_username: true,
      user_administrator_rights: { can_manage_chat: true },
      bot_administrator_rights: { can_manage_chat: true },
    });
  });

  it("opens the Mini App with a group launch token", () => {
    const markup = groupDraftLaunchReplyMarkup("00000000-0000-4000-8000-000000000000") as {
      inline_keyboard: Array<Array<{ text: string; url: string }>>;
    };
    const button = markup.inline_keyboard[0]![0]!;

    expect(button.text).toBe("Create draft");
    expect(button.url).toContain("00000000-0000-4000-8000-000000000000");
    expect(button.url).toMatch(/(?:startapp=group_|groupLaunch=)/);
  });

  it("accepts group and supergroup commands but not channel posts", async () => {
    await expect(resolveNewDraftTarget({ chat: { id: -1, type: "group", title: "Table" } })).resolves.toEqual({
      id: -1,
      type: "group",
      title: "Table",
    });
    await expect(resolveNewDraftTarget({ chat: { id: -2, type: "supergroup", title: "Table" } })).resolves.toEqual({
      id: -2,
      type: "supergroup",
      title: "Table",
    });
    await expect(resolveNewDraftTarget({ chat: { id: -3, type: "channel", title: "Broadcast" } })).resolves.toBeUndefined();
  });
});
