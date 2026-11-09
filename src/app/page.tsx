import { redirect } from "next/navigation";
import { getActor } from "@/server/authz/session";
import { homeFor } from "@/server/authz/policy";

export default async function Home() {
  const actor = await getActor();
  redirect(actor ? homeFor(actor.role) : "/login");
}
