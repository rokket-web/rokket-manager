import { ZodError } from "zod";
import { ForbiddenError, NotFoundError } from "@/server/errors";

export type FormState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: Record<string, string>;
};

export function formToObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) o[k] = v;
  return o;
}

/** Turn thrown service errors into form state. Unknown errors are logged, not leaked to the user. */
export function toFormState(err: unknown, values?: Record<string, string>): FormState {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
    return { fieldErrors, error: "Please fix the highlighted fields.", values };
  }
  if (err instanceof ForbiddenError || err instanceof NotFoundError) return { error: err.message, values };
  console.error("[action]", err);
  return { error: "Something went wrong. Please try again.", values };
}
