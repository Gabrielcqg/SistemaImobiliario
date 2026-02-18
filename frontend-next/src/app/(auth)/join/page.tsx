import { redirect } from "next/navigation";

export default function JoinIndexPage({
  searchParams
}: {
  searchParams: {
    token?: string | string[];
  };
}) {
  const tokenRaw = searchParams.token;
  const token = Array.isArray(tokenRaw) ? tokenRaw[0] : tokenRaw ?? "";

  if (token) {
    redirect(`/signup/join?token=${encodeURIComponent(token)}`);
  }

  redirect("/signup/join");
}
