import { type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { keys } from "@/hooks/use-emails";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — ONB" },
      { name: "description", content: "Sign in to ONB to schedule and track your emails." },
      { property: "og:title", content: "Login — ONB" },
      { property: "og:description", content: "Sign in to ONB to schedule and track your emails." },
    ],
  }),
  component: LoginPage,
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-4.5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const fieldCls = "h-14 w-full rounded-xl bg-field px-5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-brand/30";

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const google = () => {
    if (api.loginWithGoogle()) {
      qc.removeQueries({ queryKey: keys.me });
      navigate({ to: "/scheduled" });
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    toast("Coming soon, please use Google");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-124 rounded-xl border border-border px-14 py-14">
        <h1 className="text-center text-4xl font-semibold text-foreground">Login</h1>
        <Button variant="soft" className="mt-7 h-12 w-full text-base" onClick={google}>
          <GoogleIcon /> Login with Google
        </Button>
        <div className="my-7 flex items-center gap-4 text-[13px] tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or sign up through email
          <span className="h-px flex-1 bg-border" />
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input type="email" placeholder="Email ID" className={fieldCls} />
          <input type="password" placeholder="Password" className={fieldCls} />
          <Button type="submit" variant="brand" className="mt-4 h-12 text-base font-normal">
            Login
          </Button>
        </form>
      </div>
    </div>
  );
}
