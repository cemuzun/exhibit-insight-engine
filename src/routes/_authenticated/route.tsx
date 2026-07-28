import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="h-5 w-5 rounded bg-primary" />
            <span className="font-semibold">BoothLens</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/dashboard" className="text-muted-foreground hover:text-foreground" activeProps={{ className: "text-foreground" }}>Runs</Link>
            <Link to="/runs/new" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">New run</Link>
            <NotificationsBell />
            <div className="flex items-center gap-2 border-l border-border pl-4">
              <span className="text-xs text-muted-foreground">{email}</span>
              <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">Sign out</button>
            </div>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
