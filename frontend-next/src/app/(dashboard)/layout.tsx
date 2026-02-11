import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import DashboardTransition from "@/components/layout/DashboardTransition";
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

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id }, { onConflict: "id" });

  if (error) {
    // Optional: ignore if profiles table doesn't exist or RLS blocks it for now.
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <Topbar />
          <main className="flex-1 px-6 py-8 lg:px-10">
            <DashboardTransition>{children}</DashboardTransition>
          </main>
        </div>
      </div>
    </div>
  );
}
