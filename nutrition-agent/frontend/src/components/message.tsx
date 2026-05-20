import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Message ───────────────────────────────────────────────────────────────────
// Container for a single message. User messages get a muted bubble;
// assistant messages render text directly on the canvas (no background).

interface MessageProps {
  from: "user" | "assistant";
  children: React.ReactNode;
  className?: string;
}

export function Message({ from, children, className }: MessageProps) {
  const isUser = from === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start", className)}>
      <div
        className={cn(
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-muted px-4 py-3 text-sm leading-relaxed"
            : "max-w-full"
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ── MessageContent ────────────────────────────────────────────────────────────

export function MessageContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("text-foreground", className)}>{children}</div>;
}

// ── MessageResponse ───────────────────────────────────────────────────────────
// Renders markdown for assistant messages. No bubble — text directly on canvas.

export function MessageResponse({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("prose", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
