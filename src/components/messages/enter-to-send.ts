import type { KeyboardEvent } from "react";

/**
 * Chat-style textarea: Enter sends, Shift+Enter inserts a new line. Ignores Enter while an IME is composing
 * (e.g. Japanese/Chinese input), empty messages, and presses while a send is already in flight.
 */
export function enterToSend(e: KeyboardEvent<HTMLTextAreaElement>, pending: boolean) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  if (pending || e.currentTarget.value.trim() === "") return;
  e.currentTarget.form?.requestSubmit();
}

export const ENTER_HINT = "Enter to send · Shift+Enter for a new line";
