import { NextResponse } from "next/server";
import { aiDebugSummary, buildAiContextForUser } from "@/lib/ai/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 401,
          code: userError?.name ?? "unauthenticated",
          message: "Usuário não autenticado."
        }
      },
      { status: 401 }
    );
  }

  try {
    const context = await buildAiContextForUser({
      supabase,
      user
    });

    if (process.env.NODE_ENV !== "production") {
      console.info("[IA][context] payload", aiDebugSummary(context));
    }

    return NextResponse.json({ ok: true, data: context });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao montar contexto da IA.";
    console.error("[IA][context] error", { userId: user.id, message });

    return NextResponse.json(
      {
        ok: false,
        error: {
          status: 500,
          code: "context_build_failed",
          message
        }
      },
      { status: 500 }
    );
  }
}
