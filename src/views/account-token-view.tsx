"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import { Link, useRoute } from "@/lib/router";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AccountTokenView({ mode }: { mode: "verify" | "reset" | "change-email" | "invite" }) {
  const route = useRoute();
  const { refresh } = useAuth();
  const token = route.query.token ?? "";
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "working" | "success" | "error">("idle");
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (mode === "reset" || mode === "invite" || !token || status !== "idle") return;
    setStatus("working");
    const path = mode === "verify" ? "/api/auth/verify-email" : "/api/auth/confirm-email-change";
    void api.post(path, { token })
      .then(async () => {
        await refresh();
        setMessage(mode === "verify" ? "Your email is verified and you are signed in." : "Your email address has been changed.");
        setStatus("success");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "This link is invalid or expired.");
        setStatus("error");
      });
  }, [mode, refresh, status, token]);

  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("working");
    try {
      await api.post("/api/auth/reset-password", { token, password });
      setMessage("Your password was changed. All existing sessions were revoked.");
      setStatus("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This link is invalid or expired.");
      setStatus("error");
    }
  };

  const acceptInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("working");
    try {
      await api.post("/api/auth/accept-invite", { token, password, ...(name.trim() ? { name: name.trim() } : {}) });
      setMessage("Your invitation is accepted. Sign in with your new password.");
      setStatus("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This invitation is invalid or expired.");
      setStatus("error");
    }
  };

  return (
    <div className="container-page flex justify-center py-14">
      <div className="w-full max-w-md rounded-xl border border-border/70 bg-card p-8">
        <h1 className="font-display text-2xl font-semibold">
          {mode === "verify" ? "Verify email" : mode === "reset" ? "Reset password" : mode === "invite" ? "Accept staff invitation" : "Confirm email change"}
        </h1>
        {!token && <p role="alert" className="mt-4 text-sm text-destructive">The link is missing its one-time token.</p>}
        {(mode === "reset" || mode === "invite") && status !== "success" && token && (
          <form onSubmit={mode === "invite" ? acceptInvite : reset} className="mt-6 space-y-4">
            {mode === "invite" && <div className="space-y-1.5"><Label htmlFor="invite-name">Name (optional)</Label><Input id="invite-name" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></div>}
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">{mode === "invite" ? "Create password" : "New password"}</Label>
              <Input id="reset-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <p className="text-xs text-muted-foreground">At least 12 characters with uppercase, lowercase and a number.</p>
            </div>
            <Button className="w-full" disabled={status === "working"}>{mode === "invite" ? "Accept invitation" : "Change password"}</Button>
          </form>
        )}
        {status === "working" && <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">Checking your one-time link…</p>}
        {message && <p role={status === "error" ? "alert" : "status"} className={`mt-4 text-sm ${status === "error" ? "text-destructive" : "text-foreground"}`}>{message}</p>}
        {status === "success" && <Button asChild className="mt-6 w-full"><Link to={mode === "reset" || mode === "invite" ? "/account/login" : "/account"}>{mode === "reset" || mode === "invite" ? "Sign in" : "Open account"}</Link></Button>}
      </div>
    </div>
  );
}
