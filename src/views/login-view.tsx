"use client";

import * as React from "react";
import { Link, navigate, useRoute } from "@/lib/router";
import { usePageMeta } from "@/components/layout/app-shell";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle } from "lucide-react";
import { events, track } from "@/lib/analytics-tracker";
import { api } from "@/lib/api-client";
import { localeOf, t } from "@/lib/i18n";
import { authFormError } from "@/lib/auth-form-error";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { login, register, loadMfaSetup, confirmMfaSetup, verifyMfaLogin } = useAuth();
  const loc = useRoute();
  const locale = localeOf(loc.locale);
  const isLogin = mode === "login";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<"credentials" | "verification" | "mfa-setup" | "mfa" | "recovery">("credentials");
  const [challenge, setChallenge] = React.useState("");
  const [mfaSecret, setMfaSecret] = React.useState("");
  const [provisioningUri, setProvisioningUri] = React.useState("");
  const [mfaCode, setMfaCode] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);

  usePageMeta({ title: t(isLogin ? "auth.signIn" : "auth.signUp", locale), noindex: true });

  React.useEffect(() => {
    events.formStart(`auth_${mode}`);
     
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (phase === "mfa-setup") {
        const codes = await confirmMfaSetup(challenge, mfaCode);
        setRecoveryCodes(codes);
        setPhase("recovery");
        return;
      }
      if (phase === "mfa") {
        await verifyMfaLogin(challenge, mfaCode);
        navigate(loc.query.next ?? "/account");
        return;
      }
      const result = isLogin
        ? await login(email, password)
        : await register(email, password, name || undefined);
      if (result.kind === "verification_required") {
        setNotice(result.emailDelivery === "accepted"
          ? t("auth.verifyAccepted", locale)
          : t("auth.verifyUnavailable", locale));
        setPhase("verification");
        return;
      }
      if (result.kind === "mfa_setup_required") {
        const setup = await loadMfaSetup(result.challenge);
        setChallenge(result.challenge);
        setMfaSecret(setup.secret);
        setProvisioningUri(setup.provisioningUri);
        setPhase("mfa-setup");
        return;
      }
      if (result.kind === "mfa_required") {
        setChallenge(result.challenge);
        setPhase("mfa");
        return;
      }
      events.formComplete(`auth_${mode}`);
      track(isLogin ? "account_login" : "account_register");
      navigate(loc.query.next ?? "/account");
    } catch (err) {
      setError(authFormError(err, locale));
    } finally {
      setBusy(false);
    }
  };

  if (phase === "verification") {
    return (
      <div className="container-page flex justify-center py-14">
        <div className="w-full max-w-md rounded-xl border border-border/70 bg-card p-8 text-center">
          <h1 className="font-display text-2xl font-semibold">{t("auth.verifyEmail", locale)}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{notice}</p>
          <Button asChild className="mt-6"><Link to="/account/login">{t("auth.returnToSignIn", locale)}</Link></Button>
        </div>
      </div>
    );
  }

  if (phase === "recovery") {
    return (
      <div className="container-page flex justify-center py-14">
        <div className="w-full max-w-lg rounded-xl border border-border/70 bg-card p-8">
          <h1 className="font-display text-2xl font-semibold">{t("auth.saveRecovery", locale)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("auth.recoveryHint", locale)}</p>
          <ul dir="ltr" className="mt-5 grid grid-cols-2 gap-2 font-mono text-sm">{recoveryCodes.map((code) => <li key={code} className="rounded bg-muted p-2 text-center">{code}</li>)}</ul>
          <Button className="mt-6 w-full" onClick={() => navigate(loc.query.next ?? "/account")}>{t("auth.recoverySaved", locale)}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page flex justify-center py-14">
      <div className="w-full max-w-md">
        <div className="text-center">
          <div className="font-display text-2xl font-semibold text-ink">
            Investment<span className="text-brand"> Experts</span>
          </div>
          <h1 className="mt-6 font-display text-2xl font-semibold">{t(isLogin ? "auth.loginTitle" : "auth.registerTitle", locale)}</h1>
          <p className="mt-2 min-h-10 text-sm text-muted-foreground">
            {t(isLogin ? "auth.loginDescription" : "auth.registerDescription", locale)}
          </p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4 rounded-xl border border-border/70 bg-card p-6 sm:p-8">
          {phase === "mfa-setup" && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm">
              <p className="font-medium">{t("auth.setupAuthenticator", locale)}</p>
              <p className="mt-1 text-muted-foreground">{t("auth.setupHint", locale)}</p>
              <code dir="ltr" className="mt-2 block break-all rounded bg-background p-2">{mfaSecret}</code>
              <a className="mt-2 block break-all text-xs text-brand-strong underline" href={provisioningUri}>{t("auth.openSetup", locale)}</a>
            </div>
          )}
          {(phase === "mfa" || phase === "mfa-setup") ? (
            <div className="space-y-1.5">
              <Label htmlFor="auth-mfa">{t("auth.authenticationCode", locale)}</Label>
              <Input id="auth-mfa" dir="ltr" required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoComplete="one-time-code" maxLength={32} />
            </div>
          ) : <>
          {!isLogin && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name">{t("auth.fullName", locale)}</Label>
              <Input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={120} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="auth-email">{t("auth.email", locale)}</Label>
            <Input id="auth-email" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-pass">{t("auth.password", locale)}</Label>
            <Input
              id="auth-pass"
              type="password"
              required
              minLength={isLogin ? 1 : 12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
            {!isLogin && <p className="text-xs text-muted-foreground">{t("auth.passwordHint", locale)}</p>}
          </div>
          </>}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t(phase === "mfa-setup" ? "auth.enableMfa" : phase === "mfa" ? "auth.verifyMfa" : isLogin ? "auth.signIn" : "auth.signUp", locale)}
          </Button>

          {isLogin && phase === "credentials" && (
            <Button type="button" variant="ghost" className="w-full" onClick={async () => {
              if (!email) { setError(t("auth.enterEmail", locale)); return; }
              setBusy(true);
              setError(null);
              setNotice(null);
              try {
                const result = await api.post<{ accepted: boolean }>("/api/auth/forgot-password", { email });
                if (result.accepted !== true) throw new Error("Unexpected reset response");
                setNotice(t("auth.resetAccepted", locale));
              } catch (err) {
                setError(authFormError(err, locale));
              } finally {
                setBusy(false);
              }
            }} disabled={busy}>{t("auth.forgotPassword", locale)}</Button>
          )}
          {notice && phase === "credentials" && <p className="text-center text-sm text-muted-foreground">{notice}</p>}

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                {t("auth.newHere", locale)}{" "}
                <Link to="/account/register" className="font-medium text-brand-strong underline underline-offset-2">
                  {t("auth.signUp", locale)}
                </Link>
              </>
            ) : (
              <>
                {t("auth.alreadyRegistered", locale)}{" "}
                <Link to="/account/login" className="font-medium text-brand-strong underline underline-offset-2">
                  {t("auth.signIn", locale)}
                </Link>
              </>
            )}
          </p>
          <p className="border-t border-border/60 pt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
            {t("auth.continuing", locale)}{" "}
            <Link to="/terms" className="underline underline-offset-2">{t("auth.terms", locale)}</Link>{" "}{t("auth.and", locale)}{" "}
            <Link to="/privacy" className="underline underline-offset-2">{t("auth.privacyNotice", locale)}</Link>.{" "}
            {t("auth.browsingFree", locale)}
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginView() {
  return <AuthForm mode="login" />;
}
