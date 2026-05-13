import { SituationDetailView } from "@/components/situation-detail-view";

export default async function SituationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SituationDetailView situationId={Number(id)} />;
}
