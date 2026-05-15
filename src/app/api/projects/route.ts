import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createProject, listProjects } from "@/lib/repository";
import { projectInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return dataResponse(await listProjects(user.id));
  } catch (error) {
    return errorResponse(error, "Could not load projects.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = projectInputSchema.parse(await readJson(request));
    return dataResponse(await createProject(user.id, input), 201);
  } catch (error) {
    return errorResponse(error, "Could not create project.");
  }
}
