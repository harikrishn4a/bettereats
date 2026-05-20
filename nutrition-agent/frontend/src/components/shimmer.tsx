import { cn } from "@/lib/utils";

interface ShimmerProps {
  children?: React.ReactNode;
  className?: string;
}

export function Shimmer({ children, className }: ShimmerProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground",
        className
      )}
    >
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
          />
        ))}
      </span>
      {children && <span>{children}</span>}
    </span>
  );
}
