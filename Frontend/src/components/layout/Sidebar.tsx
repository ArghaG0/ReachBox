import { Link } from "@tanstack/react-router";
import { Clock, Send, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCounts } from "@/hooks/use-emails";
import type { Me } from "@/types";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

function NavItem({ to, icon: Icon, label, count }: { to: "/scheduled" | "/sent"; icon: LucideIcon; label: string; count?: number | undefined }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl px-4 py-2 text-sm text-foreground hover:bg-field"
      activeProps={{ className: "bg-brand-soft font-semibold hover:bg-brand-soft" }}
    >
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      <span className="text-xs font-normal text-muted-foreground">{count ?? ""}</span>
    </Link>
  );
}

export function Sidebar({ me }: { me: Me }) {
  const counts = useCounts();
  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-2.5 px-1.5 py-4">
      <div className="px-3 pb-1">
        <Logo />
      </div>
      <UserMenu me={me} />
      <Button asChild variant="brand-outline" className="h-[34px] text-sm font-medium">
        <Link to="/compose">Compose</Link>
      </Button>
      <p className="mt-4 px-4 text-[11px] uppercase text-muted-foreground">Core</p>
      <nav className="flex flex-col gap-0.5">
        <NavItem to="/scheduled" icon={Clock} label="Scheduled" count={counts.data?.scheduled} />
        <NavItem to="/sent" icon={Send} label="Sent" count={counts.data?.sent} />
      </nav>
    </aside>
  );
}
