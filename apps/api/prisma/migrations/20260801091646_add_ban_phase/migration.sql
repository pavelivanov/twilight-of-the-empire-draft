-- AlterEnum
ALTER TYPE "DraftStatus" ADD VALUE 'BANNING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'PLAYER_BANNED';
ALTER TYPE "EventType" ADD VALUE 'BAN_PHASE_COMPLETED';

-- AlterTable
ALTER TABLE "DraftOption" ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "bannedByPlayerId" TEXT;

-- AddForeignKey
ALTER TABLE "DraftOption" ADD CONSTRAINT "DraftOption_bannedByPlayerId_fkey" FOREIGN KEY ("bannedByPlayerId") REFERENCES "DraftPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
