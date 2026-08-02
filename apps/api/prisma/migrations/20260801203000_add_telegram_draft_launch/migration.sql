CREATE TABLE "TelegramDraftLaunch" (
    "token" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "telegramChatTitle" TEXT,
    "telegramChatUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramDraftLaunch_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "TelegramDraftLaunch_expiresAt_idx" ON "TelegramDraftLaunch"("expiresAt");
