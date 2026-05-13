import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { createLifeArea, listLifeAreas } from "@/lib/repository";
import { lifeAreaInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return dataResponse(await listLifeAreas());
  } catch (error) {
    return errorResponse(error, "Could not load life areas.");
  }
}

export async function POST(request: Request) {
  try {
    const input = lifeAreaInputSchema.parse(await readJson(request));
    return dataResponse(await createLifeArea(input), 201);
  } catch (error) {
    return errorResponse(error, "Could not create life area.");
  }
}
