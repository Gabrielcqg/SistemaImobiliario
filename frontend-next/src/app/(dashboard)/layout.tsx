import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Topbar from "@/components/layout/Topbar";
import DashboardTransition from "@/components/layout/DashboardTransition";
import SessionGuard from "@/components/auth/SessionGuard";
import OrganizationChoiceGuard from "@/components/auth/OrganizationChoiceGuard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children
}: {
  children: ReactNode;
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-black text-white">
      <SessionGuard />
      <OrganizationChoiceGuard />
      <div className="flex min-h-screen flex-col">
        <Topbar />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10">
          <DashboardTransition>{children}</DashboardTransition>
        </main>
      </div>
    </div>
  );
}
