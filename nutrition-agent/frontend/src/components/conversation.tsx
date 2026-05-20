import { useRef, forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Conversation ──────────────────────────────────────────────────────────────
// Relative-positioned flex wrapper so ConversationScrollButton can be absolute.

export function Conversation({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1 min-h-0 flex flex-col", className)}>
      {children}
    </div>
  );
}

// ── ConversationContent ───────────────────────────────────────────────────────
// The scrollable message list. Accepts a forwarded ref so the parent can
// programmatically scroll it and attach scroll event handlers.

export const ConversationContent = forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    className?: string;
    onScroll?: React.UIEventHandler<HTMLDivElement>;
  }
>(({ children, className, onScroll }, ref) => (
  <div
    ref={ref}
    onScroll={onScroll}
    className={cn("flex-1 overflow-y-auto", className)}
  >
    {children}
  </div>
));
ConversationContent.displayName = "ConversationContent";

// ── ConversationScrollButton ──────────────────────────────────────────────────
// Floats above the message list when the user has scrolled up.

export function ConversationScrollButton({
  show,
  onClick,
}: {
  show: boolean;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
      <button
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-lg hover:bg-muted transition-colors"
        aria-label="Scroll to bottom"
      >
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
    </div>
  );
}
