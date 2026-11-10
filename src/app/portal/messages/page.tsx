import { LiveThread } from "@/components/messages/thread";
import { requireActor } from "@/server/authz/session";
import { getPortalThread, markPortalThreadRead } from "@/server/services/messages";
import { sendPortalMessageAction } from "../actions";
import { PortalMessageForm } from "./message-form";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function PortalMessages() {
  const actor = await requireActor(["CLIENT"]);
  const messages = await getPortalThread(actor);
  await markPortalThreadRead(actor);
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Messages</h1>
      <LiveThread initial={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))} mine="client" endpoint="/api/portal/messages" />
      <PortalMessageForm action={sendPortalMessageAction} />
    </div>
  );
}
