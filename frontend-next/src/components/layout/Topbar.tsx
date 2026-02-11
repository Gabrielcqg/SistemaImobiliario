"use client";

import { memo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function Topbar() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
      <div>
        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          Dashboard
        </p>
        <h1 className="mt-1 text-xl font-semibold">Visão Geral</h1>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary">Novo lead</Button>
        <Button variant="ghost" onClick={handleLogout} disabled={loading}>
          {loading ? "Saindo..." : "Sair"}
        </Button>
      </div>
    </div>
  );
}

export default memo(Topbar);
