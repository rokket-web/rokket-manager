-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'COMPLAINED');

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "detail" TEXT,
    "providerId" TEXT,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_providerId_key" ON "EmailLog"("providerId");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_clientId_createdAt_idx" ON "EmailLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
