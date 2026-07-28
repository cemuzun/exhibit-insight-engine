import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listNotifications, markNotificationsRead } from "@/lib/notifications.functions";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  run_id: string | null;
  last_step: string | null;
  last_step_message: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const fetchAll = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchAll() as Promise<Notification[]>,
    refetchInterval: 60_000,
  });
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const mark = useMutation({
    mutationFn: () => markRead({ data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Live push: new failure alerts arrive without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel("notifications-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notification;
          toast.error(n.title, { description: n.body ?? undefined });
          qc.invalidateQueries({ queryKey: ["notifications"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v);
          if (!open && unread > 0) mark.mutate();
        }}
        className="relative rounded-md p-1.5 text-muted-foreground hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 rounded-lg border border-border bg-card p-2 shadow-lg">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground">Alerts</div>
          {items.length === 0 && (
            <p className="px-2 py-4 text-sm text-muted-foreground">No alerts yet.</p>
          )}
          <ul className="max-h-96 space-y-1 overflow-auto">
            {items.map((n) => (
              <li key={n.id} className="rounded-md p-2 hover:bg-muted/50">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                {n.last_step && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Last completed step: <span className="text-foreground">{n.last_step.replace(/_/g, " ")}</span>
                    {n.last_step_message ? ` — ${n.last_step_message}` : ""}
                  </p>
                )}
                {n.body && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{n.body}</p>}
                {n.run_id && (
                  <Link
                    to="/runs/$runId"
                    params={{ runId: n.run_id }}
                    onClick={() => setOpen(false)}
                    className="mt-1 inline-block text-xs text-primary hover:underline"
                  >
                    View run
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
