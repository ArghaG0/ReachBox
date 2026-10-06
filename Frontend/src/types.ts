export type EmailStatus = "scheduled" | "sending" | "sent" | "failed";

export interface Email {
  id: string;
  to: string;
  subject: string;
  bodyPreview: string;
  bodyHtml: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  senderEmail: string;
  error: string | null;
  previewUrl: string | null;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  name: string;
  size: string;
  url: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Sender {
  id: string;
  email: string;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export type ListStatus = "scheduled" | "sent";

export interface EmailCounts {
  scheduled: number;
  sent: number;
}

export interface SchedulePayload {
  senderId: string;
  subject: string;
  bodyHtml: string;
  recipients: string[];
  startAt: string | null;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface ScheduleResult {
  campaignId: string;
  total: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channelName?: string;
}
