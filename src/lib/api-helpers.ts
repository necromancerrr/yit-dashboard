import { NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { ZodError } from "zod";

export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  await ensureDb();
  return fn();
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function handleRoute(fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return jsonError(err.issues.map((i) => i.message).join(", "), 422);
    }
    console.error(err);
    return jsonError("Something went wrong", 500);
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
