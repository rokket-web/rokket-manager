import Link from "next/link";
import { requireActor } from "@/server/authz/session";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { FieldForm } from "@/components/forms/field-form";
import { bpsToPercent } from "@/lib/tax";
import { getBillingSettings } from "@/server/services/settings";
import { saveBillingSettingsAction } from "./billing-form-action";

export const metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  const billing = actor.role === "ADMIN" ? await getBillingSettings(actor) : null;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="space-y-1">
        <h2 className="font-medium">Account</h2>
        <p className="text-muted-foreground text-sm">
          {actor.name} · {actor.email} · {actor.role.toLowerCase()}
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">Appearance</h2>
        <ThemeToggle />
      </section>
      {actor.role === "ADMIN" && (
        <section className="space-y-1">
          <h2 className="font-medium">Email</h2>
          <p className="text-muted-foreground text-sm">
            See every email the app sent and whether it was delivered.{" "}
            <Link href="/settings/email-log" className="text-foreground underline">
              Open the email log
            </Link>
          </p>
        </section>
      )}
      {billing && (
        <section className="space-y-2">
          <h2 className="font-medium">Billing</h2>
          <p className="text-muted-foreground text-sm">
            Company details appear on quote and invoice PDFs. The default tax rate applies to clients without their own
            rate; it is copied onto each document when you save it.
          </p>
          <FieldForm
            fields={[
              { name: "companyName", label: "Company name", required: true },
              { name: "companyEmail", label: "Billing email", type: "email", hint: "Used as the reply-to address" },
              { name: "companyPhone", label: "Phone" },
              { name: "defaultTaxRate", label: "Default tax rate (%)", hint: "e.g. 8.25. Leave blank for none" },
              { name: "companyAddress", label: "Address", type: "textarea" },
              { name: "paymentInstructions", label: "Payment instructions", type: "textarea", hint: "Printed on invoices, e.g. bank or check details" },
            ]}
            action={saveBillingSettingsAction}
            defaults={{
              companyName: billing.company.name,
              companyEmail: billing.company.email ?? "",
              companyPhone: billing.company.phone ?? "",
              companyAddress: billing.company.address ?? "",
              paymentInstructions: billing.company.paymentInstructions ?? "",
              defaultTaxRate: billing.defaultTaxRateBps ? bpsToPercent(billing.defaultTaxRateBps) : "",
            }}
            submitLabel="Save billing settings"
            className="max-w-xl"
          />
        </section>
      )}
    </div>
  );
}
