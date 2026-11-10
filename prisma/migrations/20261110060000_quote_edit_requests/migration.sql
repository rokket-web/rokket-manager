-- AlterEnum
ALTER TYPE "QuoteStatus" ADD VALUE 'CHANGES_REQUESTED';

-- CreateTable
CREATE TABLE "QuoteNote" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "authorId" TEXT,
    "fromClient" BOOLEAN NOT NULL,
    "action" TEXT NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteNote_quoteId_createdAt_idx" ON "QuoteNote"("quoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "QuoteNote" ADD CONSTRAINT "QuoteNote_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
