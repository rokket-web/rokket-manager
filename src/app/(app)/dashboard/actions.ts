"use server";

import { revalidatePath } from "next/cache";
import { ConflictError, NotFoundError } from "@/server/errors";
import { requireActor } from "@/server/authz/session";
import { stopTimer } from "@/server/services/time";

export async function stopDashboardTimerAction() {
  const actor = await requireActor(["ADMIN", "STAFF"]);
  try {
    await stopTimer(actor);
  } catch (e) {
    // Already stopped in another tab: nothing to do, the refresh below shows the real state.
    if (!(e instanceof NotFoundError || e instanceof ConflictError)) throw e;
  }
  revalidatePath("/dashboard");
  revalidatePath("/time");
}
