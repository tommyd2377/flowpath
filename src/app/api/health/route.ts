export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "possibility-atlas" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
