import { cn } from "cn";

export type ThreadMessage = { id: string; fromClient: boolean; body: string; createdAt: Date; senderName: string };

const fmt = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/**
 * Chat-style thread. `mine` says which side is "us": admins see their own messages on the right (fromClient=false),
 * clients see theirs on the right (fromClient=true).
 */
export function Thread({ messages, mine }: { messages: ThreadMessage[]; mine: "admin" | "client" }) {
  if (messages.length === 0) return <p className="text-muted-foreground text-sm">No messages yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Messages">
      {messages.map((m) => {
        const own = mine === "client" ? m.fromClient : !m.fromClient;
        return (
          <li key={m.id} className={cn("flex flex-col", own ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap",
                own ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {m.body}
            </div>
            <span className="text-muted-foreground mt-1 text-xs">
              {m.senderName} · {fmt(m.createdAt)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
