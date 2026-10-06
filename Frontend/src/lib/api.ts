import type {
  Email, EmailCounts, ListStatus, Me, Paginated, SchedulePayload, ScheduleResult, Sender, SlackStatus,
} from "@/types";
import { mockEmails, mockMe, mockSenders } from "./mock-data";

export const API_URL: string = import.meta.env["VITE_API_URL"] ?? "";
export const USE_MOCKS: boolean = import.meta.env["VITE_USE_MOCKS"] !== "false";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ---------- mock layer (in-memory only) ----------
const delay = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const store = { loggedIn: true, slack: false, emails: [...mockEmails] };
const inList = (e: Email, s: ListStatus) =>
  s === "scheduled" ? e.status === "scheduled" || e.status === "sending" : e.status === "sent" || e.status === "failed";

async function mock<T>(fn: () => T): Promise<T> {
  await delay();
  return fn();
}

// ---------- public API ----------
export interface ListParams {
  status: ListStatus;
  page: number;
  limit: number;
  q: string;
}

export const api = {
  me: (): Promise<Me> =>
    USE_MOCKS
      ? mock(() => {
          if (!store.loggedIn) throw new ApiError(401, "Unauthorized");
          return mockMe;
        })
      : request<Me>("/api/auth/me"),

  logout: (): Promise<{ ok: true }> =>
    USE_MOCKS
      ? mock(() => {
          store.loggedIn = false;
          return { ok: true as const };
        })
      : request("/api/auth/logout", { method: "POST" }),

  listEmails: ({ status, page, limit, q }: ListParams): Promise<Paginated<Email>> => {
    if (!USE_MOCKS) {
      const qs = new URLSearchParams({ status, page: String(page), limit: String(limit), q });
      return request(`/api/emails?${qs}`);
    }
    return mock(() => {
      const needle = q.trim().toLowerCase();
      const all = store.emails
        .filter((e) => inList(e, status))
        .filter((e) => !needle || `${e.to} ${e.subject} ${e.bodyPreview}`.toLowerCase().includes(needle))
        .sort((a, b) =>
          status === "scheduled"
            ? a.scheduledAt.localeCompare(b.scheduledAt)
            : b.scheduledAt.localeCompare(a.scheduledAt),
        );
      return { items: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit };
    });
  },

  counts: (): Promise<EmailCounts> =>
    USE_MOCKS
      ? mock(() => ({
          scheduled: store.emails.filter((e) => inList(e, "scheduled")).length,
          sent: store.emails.filter((e) => inList(e, "sent")).length,
        }))
      : request("/api/emails/counts"),

  getEmail: (id: string): Promise<Email> =>
    USE_MOCKS
      ? mock(() => {
          const e = store.emails.find((x) => x.id === id);
          if (!e) throw new ApiError(404, "Email not found");
          return e;
        })
      : request(`/api/emails/${encodeURIComponent(id)}`),

  schedule: (body: SchedulePayload): Promise<ScheduleResult> => {
    if (!USE_MOCKS) return request("/api/emails/schedule", { method: "POST", body: JSON.stringify(body) });
    return mock(() => {
      const sender = mockSenders.find((s) => s.id === body.senderId) ?? mockSenders[0]!;
      const start = body.startAt ? new Date(body.startAt).getTime() : Date.now();
      const perHourGap = 3600_000 / Math.max(1, body.hourlyLimit);
      const gap = Math.max(body.delaySeconds * 1000, perHourGap);
      const campaignId = `c_${Date.now()}`;
      const preview = body.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
      const created: Email[] = body.recipients.map((to, i) => ({
        id: `${campaignId}_${i}`,
        to,
        subject: body.subject,
        bodyPreview: preview,
        bodyHtml: body.bodyHtml,
        status: "scheduled",
        scheduledAt: new Date(start + i * gap).toISOString(),
        sentAt: null,
        senderEmail: sender.email,
        error: null,
        previewUrl: null,
      }));
      store.emails.push(...created);
      return {
        campaignId,
        total: created.length,
        firstScheduledAt: created[0]!.scheduledAt,
        lastScheduledAt: created[created.length - 1]!.scheduledAt,
      };
    });
  },

  senders: (): Promise<Sender[]> => (USE_MOCKS ? mock(() => mockSenders) : request("/api/senders")),

  slackStatus: (): Promise<SlackStatus> =>
    USE_MOCKS
      ? mock(() => (store.slack ? { connected: true, teamName: "ONB", channelName: "#alerts" } : { connected: false }))
      : request("/api/slack/status"),

  slackDisconnect: (): Promise<{ ok: true }> =>
    USE_MOCKS
      ? mock(() => {
          store.slack = false;
          return { ok: true as const };
        })
      : request("/api/slack/disconnect", { method: "DELETE" }),

  /** Browser redirects (not fetch). Returns true if handled by mocks. */
  loginWithGoogle: (): boolean => {
    if (USE_MOCKS) {
      store.loggedIn = true;
      return true;
    }
    window.location.href = `${API_URL}/api/auth/google`;
    return false;
  },

  connectSlack: (): boolean => {
    if (USE_MOCKS) {
      store.slack = true;
      return true;
    }
    window.location.href = `${API_URL}/api/slack/connect`;
    return false;
  },
};
