import { requireActor } from "@/server/authz/session";

export const metadata = { title: "Client Portal" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ invited?: string }> }) {
  const actor = await requireActor(["CLIENT"]);
  const { invited } = await searchParams;
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">{invited ? "Welcome" : "Client Portal"}, {actor.name}</h1>
      <p className="text-muted-foreground">
        {invited
          ? "You're signed in. Next time, request a sign-in link from the login page using this email address."
          : "Your quotes, invoices and project updates will appear here."}
      </p>
    </div>
  );
}
