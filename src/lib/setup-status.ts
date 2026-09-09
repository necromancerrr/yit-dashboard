import { db } from "@/lib/db";
import { getAIProvider, getVisionProvider } from "@/lib/ai";
import { todayISO } from "@/lib/date";
import { parseMode, TRUST_PROMOTION } from "@/lib/autonomy/policy";
import { trustSummary } from "@/lib/autonomy/trust";

/**
 * What the app can see about its own configuration.
 *
 * Every capability here depends on an environment variable set somewhere the
 * app cannot show you — a hosting dashboard, a `.env` file. So "will Scan
 * work?" and "is my data going to survive a redeploy?" are questions the
 * dashboard currently cannot answer about itself, and the owner has to guess.
 * This makes the answers visible.
 *
 * **Hard rule: this module never returns a secret, or any part of one.**
 * Booleans, provider names, and counts only. A diagnostics endpoint that leaks
 * the key it is reporting on is the classic own-goal, so the shape is designed
 * to make it impossible rather than merely avoided — there is no field here
 * that could hold a key even by mistake. `tests/setup-status.test.ts` asserts
 * no environment value appears in the output.
 */

export type CheckLevel = "ok" | "warn" | "off";

export interface SetupCheck {
  id: string;
  /** Short label, e.g. "Screenshot reading". */
  title: string;
  level: CheckLevel;
  /** What is true right now, in plain language. */
  status: string;
  /** What it costs you, and what to do — only when something is wrong. */
  fix: string | null;
}

export interface SetupStatus {
  checks: SetupCheck[];
  /** True when at least one check would cost the owner data or money. */
  needsAttention: boolean;
}

function databaseCheck(): SetupCheck {
  const url = process.env.DATABASE_URL?.trim();
  const remote = !!url && !url.startsWith("file:");

  if (remote) {
    return {
      id: "database",
      title: "Database",
      level: "ok",
      status: "Hosted database — your data survives redeploys.",
      fix: null,
    };
  }
  return {
    id: "database",
    title: "Database",
    level: "warn",
    // The failure that actually costs data, so it is stated as a consequence
    // rather than as a setting.
    status: "Local file. Fine on your own machine.",
    fix: "If this is deployed to Vercel, everything you add will be erased on the next deploy. Point DATABASE_URL at a hosted libSQL/Turso database.",
  };
}

function textAICheck(): SetupCheck {
  const provider = getAIProvider();
  if (provider) {
    return {
      id: "text-ai",
      title: "Email sorting",
      level: "ok",
      status: `On, using ${provider.name}.`,
      fix: null,
    };
  }
  return {
    id: "text-ai",
    title: "Email sorting",
    level: "off",
    status: "Off. Email still syncs, but nothing is classified by a model.",
    fix: "Set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) to turn it on. Rules-based sorting keeps working either way.",
  };
}

function visionCheck(): SetupCheck {
  const provider = getVisionProvider();
  if (provider) {
    return {
      id: "vision-ai",
      title: "Screenshot reading (Scan)",
      level: "ok",
      status: `On, using ${provider.name}.`,
      fix: null,
    };
  }
  return {
    id: "vision-ai",
    title: "Screenshot reading (Scan)",
    level: "off",
    // Naming the reason matters: the owner has a DeepSeek key and reasonably
    // expects it to cover this.
    status: "Off. Scan cannot read a screenshot.",
    fix: "This needs a model that can see images. DeepSeek's chat models are text-only, so set ANTHROPIC_API_KEY — it is used only for screenshots, roughly a cent each, while everything else stays on your text provider.",
  };
}

function timezoneCheck(): SetupCheck {
  const zone = process.env.APP_TIMEZONE?.trim();
  if (zone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: zone });
      return {
        id: "timezone",
        title: "Your day",
        level: "ok",
        status: `Rolls over in ${zone}. Today is ${todayISO()}.`,
        fix: null,
      };
    } catch {
      return {
        id: "timezone",
        title: "Your day",
        level: "warn",
        status: `APP_TIMEZONE is set to "${zone}", which is not a timezone name.`,
        fix: "Use an IANA name like America/New_York. Until then the server's own timezone is used.",
      };
    }
  }
  return {
    id: "timezone",
    title: "Your day",
    level: "warn",
    status: `Using the server's timezone. Today is ${todayISO()} here.`,
    fix: "If that date is wrong, set APP_TIMEZONE (e.g. America/New_York). Streaks, deadlines and the daily checklist all key off it. Note that TZ does not work on Vercel — it is a reserved name there.",
  };
}

function passwordCheck(): SetupCheck {
  if (process.env.APP_PASSWORD_HASH?.trim()) {
    return {
      id: "password",
      title: "Sign-in",
      level: "ok",
      status: "Password is stored as a bcrypt hash.",
      fix: null,
    };
  }
  if (process.env.APP_PASSWORD?.trim()) {
    return {
      id: "password",
      title: "Sign-in",
      level: "warn",
      status: "Password is stored as plain text.",
      fix: "Fine locally. If this is on the internet, run `node scripts/hash-password.mjs \"your password\"` and put the result in APP_PASSWORD_HASH instead.",
    };
  }
  // Unreachable in practice — you could not have signed in to read this.
  return {
    id: "password",
    title: "Sign-in",
    level: "off",
    status: "No password is configured.",
    fix: "Set APP_PASSWORD_HASH or APP_PASSWORD.",
  };
}

async function passkeyCheck(): Promise<SetupCheck> {
  const result = await db.execute("SELECT COUNT(*) AS c FROM passkeys");
  const count = Number(result.rows[0]?.c ?? 0);
  if (count > 0) {
    return {
      id: "passkeys",
      title: "Face ID / Touch ID",
      level: "ok",
      status: `${count} device${count === 1 ? "" : "s"} enrolled.`,
      fix: null,
    };
  }
  return {
    id: "passkeys",
    title: "Face ID / Touch ID",
    level: "off",
    status: "No device enrolled — password only.",
    fix: "Add this device under Security. Passkeys need HTTPS and are tied to the exact domain, so enrol on the address you actually use.",
  };
}

/**
 * What the mail sync is allowed to do, and whether anything can act yet.
 *
 * This check exists for one specific failure: turning `AUTOMATION_MODE=auto` on
 * and seeing nothing happen. A fresh ledger means nothing auto-applies until
 * senders have been confirmed a few times — which is correct behaviour and
 * indistinguishable from a broken switch unless the app says so out loud.
 */
async function automationCheck(): Promise<SetupCheck> {
  const mode = parseMode(process.env.AUTOMATION_MODE);

  if (mode === "off") {
    return {
      id: "automation",
      title: "Acting on email",
      level: "off",
      status: "Off. Everything from your mailbox becomes a question in the Inbox.",
      fix: "Set AUTOMATION_MODE=assist (the default) or =auto to let some of it through.",
    };
  }

  if (mode === "assist") {
    return {
      id: "automation",
      title: "Acting on email",
      level: "ok",
      status: "Career status changes apply on their own. Money and school always ask.",
      fix: null,
    };
  }

  const { trusted, learning, off } = await trustSummary();
  if (trusted === 0) {
    return {
      id: "automation",
      title: "Acting on email",
      level: "warn",
      status:
        learning > 0
          ? `On, but still learning — ${learning} sender${learning === 1 ? "" : "s"} short of the bar.`
          : "On, but no sender has earned anything yet, so nothing will be filed for you.",
      // Named as the next action rather than as a fault: nothing is broken.
      fix: `A sender acts on its own after you confirm ${TRUST_PROMOTION} of its proposals in the Inbox. Until then everything is still a question — that is the switch working, not failing.`,
    };
  }

  return {
    id: "automation",
    title: "Acting on email",
    level: "ok",
    status: `On. ${trusted} sender${trusted === 1 ? "" : "s"} can file without asking${
      learning > 0 ? `, ${learning} still learning` : ""
    }${off > 0 ? `, ${off} turned off` : ""}.`,
    fix: null,
  };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const checks: SetupCheck[] = [
    databaseCheck(),
    passwordCheck(),
    await passkeyCheck(),
    timezoneCheck(),
    await automationCheck(),
    textAICheck(),
    visionCheck(),
  ];

  // "Needs attention" means a real cost — losing data, or a wrong day — not
  // merely an optional feature being off. A nag about an unused feature is
  // how a banner earns itself a permanent dismissal.
  const needsAttention = checks.some((c) => c.level === "warn");

  return { checks, needsAttention };
}
