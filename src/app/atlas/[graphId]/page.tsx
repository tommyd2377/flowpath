import { Suspense } from "react";

import { AtlasView } from "../../../components/atlas-view";

export default async function AtlasPage({
  params,
}: {
  params: Promise<{ graphId: string }>;
}) {
  const { graphId } = await params;
  return (
    <Suspense fallback={<div className="route-loading"><div className="spinner" /><p>Opening atlas…</p></div>}>
      <AtlasView key={graphId} graphId={graphId} />
    </Suspense>
  );
}
