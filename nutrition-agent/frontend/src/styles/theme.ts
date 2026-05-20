export const theme = {
  colors: {
    background:           "#0a0e27",
    surface:              "#1a1f3a",
    surfaceElevated:      "#252b4a",
    border:               "#2d3561",
    accentPrimary:        "#6366f1",  // indigo
    accentSecondary:      "#f97316",  // orange
    accentSecondaryMuted: "rgba(249, 115, 22, 0.15)",
    accentPrimaryMuted:   "rgba(99, 102, 241, 0.15)",
    textPrimary:          "#f1f5f9",
    textSecondary:        "#94a3b8",
    textMuted:            "#64748b",
    success:              "#10b981",
    warning:              "#f59e0b",
    error:                "#ef4444",
  },
  radii: {
    sm:   "6px",
    md:   "12px",
    lg:   "16px",
    xl:   "24px",
    full: "9999px",
  },
  fonts: {
    base: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, sans-serif',
  },
  shadows: {
    card: "0 4px 24px rgba(0,0,0,0.35)",
  },
} as const;

export type Theme = typeof theme;
