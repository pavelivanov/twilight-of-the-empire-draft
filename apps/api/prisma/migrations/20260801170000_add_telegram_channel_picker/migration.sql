-- AddEnumValue
ALTER TYPE "EventType" ADD VALUE 'DRAFT_DELETED';

-- Add the selected channel metadata and the active native picker request.
ALTER TABLE "Draft"
ADD COLUMN "telegramChatTitle" TEXT,
ADD COLUMN "telegramChatUsername" TEXT,
ADD COLUMN "telegramChannelRequestId" INTEGER;

CREATE UNIQUE INDEX "Draft_telegramChannelRequestId_key"
ON "Draft"("telegramChannelRequestId");

-- Pending action and deletion notifications must survive the draft/event
-- cascade long enough for the retryable outbox worker to deliver them.
ALTER TABLE "NotificationOutbox"
DROP CONSTRAINT "NotificationOutbox_draftId_fkey",
DROP CONSTRAINT "NotificationOutbox_eventId_fkey",
ALTER COLUMN "draftId" DROP NOT NULL,
ALTER COLUMN "eventId" DROP NOT NULL;

ALTER TABLE "NotificationOutbox"
ADD CONSTRAINT "NotificationOutbox_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "NotificationOutbox_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "DraftEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
