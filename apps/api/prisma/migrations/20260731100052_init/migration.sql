-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('SETUP', 'DRAFTING', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OptionKind" AS ENUM ('FACTION', 'SLICE', 'POSITION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('DRAFT_CREATED', 'POOL_REGENERATED', 'DRAFT_STARTED', 'PLAYER_CLAIMED', 'OPTION_SELECTED', 'CHAT_BOUND', 'PICK_REVERTED', 'DRAFT_COMPLETED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'SETUP',
    "creatorUserId" TEXT NOT NULL,
    "telegramChatId" TEXT,
    "playerCount" INTEGER NOT NULL DEFAULT 6,
    "turnCursor" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "seed" TEXT NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPlayer" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftOption" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" "OptionKind" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "selectedByPlayerId" TEXT,
    "selectedAt" TIMESTAMP(3),

    CONSTRAINT "DraftOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "actorUserId" TEXT,
    "playerId" TEXT,
    "idempotencyKey" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdate" (
    "updateId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("updateId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_slug_key" ON "Draft"("slug");

-- CreateIndex
CREATE INDEX "Draft_creatorUserId_idx" ON "Draft"("creatorUserId");

-- CreateIndex
CREATE INDEX "Draft_telegramChatId_idx" ON "Draft"("telegramChatId");

-- CreateIndex
CREATE INDEX "DraftPlayer_draftId_idx" ON "DraftPlayer"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPlayer_draftId_orderIndex_key" ON "DraftPlayer"("draftId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPlayer_draftId_userId_key" ON "DraftPlayer"("draftId", "userId");

-- CreateIndex
CREATE INDEX "DraftOption_draftId_kind_selectedByPlayerId_idx" ON "DraftOption"("draftId", "kind", "selectedByPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOption_draftId_kind_key_key" ON "DraftOption"("draftId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DraftEvent_idempotencyKey_key" ON "DraftEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DraftEvent_draftId_createdAt_idx" ON "DraftEvent"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPlayer" ADD CONSTRAINT "DraftPlayer_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPlayer" ADD CONSTRAINT "DraftPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOption" ADD CONSTRAINT "DraftOption_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftOption" ADD CONSTRAINT "DraftOption_selectedByPlayerId_fkey" FOREIGN KEY ("selectedByPlayerId") REFERENCES "DraftPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftEvent" ADD CONSTRAINT "DraftEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "DraftPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DraftEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
