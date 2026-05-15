import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createLifeArea, listLifeAreas } from "@/lib/repository";
import { lifeAreaInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return dataResponse(await listLifeAreas(user.id));
  } catch (error) {
    return errorResponse(error, "Could not load life areas.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = lifeAreaInputSchema.parse(await readJson(request));
    return dataResponse(await createLifeArea(user.id, input), 201);
  } catch (error) {
    return errorResponse(error, "Could not create life area.");
  }
}
