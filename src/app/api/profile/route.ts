import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { getProfile, updateProfile } from "@/lib/repository";
import { profileInputSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return dataResponse(await getProfile(user.id));
  } catch (error) {
    return errorResponse(error, "Could not load profile.");
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const input = profileInputSchema.parse(await readJson(request));
    return dataResponse(await updateProfile(user.id, input));
  } catch (error) {
    return errorResponse(error, "Could not save profile.");
  }
}
