import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { detectMealSource } from "@/lib/meal-source";

const stringArray = z.array(z.string().min(1)).max(100).optional().nullable();

const createSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  source_url: z.string().url().optional().nullable(),
  source_author: z.string().max(200).optional().nullable(),
  cover_image_url: z.string().url().optional().nullable(),
  ingredients: stringArray,
  steps: stringArray,
  prep_min: z.coerce.number().int().nonnegative().max(10080).optional().nullable(),
  cook_min: z.coerce.number().int().nonnegative().max(10080).optional().nullable(),
  servings: z.coerce.number().int().positive().max(100).optional().nullable(),
  calories: z.coerce.number().int().nonnegative().max(20000).optional().nullable(),
  protein_g: z.coerce.number().nonnegative().max(1000).optional().nullable(),
  tags: z.string().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

function toJson(value: string[] | null | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null;
}

const COLUMNS =
  "name, source_url, platform, source_author, cover_image_url, ingredients, steps, prep_min, cook_min, servings, calories, protein_g, tags, notes";

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
    return withDb(async () => {
      const result = await db.execute({
        sql: "SELECT * FROM meal_preps ORDER BY created_at DESC, id DESC LIMIT ?",
        args: [limit],
      });
      return NextResponse.json({ items: result.rows });
    });
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const body = createSchema.parse(await req.json());
    // Platform is derived from the URL, never trusted from the client — one
    // notion of "which platform", computed in one place.
    const platform = body.source_url ? detectMealSource(body.source_url)?.platform ?? null : null;
    return withDb(async () => {
      const result = await db.execute({
        sql: `INSERT INTO meal_preps (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
          body.name,
          body.source_url ?? null,
          platform,
          body.source_author ?? null,
          body.cover_image_url ?? null,
          toJson(body.ingredients),
          toJson(body.steps),
          body.prep_min ?? null,
          body.cook_min ?? null,
          body.servings ?? null,
          body.calories ?? null,
          body.protein_g ?? null,
          body.tags ?? null,
          body.notes ?? null,
        ],
      });
      return NextResponse.json({ item: result.rows[0] }, { status: 201 });
    });
  });
}
