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
