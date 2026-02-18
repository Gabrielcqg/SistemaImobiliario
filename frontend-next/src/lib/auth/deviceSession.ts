"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

type DeviceRegistrationRow = {
  status?: string | null;
  message?: string | null;
  active_count?: number | null;
  session_limit?: number | null;
  organization_kind?: string | null;
  organization_id?: string | null;
  should_sign_out_others?: boolean | null;
};

type DeviceTouchRow = {
  is_revoked?: boolean | null;
  revoked_reason?: string | null;
  active_count?: number | null;
  session_limit?: number | null;
};

export type DeviceSessionRegisterResult = {
  fingerprint: string;
  status: string;
  message: string;
  activeCount: number;
  sessionLimit: number;
  shouldSignOutOthers: boolean;
};

export type DeviceSessionTouchResult = {
  isRevoked: boolean;
  revokedReason: string | null;
  activeCount: number;
  sessionLimit: number;
};

const encoder = new TextEncoder();
let fingerprintPromise: Promise<string> | null = null;

const isMissingFunctionError = (message?: string) =>
  typeof message === "string" && /function .* does not exist|PGRST202|42883/i.test(message);

async function sha256Hex(value: string) {
  const bytes = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export async function getDeviceFingerprint() {
  if (!fingerprintPromise) {
    fingerprintPromise = (async () => {
      if (typeof window === "undefined") {
        return "server";
      }

      const source = [
        navigator.userAgent || "",
        navigator.platform || "",
        navigator.language || "",
        Intl.DateTimeFormat().resolvedOptions().timeZone || ""
      ].join("|");

      if (!globalThis.crypto?.subtle) {
        return source;
      }

      return sha256Hex(source);
    })();
  }

  return fingerprintPromise;
}

function getDevicePlatform() {
  if (typeof navigator === "undefined") return "unknown";
  return navigator.platform || "unknown";
}

function getUserAgent() {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export async function registerCurrentDeviceSession(
  supabase: SupabaseClient
): Promise<DeviceSessionRegisterResult | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return null;
  }

  const fingerprint = await getDeviceFingerprint();

  const { data, error } = await supabase
    .rpc("register_user_device_session", {
      p_fingerprint: fingerprint,
      p_user_agent: getUserAgent(),
      p_platform: getDevicePlatform(),
      p_last_ip: null,
      p_session_token: session.access_token
    })
    .maybeSingle();

  if (error) {
    if (isMissingFunctionError(error.message)) {
      return {
        fingerprint,
        status: "ok",
        message: "Sessao registrada em modo de compatibilidade.",
        activeCount: 1,
        sessionLimit: 1,
        shouldSignOutOthers: false
      };
    }
    throw new Error(error.message);
  }

  const row = (data ?? {}) as DeviceRegistrationRow;

  return {
    fingerprint,
    status: row.status ?? "ok",
    message: row.message ?? "Sessao registrada.",
    activeCount: row.active_count ?? 0,
    sessionLimit: row.session_limit ?? 1,
    shouldSignOutOthers: Boolean(row.should_sign_out_others)
  };
}

export async function touchCurrentDeviceSession(
  supabase: SupabaseClient,
  fingerprint: string
): Promise<DeviceSessionTouchResult | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return null;
  }

  const { data, error } = await supabase
    .rpc("touch_user_device_session", {
      p_fingerprint: fingerprint,
      p_session_token: session.access_token
    })
    .maybeSingle();

  if (error) {
    if (isMissingFunctionError(error.message)) {
      return {
        isRevoked: false,
        revokedReason: null,
        activeCount: 1,
        sessionLimit: 1
      };
    }
    throw new Error(error.message);
  }

  const row = (data ?? {}) as DeviceTouchRow;

  return {
    isRevoked: Boolean(row.is_revoked),
    revokedReason: row.revoked_reason ?? null,
    activeCount: row.active_count ?? 0,
    sessionLimit: row.session_limit ?? 1
  };
}
