import { NextResponse } from "next/server";

import type { AdpDensityPayload, ApiErrorPayload } from "@/shared/contract";
import { getDraftDensity } from "@/shared/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crawled drafts per calendar month — the shape the ADP board's date range is
 * chosen against.
 *
 *   GET /api/adp/density
 *
 * It takes no parameters, and that is the point rather than an omission. Its one
 * caller is the ADP drawer's window control, which draws these counts as the
 * resting sparkline and the panel's channel; narrowing them by the drawer's
 * live filters would reshape the readout under the hand using them. What it
 * describes is therefore the population *before* any board filter — which is
 * also what makes it cacheable and fetched once per drawer rather than once per
 * chip.
 *
 * A cache-backed read like its sibling `/api/adp`: it answers from what the
 * league crawler has stored and syncs nothing of its own.
 */
export async function GET() {
  try {
    const months = await getDraftDensity();
    const payload: AdpDensityPayload = { months };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[adp/density] query failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load draft activity" };
    return NextResponse.json(payload, { status: 500 });
  }
}
