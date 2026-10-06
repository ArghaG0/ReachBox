import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Me } from "@/types";

export function UserAvatar({ me, className }: { me: Me; className?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      <AvatarImage src={me.avatarUrl} alt={me.name} />
      <AvatarFallback>{me.name[0]}</AvatarFallback>
    </Avatar>
  );
}
