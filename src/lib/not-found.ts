import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";

/** Render a 404 (not a server error) when a record is missing or outside the actor's scope. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
