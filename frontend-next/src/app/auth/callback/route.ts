import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DEFAULT_NEXT_PATH = "/login";

const allowedEmailOtpTypes = new Set([
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
  "email"
]);

function normalizeNextPath(nextPath: string | null): string {
  if (!nextPath) {
    return DEFAULT_NEXT_PATH;
  }

  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return DEFAULT_NEXT_PATH;
}

function isEmailOtpType(value: string | null): value is EmailOtpType {
  if (!value) {
    return false;
  }

  return allowedEmailOtpTypes.has(value);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const shouldShowConfirmed = requestUrl.searchParams.get("confirmed") === "1";
  const destinationPath = normalizeNextPath(requestUrl.searchParams.get("next"));
  const destinationUrl = new URL(destinationPath, requestUrl.origin);

  if (shouldShowConfirmed) {
    destinationUrl.searchParams.set("confirmed", "1");
  }

  const supabase = createSupabaseServerClient();
  let authError = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authError = Boolean(error);
  } else if (tokenHash && isEmailOtpType(otpType)) {
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash
    });
    authError = Boolean(error);
  }

  if (shouldShowConfirmed) {
    await supabase.auth.signOut();
  }

  if (authError) {
    destinationUrl.searchParams.set("confirmationError", "1");
  }

  return NextResponse.redirect(destinationUrl);
}
