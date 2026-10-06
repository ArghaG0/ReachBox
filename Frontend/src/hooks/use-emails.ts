import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ListStatus } from "@/types";

export const PAGE_SIZE = 20;

export const keys = {
  me: ["me"] as const,
  emails: ["emails"] as const,
  list: (status: ListStatus, q: string) => ["emails", "list", status, q] as const,
  email: (id: string) => ["emails", "detail", id] as const,
  counts: ["emails", "counts"] as const,
  senders: ["senders"] as const,
  slack: ["slack"] as const,
};

export function useEmails(status: ListStatus, q: string) {
  return useInfiniteQuery({
    queryKey: keys.list(status, q),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.listEmails({ status, page: pageParam, limit: PAGE_SIZE, q }),
    getNextPageParam: (last) => (last.page * last.limit < last.total ? last.page + 1 : undefined),
  });
}

export const useCounts = () => useQuery({ queryKey: keys.counts, queryFn: api.counts });
export const useEmail = (id: string) => useQuery({ queryKey: keys.email(id), queryFn: () => api.getEmail(id) });
export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, retry: false });
export const useSenders = () => useQuery({ queryKey: keys.senders, queryFn: api.senders });
export const useSlackStatus = () => useQuery({ queryKey: keys.slack, queryFn: api.slackStatus });
