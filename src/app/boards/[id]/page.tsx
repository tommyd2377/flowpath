import { BoardDetailView } from "@/components/board-detail-view";

export default async function BoardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BoardDetailView boardId={Number(id)} />;
}
