import { Badge } from "@/components/ui/badge";

const STYLE: Record<string, [string, string]> = {
  SENT: ["Sent", "bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-500/20 dark:text-violet-300"],
  DELIVERED: ["Delivered", "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-300"],
  FAILED: ["Failed", "bg-rose-100 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/20 dark:text-rose-300"],
  BOUNCED: ["Bounced", "bg-rose-100 text-rose-600 hover:bg-rose-100 dark:bg-rose-500/20 dark:text-rose-300"],
  COMPLAINED: ["Spam complaint", "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:text-amber-300"],
};

export const EMAIL_STATUS_HELP: Record<string, string> = {
  SENT: "Accepted by Mailgun. Delivery not confirmed yet.",
  DELIVERED: "The recipient's mail server accepted it.",
  FAILED: "Mailgun rejected it, so it was never sent.",
  BOUNCED: "Permanently rejected by the recipient's server (bad address?).",
  COMPLAINED: "The recipient marked it as spam.",
};

export function EmailStatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS_OR_DEFAULT(status);
  return (
    <Badge variant="secondary" className={cls} title={EMAIL_STATUS_HELP[status]}>
      {label}
    </Badge>
  );
}

function STATUS_OR_DEFAULT(status: string): [string, string] {
  return STYLE[status] ?? [status, ""];
}
