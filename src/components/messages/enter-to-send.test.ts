import { describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { enterToSend } from "./enter-to-send";

function press(init: { key?: string; shiftKey?: boolean; composing?: boolean; value?: string }) {
  const requestSubmit = vi.fn();
  const preventDefault = vi.fn();
  const e = {
    key: init.key ?? "Enter",
    shiftKey: init.shiftKey ?? false,
    nativeEvent: { isComposing: init.composing ?? false },
    currentTarget: { value: init.value ?? "hello", form: { requestSubmit } },
    preventDefault,
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
  return { e, requestSubmit, preventDefault };
}

describe("enterToSend", () => {
  it("submits on Enter", () => {
    const { e, requestSubmit, preventDefault } = press({});
    enterToSend(e, false);
    expect(preventDefault).toHaveBeenCalled();
    expect(requestSubmit).toHaveBeenCalledOnce();
  });
  it("lets Shift+Enter insert a newline", () => {
    const { e, requestSubmit, preventDefault } = press({ shiftKey: true });
    enterToSend(e, false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });
  it("ignores other keys and IME composition", () => {
    for (const init of [{ key: "a" }, { composing: true }]) {
      const { e, requestSubmit, preventDefault } = press(init);
      enterToSend(e, false);
      expect(preventDefault).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
    }
  });
  it("does not send empty messages or double-send while pending", () => {
    const empty = press({ value: "   " });
    enterToSend(empty.e, false);
    expect(empty.requestSubmit).not.toHaveBeenCalled();
    expect(empty.preventDefault).toHaveBeenCalled(); // still no stray newline
    const busy = press({});
    enterToSend(busy.e, true);
    expect(busy.requestSubmit).not.toHaveBeenCalled();
  });
});
