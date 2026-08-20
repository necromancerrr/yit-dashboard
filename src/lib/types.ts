export interface GymLog {
  id: number;
  date: string;
  workout_type: string;
  duration_min: number | null;
  notes: string | null;
  created_at: string;
}

export interface LeetcodeLog {
  id: number;
  date: string;
  problem_name: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topic: string | null;
  url: string | null;
  notes: string | null;
  created_at: string;
}

export type InterviewStage =
  | "Applied"
  | "OA"
  | "Phone Screen"
  | "Technical"
  | "Onsite"
  | "Offer"
  | "Rejected";

export interface Interview {
  id: number;
  company: string;
  role: string | null;
  stage: InterviewStage;
  date: string | null;
  status: "Upcoming" | "Completed" | "Waiting" | "Closed";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolTask {
  id: number;
  course: string;
  title: string;
  due_date: string | null;
  status: "Pending" | "In Progress" | "Done";
  grade: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FinanceTransaction {
  id: number;
  date: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface ChecklistItem {
  id: number;
  title: string;
  category: string;
  recurring: 0 | 1;
  done: 0 | 1;
  done_date: string | null;
  created_at: string;
}

export interface ChecklistCompletion {
  id: number;
  item_id: number;
  date: string;
}

export interface CryptoHolding {
  id: number;
  symbol: string;
  name: string;
  coin_id: string | null;
  quantity: number;
  staked_pct: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A holding joined with its live price. Never persisted — computed per request. */
export interface CryptoHoldingWithPrice extends CryptoHolding {
  price_usd: number | null;
  value_usd: number | null;
  change_24h_pct: number | null;
}

/** A registered WebAuthn device. Key material is deliberately not exposed here. */
export interface Passkey {
  id: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

export interface HeatmapDay {
  date: string;
  count: number;
}

export interface SummaryData {
  gymStreak: number;
  leetcodeThisWeek: number;
  leetcodeTotal: number;
  upcomingInterviews: number;
  nextSchoolDeadline: SchoolTask | null;
  monthIncome: number;
  monthExpense: number;
  monthNet: number;
  cryptoValue: number;
  cryptoCount: number;
  checklistDoneToday: number;
  checklistTotalToday: number;
  heatmap: HeatmapDay[];
}

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | "Applied"
  | "OA"
  | "Phone Screen"
  | "Technical"
  | "Onsite"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

export interface Application {
  id: number;
  company: string;
  role: string | null;
  /** Cached projection of application_events — written only by applyEvent(). */
  status: ApplicationStatus;
  applied_date: string | null;
  next_action_date: string | null;
  next_action_label: string | null;
  location: string | null;
  url: string | null;
  notes: string | null;
  source: string;
  /** 1 once you set the status by hand; ingestion then leaves it alone. */
  status_locked: 0 | 1;
  last_activity_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplicationEvent {
  id: number;
  application_id: number;
  kind: "created" | "status_change" | "note" | "deadline";
  from_status: string | null;
  to_status: string | null;
  occurred_on: string;
  detail: string | null;
  source: string;
  external_event_id: number | null;
  confidence: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Ingestion + Inbox
// ---------------------------------------------------------------------------

export interface Integration {
  id: number;
  provider: string;
  status: "disconnected" | "connected" | "error";
  account_label: string | null;
  cursor: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalEvent {
  id: number;
  integration_id: number | null;
  provider: string;
  provider_message_id: string;
  thread_id: string | null;
  occurred_at: string | null;
  subject: string | null;
  sender: string | null;
  snippet: string | null;
  processing_status: "pending" | "processed" | "ignored" | "failed";
  classification: string | null;
  confidence: number | null;
  error: string | null;
  ingested_at: string;
  processed_at: string | null;
}

export interface InboxItem {
  id: number;
  kind: string;
  title: string;
  detail: string | null;
  severity: "info" | "attention" | "urgent";
  application_id: number | null;
  external_event_id: number | null;
  proposed_status: string | null;
  confidence: number | null;
  state: "open" | "confirmed" | "dismissed";
  dedupe_key: string;
  created_at: string;
  resolved_at: string | null;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/** One thing competing for attention today, already ranked by the server. */
export interface TodayItem {
  id: string;
  kind: "school" | "career" | "checklist" | "money" | "habit";
  title: string;
  detail: string | null;
  /** Lower sorts first. Computed server-side so every surface agrees. */
  urgency: number;
  dueDate: string | null;
  href: string;
}

export interface TodayData {
  date: string;
  items: TodayItem[];
  inboxOpenCount: number;
  gymStreak: number;
  checklistDoneToday: number;
  checklistTotalToday: number;
  monthNet: number;
  netWorthSnapshot: number;
  /** Null unless an AI provider is configured — the page never depends on it. */
  briefing: string | null;
}
