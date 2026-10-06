import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Slack } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { keys, useSlackStatus } from "@/hooks/use-emails";
import type { Me } from "@/types";
import { UserAvatar } from "./UserAvatar";

export function UserMenu({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const slack = useSlackStatus();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      navigate({ to: "/login" });
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: api.slackDisconnect,
    onSuccess: () => {
      toast.success("Slack disconnected");
      qc.invalidateQueries({ queryKey: keys.slack });
    },
    onError: (e) => toast.error(e.message),
  });

  const connect = () => {
    if (api.connectSlack()) {
      toast.success("Slack connected");
      qc.invalidateQueries({ queryKey: keys.slack });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-xl bg-field px-3 py-2.5 text-left outline-none hover:bg-field/70">
        <UserAvatar me={me} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{me.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{me.email}</span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
        {slack.isPending ? (
          <DropdownMenuItem disabled>
            <Slack /> Checking Slack…
          </DropdownMenuItem>
        ) : slack.data?.connected ? (
          <DropdownMenuItem onSelect={() => disconnect.mutate()}>
            <Slack className="text-brand" />
            <span className="flex-1">Slack connected{slack.data.channelName ? ` · ${slack.data.channelName}` : ""}</span>
            <span className="text-xs text-destructive">Disconnect</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={connect}>
            <Slack /> Connect Slack
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
