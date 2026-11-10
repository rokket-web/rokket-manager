"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";

export type ThreadMessage = { id: string; fromClient: boolean; body: string; createdAt: string; senderName: string };

const POLL_MS = 4000;
const fmt = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Merge by id, oldest first. Used for both server refreshes (new props) and poll results. */
function merge(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    if (!byId.has(m.id)) {
      byId.set(m.id, m);
      changed = true;
    }
  }
  if (!changed) return current;
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Chat thread that stays current without a refresh: polls `endpoint` every few seconds while the tab is visible.
 * `mine` says which side is "us": admins see their own messages on the right (fromClient=false), clients see theirs on the right.
 */
export function LiveThread({
  initial,
  mine,
  endpoint,
}: {
  initial: ThreadMessage[];
  mine: "admin" | "client";
  endpoint: string;
}) {
  const [messages, setMessages] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const latest = useRef(initial.at(-1)?.createdAt ?? new Date(0).toISOString());

  // A server refresh (e.g. right after you send) hands us new props: fold them in.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setMessages((cur) => merge(cur, initial));
  }

  useEffect(() => {
    latest.current = messages.at(-1)?.createdAt ?? latest.current;
  }, [messages]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ after: latest.current }),
        cache: "no-store",
      });
      if (!res.ok) return; // signed out or transient: try again next tick
      const { messages: fresh } = (await res.json()) as { messages: ThreadMessage[] };
      setMessages((cur) => merge(cur, fresh));
    } catch {
      /* offline or server restarting: next tick retries */
    }
  }, [endpoint]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      void poll(); // catch up immediately when the tab comes back
      timer = setInterval(() => void poll(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState === "visible") timer = setInterval(() => void poll(), POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  // Keep the newest message in view, unless the reader scrolled up to read history.
  useEffect(() => {
    const el = box.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) return <p className="text-muted-foreground text-sm">No messages yet.</p>;
  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="max-h-[28rem] overflow-y-auto pr-1"
    >
      <ol className="space-y-3" aria-label="Messages" aria-live="polite">
        {messages.map((m) => {
          const own = mine === "client" ? m.fromClient : !m.fromClient;
          return (
            <li key={m.id} className={cn("flex flex-col", own ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2 text-sm break-words whitespace-pre-wrap",
                  own ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {m.body}
              </div>
              <span className="text-muted-foreground mt-1 text-xs">
                {m.senderName} ·{" "}
                <time dateTime={m.createdAt} suppressHydrationWarning>
                  {fmt(m.createdAt)}
                </time>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
