import { cn } from "cn";

export type QuoteHistoryItem = {
  id: string;
  fromClient: boolean;
  action: string;
  body: string | null;
  createdAt: Date;
  authorName: string;
};

const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function headline(item: QuoteHistoryItem, viewer: "admin" | "client"): string {
  const you = viewer === "client";
  switch (item.action) {
    case "accepted":
      return you ? "You accepted this quote" : `${item.authorName} accepted this quote`;
    case "declined":
      return you ? "You declined this quote" : `${item.authorName} declined this quote`;
    case "changes_requested":
      return you ? "You requested edits" : `${item.authorName} requested edits`;
    case "revised":
      return you ? "A revised quote was sent to you" : `${item.authorName} sent a revised quote`;
    default:
      return item.action;
  }
}

/** The quote's back-and-forth, oldest first. Shown to both sides; `viewer` only changes the wording. */
export function QuoteHistory({ items, viewer }: { items: QuoteHistoryItem[]; viewer: "admin" | "client" }) {
  if (items.length === 0) return null;
  return (
    <section className="max-w-2xl space-y-3" aria-label="Notes and history">
      <h2 className="text-lg font-semibold">Notes &amp; history</h2>
      <ol className="space-y-3">
        {items.map((i) => (
          <li
            key={i.id}
            className={cn("rounded-xl border-l-4 p-3 text-sm", i.fromClient ? "bg-tint-amber border-amber-400" : "bg-tint-blue border-sky-400")}
          >
            <p className="font-medium">{headline(i, viewer)}</p>
            {i.body && <p className="mt-1 whitespace-pre-wrap">{i.body}</p>}
            <p className="text-muted-foreground mt-1 text-xs">{fmt(i.createdAt)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
