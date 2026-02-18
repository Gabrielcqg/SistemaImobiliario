"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  registerCurrentDeviceSession,
  touchCurrentDeviceSession
} from "@/lib/auth/deviceSession";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const HEARTBEAT_MS = 60000;

export default function SessionGuard() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const clearHeartbeat = () => {
      if (heartbeatRef.current !== null) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    const forceLocalLogout = async (reason: "sessionLimit" | "sessionReplaced") => {
      await supabase.auth.signOut({ scope: "local" });
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("organization-bootstrap-context:v1");
      }
      if (!active) return;
      router.replace(`/login?${reason}=1`);
    };

    const bootstrap = async () => {
      try {
        const registration = await registerCurrentDeviceSession(supabase);
        if (!active || !registration) {
          return;
        }

        if (registration.status === "limit_exceeded") {
          await forceLocalLogout("sessionLimit");
          return;
        }

        if (registration.shouldSignOutOthers) {
          await supabase.auth.signOut({ scope: "others" });
        }

        const heartbeat = async () => {
          if (!active) return;
          try {
            const current = await touchCurrentDeviceSession(
              supabase,
              registration.fingerprint
            );

            if (!active || !current) return;
            if (!current.isRevoked) return;

            if (current.revokedReason === "session_limit_exceeded") {
              await forceLocalLogout("sessionLimit");
              return;
            }

            await forceLocalLogout("sessionReplaced");
          } catch (heartbeatError) {
            if (process.env.NODE_ENV === "development") {
              console.error("[SessionGuard] heartbeat error", heartbeatError);
            }
          }
        };

        await heartbeat();
        if (!active) return;

        heartbeatRef.current = window.setInterval(() => {
          void heartbeat();
        }, HEARTBEAT_MS);
      } catch (registerError) {
        if (process.env.NODE_ENV === "development") {
          console.error("[SessionGuard] register error", registerError);
        }
      }
    };

    void bootstrap();

    return () => {
      active = false;
      clearHeartbeat();
    };
  }, [router, supabase]);

  return null;
}
