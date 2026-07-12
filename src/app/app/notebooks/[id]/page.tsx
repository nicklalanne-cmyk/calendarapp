import NotebookEditor from "@/components/notebooks/NotebookEditor";

export const dynamic = "force-dynamic";

export default function SingleNotebookPage({ params }: { params: { id: string } }) {
  return <NotebookEditor notebookId={params.id} />;
}
