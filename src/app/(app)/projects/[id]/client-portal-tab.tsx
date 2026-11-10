import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActorLike } from "@/server/authz/clients";
import { getSharingOverview } from "@/server/services/portal-sharing";
import { setItemsVisibilityAction, setProjectVisibilityAction } from "../actions";

const LABEL: Record<string, string> = {
  PENDING: "Pending", IN_PROGRESS: "In progress", COMPLETED: "Completed",
  TODO: "To do", REVIEW: "Review", DONE: "Done",
};

function Toggle({ shared, name, action }: { shared: boolean; name: string; action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Button
        type="submit"
        size="sm"
        variant={shared ? "secondary" : "outline"}
        aria-label={shared ? `Hide ${name} from the client` : `Share ${name} with the client`}
      >
        {shared ? "Shared" : "Hidden"}
      </Button>
    </form>
  );
}

function Bulk({ projectId, kind, ids }: { projectId: string; kind: "milestone" | "task"; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="flex gap-2">
      <form action={setItemsVisibilityAction.bind(null, projectId, kind, null, true)}>
        <Button type="submit" size="sm" variant="outline">
          Share all
        </Button>
      </form>
      <form action={setItemsVisibilityAction.bind(null, projectId, kind, null, false)}>
        <Button type="submit" size="sm" variant="ghost">
          Hide all
        </Button>
      </form>
    </div>
  );
}

export async function ClientPortalTab({ projectId, actor }: { projectId: string; actor: ActorLike }) {
  const o = await getSharingOverview(actor, projectId);
  const noPortalUser = !o.client.portalUser;
  const items = (rows: { id: string; title: string; status: string; visibleToClient: boolean }[], kind: "milestone" | "task") =>
    rows.length === 0 ? (
      <p className="text-muted-foreground text-sm">None yet.</p>
    ) : (
      <ul className="divide-y rounded-md border text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-2">
            <span className="min-w-0 flex-1 truncate">{r.title}</span>
            <span className="text-muted-foreground text-xs">{LABEL[r.status] ?? r.status}</span>
            <Toggle
              shared={r.visibleToClient}
              name={r.title}
              action={setItemsVisibilityAction.bind(null, projectId, kind, [r.id], !r.visibleToClient)}
            />
          </li>
        ))}
      </ul>
    );
  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-muted-foreground text-sm">
        Choose what {o.client.name} can see in their portal. Nothing is shared by default. Clients never see budgets, rates,
        time, team members, comments or files.
      </p>
      {noPortalUser && (
        <p role="status" className="rounded-md border p-3 text-sm">
          This client has no portal user yet.{" "}
          <Link href={`/clients/${o.client.id}?tab=portal`} className="underline">
            Invite them
          </Link>{" "}
          for them to see anything.
        </p>
      )}
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">Project</h2>
          <Badge variant="secondary">{o.visibleToClient ? "Visible to client" : "Not visible to client"}</Badge>
          <div className="ml-auto">
            <Toggle shared={o.visibleToClient} name="this project" action={setProjectVisibilityAction.bind(null, projectId, !o.visibleToClient)} />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Clients see the project name, description, status and dates. Milestones and tasks below only appear once the
          project itself is shared.
        </p>
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">Milestones</h2>
          <div className="ml-auto">
            <Bulk projectId={projectId} kind="milestone" ids={o.milestones.map((m) => m.id)} />
          </div>
        </div>
        {items(o.milestones, "milestone")}
      </section>
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">Tasks</h2>
          <div className="ml-auto">
            <Bulk projectId={projectId} kind="task" ids={o.tasks.map((t) => t.id)} />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Clients see a shared task&apos;s title, description, status and due date. Check the description before sharing, as
          it may contain internal notes.
        </p>
        {items(o.tasks, "task")}
      </section>
    </div>
  );
}
