"use client";

// Split out of NotesView and loaded via next/dynamic so react-markdown +
// remark-gfm (and their transitive parser deps) only download when someone
// actually opens Preview mode, instead of sitting in every Notes page load.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function NotePreview({
  body,
  onToggleCheckbox,
}: {
  body: string;
  onToggleCheckbox: (line1Indexed: number) => void;
}) {
  return (
    <div className="prose-cadence flex-1 overflow-y-auto text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          input: ({ node, ...props }) => {
            if (props.type !== "checkbox") return <input {...props} />;
            const line = (node as unknown as { position?: { start?: { line?: number } } })
              ?.position?.start?.line;
            return (
              <input
                {...props}
                disabled={false}
                onChange={() => (line ? onToggleCheckbox(line) : undefined)}
                className="mr-1.5 h-3.5 w-3.5 accent-accent"
              />
            );
          },
        }}
      >
        {body || "*Nothing yet.*"}
      </ReactMarkdown>
    </div>
  );
}
