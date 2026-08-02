export type TelegramStartTarget = {
  initialDraftId?: string;
  telegramLaunchToken?: string;
};

export function telegramStartTarget(startParam: string | undefined, search: string): TelegramStartTarget {
  if (startParam && /^(?:group|channel)_/.test(startParam)) {
    return { telegramLaunchToken: startParam.replace(/^(?:group|channel)_/, "") };
  }
  if (startParam) return { initialDraftId: startParam };

  const params = new URLSearchParams(search);
  const telegramLaunchToken = params.get("groupLaunch") ?? params.get("channelLaunch") ?? undefined;
  if (telegramLaunchToken) return { telegramLaunchToken };
  return { initialDraftId: params.get("draft") ?? undefined };
}
