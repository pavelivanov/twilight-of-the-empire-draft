-- Enforce one locked ban per player within a draft. PostgreSQL permits
-- multiple NULL values, so unbanned options remain unrestricted.
CREATE UNIQUE INDEX "DraftOption_draftId_bannedByPlayerId_key"
ON "DraftOption"("draftId", "bannedByPlayerId");
