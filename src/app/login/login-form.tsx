"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    if (mode === "password") {
      const { error } = await authClient.signIn.email({ email, password: String(form.get("password") ?? "") });
      if (error) setError("Invalid email or password.");
      else {
        router.replace("/");
        router.refresh();
      }
    } else {
      await authClient.signIn.magicLink({ email, callbackURL: "/" });
      // Same message whether or not the account exists (no account enumeration).
      setNotice("If that email has portal access, a sign-in link is on its way.");
    }
    setBusy(false);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to Rokket</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          {mode === "password" && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "password" ? "Sign in" : "Email me a sign-in link"}
          </Button>
          <button
            type="button"
            className="text-muted-foreground w-full text-sm underline"
            onClick={() => {
              setMode(mode === "password" ? "link" : "password");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "password" ? "Client? Use an email link instead" : "Use password instead"}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
