CREATE TABLE "BrowserSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "linkedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserSession_tokenHash_key" ON "BrowserSession"("tokenHash");
CREATE INDEX "BrowserSession_expiresAt_idx" ON "BrowserSession"("expiresAt");
CREATE INDEX "BrowserSession_userId_idx" ON "BrowserSession"("userId");

ALTER TABLE "BrowserSession"
ADD CONSTRAINT "BrowserSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
