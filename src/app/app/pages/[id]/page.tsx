import PageView from "@/components/pages/PageView";

export const dynamic = "force-dynamic";

export default function SinglePage({ params }: { params: { id: string } }) {
  return <PageView pageId={params.id} />;
}
