import { useEffect } from "react";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useMe } from "@/hooks/use-emails";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthGate,
});

function AuthGate() {
  const me = useMe();
  const navigate = useNavigate();
  const unauthorized = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthorized) navigate({ to: "/login", replace: true });
  }, [unauthorized, navigate]);

  if (me.isPending || unauthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Couldn't reach the server: {me.error.message}</p>
        <Button variant="brand-outline" onClick={() => me.refetch()}>Retry</Button>
      </div>
    );
  }
  return <Outlet />;
}
