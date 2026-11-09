import { requireActor } from "@/server/authz/session";
import { db, withRetry } from "@/server/db";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireActor(["ADMIN"]); // admin-only, enforced here and again in the query layer
  const users = await withRetry(() =>
    db.user.findMany({
      select: { id: true, name: true, email: true, role: true, active: true },
      orderBy: { createdAt: "asc" },
    }),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Role</th>
              <th className="p-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-2">{u.name}</td>
                <td className="p-2">{u.email}</td>
                <td className="p-2">{u.role.toLowerCase()}</td>
                <td className="p-2">{u.active ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
