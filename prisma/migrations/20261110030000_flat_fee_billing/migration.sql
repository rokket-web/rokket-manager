-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('HOURLY', 'FLAT_FEE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "billingType" "BillingType" NOT NULL DEFAULT 'HOURLY',
ADD COLUMN     "flatFeeCents" INTEGER;

-- CreateTable
CREATE TABLE "BillingInstallment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInstallment_invoiceId_key" ON "BillingInstallment"("invoiceId");

-- CreateIndex
CREATE INDEX "BillingInstallment_projectId_position_idx" ON "BillingInstallment"("projectId", "position");

-- AddForeignKey
ALTER TABLE "BillingInstallment" ADD CONSTRAINT "BillingInstallment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInstallment" ADD CONSTRAINT "BillingInstallment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
