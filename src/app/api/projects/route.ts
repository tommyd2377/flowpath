import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { createProject, listProjects } from "@/lib/repository";
import { projectInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return dataResponse(await listProjects());
  } catch (error) {
    return errorResponse(error, "Could not load projects.");
  }
}

export async function POST(request: Request) {
  try {
    const input = projectInputSchema.parse(await readJson(request));
    return dataResponse(await createProject(input), 201);
  } catch (error) {
    return errorResponse(error, "Could not create project.");
  }
}
