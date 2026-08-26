import { getWorldRepository } from "@/lib/server/world-db";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return jsonResponse(await getWorldRepository().getCatalogSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}
