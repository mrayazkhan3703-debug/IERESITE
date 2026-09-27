"use client";

import * as React from "react";
import { api } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import { SavedStateSync } from "@/components/providers/saved-state-sync";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<AuthFlowResult>;
  register: (email: string, password: string, name?: string) => Promise<AuthFlowResult>;
  loadMfaSetup: (challenge: string) => Promise<{ secret: string; provisioningUri: string }>;
  confirmMfaSetup: (challenge: string, code: string) => Promise<string[]>;
  verifyMfaLogin: (challenge: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

export type AuthFlowResult =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "verification_required"; emailDelivery: "accepted" | "not_configured" }
  | { kind: "mfa_setup_required"; challenge: string }
  | { kind: "mfa_required"; challenge: string };

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const me = await api.get<{ user: AuthUser | null }>("/api/auth/me");
      setUser(me.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const login = React.useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user?: AuthUser; mfaSetupRequired?: boolean; mfaRequired?: boolean; challenge?: string }>("/api/auth/login", { email, password });
    if (res.user) {
      setUser(res.user);
      return { kind: "authenticated", user: res.user } as const;
    }
    if (res.mfaSetupRequired && res.challenge) return { kind: "mfa_setup_required", challenge: res.challenge } as const;
    if (res.mfaRequired && res.challenge) return { kind: "mfa_required", challenge: res.challenge } as const;
    throw new Error("Unexpected authentication response");
  }, []);

  const register = React.useCallback(async (email: string, password: string, name?: string) => {
    const res = await api.post<{ verificationRequired: boolean; emailDelivery: "accepted" | "not_configured" }>("/api/auth/register", { email, password, name });
    if (!res.verificationRequired) throw new Error("Unexpected registration response");
    return { kind: "verification_required", emailDelivery: res.emailDelivery } as const;
  }, []);

  const loadMfaSetup = React.useCallback((challenge: string) =>
    api.post<{ secret: string; provisioningUri: string }>("/api/auth/mfa/setup", { challenge }), []);

  const confirmMfaSetup = React.useCallback(async (challenge: string, code: string) => {
    const res = await api.post<{ recoveryCodes: string[] }>("/api/auth/mfa/confirm", { challenge, code });
    await refresh();
    return res.recoveryCodes;
  }, [refresh]);

  const verifyMfaLogin = React.useCallback(async (challenge: string, code: string) => {
    await api.post("/api/auth/mfa/verify-login", { challenge, code });
    await refresh();
  }, [refresh]);

  const logout = React.useCallback(async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  }, []);

  const value = React.useMemo(
    () => ({ user, loading, refresh, login, register, loadMfaSetup, confirmMfaSetup, verifyMfaLogin, logout }),
    [user, loading, refresh, login, register, loadMfaSetup, confirmMfaSetup, verifyMfaLogin, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      <SavedStateSync userId={user?.id ?? null} />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Require one of the given roles — used by admin views; server enforces on API too. */
export function hasRole(user: AuthUser | null, roles: string[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => roles.includes(r));
}
