import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { getProfile, updateProfile } from "@/lib/repository";
import { profileInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return dataResponse(await getProfile());
  } catch (error) {
    return errorResponse(error, "Could not load profile.");
  }
}

export async function PUT(request: Request) {
  try {
    const input = profileInputSchema.parse(await readJson(request));
    return dataResponse(await updateProfile(input));
  } catch (error) {
    return errorResponse(error, "Could not save profile.");
  }
}
