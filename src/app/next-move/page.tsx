import { NextMoveFlow } from "@/components/next-move-flow";
import { isEntryDomainId } from "@/lib/entry-domains";

type NextMovePageProps = {
  searchParams: Promise<{ domain?: string | string[] }>;
};

export default async function NextMovePage({ searchParams }: NextMovePageProps) {
  const domainParam = (await searchParams).domain;
  const domain = Array.isArray(domainParam) ? domainParam[0] : domainParam;
  const initialDomain = isEntryDomainId(domain) ? domain : null;

  return <NextMoveFlow initialDomain={initialDomain} />;
}
