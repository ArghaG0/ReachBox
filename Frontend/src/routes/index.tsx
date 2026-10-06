import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ONB — Email Scheduler" },
      { name: "description", content: "Schedule, throttle and track outbound emails with ONB." },
      { property: "og:title", content: "ONB — Email Scheduler" },
      { property: "og:description", content: "Schedule, throttle and track outbound emails with ONB." },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/scheduled" });
  },
});
