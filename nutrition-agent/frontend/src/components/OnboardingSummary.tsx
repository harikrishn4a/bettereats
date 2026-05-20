import React from "react";
import { MacroResult } from "../services/api";
import { theme } from "../styles/theme";

interface SummaryData {
  diet_goal?: string;
  activity_level?: string;
  age?: number;
  weight_kg?: number;
  height_cm?: number;
  gender?: string;
  taste_profile?: { likes: string[]; dislikes: string[] };
  weekly_budget_sgd?: number;
  meal_timings?: { breakfast: string; lunch: string; dinner: string };
}

interface OnboardingSummaryProps {
  macros: MacroResult;
  accumulatedData: SummaryData;
  onContinue: () => void;
  onAdjust: () => void;
}

const GOAL_LABELS: Record<string, string> = {
  build_muscle:   "Build Muscle 💪",
  fat_loss:       "Lose Fat 🔥",
  eat_healthier:  "Eat Healthier 🥗",
  maintain_weight: "Maintain Weight ⚖️",
};

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary:          "Sedentary",
  lightly_active:     "Lightly Active",
  moderately_active:  "Moderately Active",
  very_active:        "Very Active",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function MacroTile({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: theme.colors.surfaceElevated,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.radii.md,
        padding: "16px 12px",
        textAlign: "center",
        flex: "1 1 0",
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.7rem", color: theme.colors.textMuted, marginTop: 3 }}>
        {unit}
      </div>
      <div style={{ fontSize: "0.75rem", color: theme.colors.textSecondary, marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        paddingBottom: 10,
        borderBottom: `1px solid ${theme.colors.border}`,
      }}
    >
      <span
        style={{
          color: theme.colors.textMuted,
          fontSize: "0.8rem",
          minWidth: 72,
          flexShrink: 0,
          paddingTop: 1,
        }}
      >
        {label}
      </span>
      <span style={{ color: theme.colors.textPrimary, fontSize: "0.875rem" }}>{value}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OnboardingSummary({
  macros,
  accumulatedData,
  onContinue,
  onAdjust,
}: OnboardingSummaryProps) {
  const {
    diet_goal,
    activity_level,
    age,
    weight_kg,
    height_cm,
    gender,
    taste_profile,
    weekly_budget_sgd,
    meal_timings,
  } = accumulatedData;

  const statsStr = [age && `${age} yrs`, weight_kg && `${weight_kg}kg`, height_cm && `${height_cm}cm`, gender]
    .filter(Boolean)
    .join(" · ");

  const timingsStr = meal_timings
    ? `${meal_timings.breakfast} · ${meal_timings.lunch} · ${meal_timings.dinner}`
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.colors.background,
        color: theme.colors.textPrimary,
        fontFamily: theme.fonts.base,
        overflowY: "auto",
        padding: "32px 16px 48px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ maxWidth: 520, width: "100%" }}>

        {/* ── Hero ── */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: "2.8rem", marginBottom: 14, animation: "fadeSlideIn 0.4s ease-out" }}>
            🎉
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: theme.colors.accentSecondary,
              marginBottom: 8,
            }}
          >
            Your plan is ready!
          </h1>
          <p style={{ color: theme.colors.textSecondary, fontSize: "0.95rem", lineHeight: 1.55 }}>
            Here's your personalised daily nutrition target.
          </p>
        </div>

        {/* ── Macro tiles ── */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <MacroTile label="Calories" value={macros.macros.calories} unit="kcal / day" color={theme.colors.accentSecondary} />
          <MacroTile label="Protein"  value={macros.macros.protein_g} unit="g / day" color="#818cf8" />
          <MacroTile label="Carbs"    value={macros.macros.carbs_g}   unit="g / day" color={theme.colors.success} />
          <MacroTile label="Fat"      value={macros.macros.fat_g}     unit="g / day" color={theme.colors.warning} />
        </div>

        {/* ── TDEE breakdown ── */}
        <div
          style={{
            background: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            padding: "12px 16px",
            display: "flex",
            gap: 20,
            fontSize: "0.82rem",
            color: theme.colors.textSecondary,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <span>
            BMR{" "}
            <strong style={{ color: theme.colors.textPrimary }}>{macros.bmr} kcal</strong>
          </span>
          <span>
            TDEE{" "}
            <strong style={{ color: theme.colors.textPrimary }}>{macros.tdee} kcal</strong>
          </span>
          <span>
            Target{" "}
            <strong style={{ color: theme.colors.accentSecondary }}>
              {macros.adjusted_calories} kcal
            </strong>
          </span>
        </div>

        {/* ── Profile card ── */}
        <div
          style={{
            background: theme.colors.surface,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.lg,
            padding: "20px",
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <h2
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: theme.colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            Your Profile
          </h2>
          {diet_goal    && <InfoRow label="Goal"     value={GOAL_LABELS[diet_goal] ?? diet_goal} />}
          {activity_level && <InfoRow label="Activity" value={ACTIVITY_LABELS[activity_level] ?? activity_level} />}
          {statsStr     && <InfoRow label="Stats"    value={statsStr} />}
          {taste_profile?.likes?.length   ? <InfoRow label="Loves"   value={taste_profile.likes.join(", ")} /> : null}
          {taste_profile?.dislikes?.length ? <InfoRow label="Avoids" value={taste_profile.dislikes.join(", ")} /> : null}
          {weekly_budget_sgd && <InfoRow label="Budget"  value={`SGD ${weekly_budget_sgd} / week`} />}
          {timingsStr   && <InfoRow label="Meals"    value={timingsStr} />}
        </div>

        {/* ── Actions ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={onContinue}
            style={{
              width: "100%",
              padding: "14px",
              background: theme.colors.accentSecondary,
              color: "#fff",
              border: "none",
              borderRadius: theme.radii.md,
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: theme.fonts.base,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = "#ea6c10")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background = theme.colors.accentSecondary)
            }
          >
            Let's find meals! 🍜
          </button>

          <button
            onClick={onAdjust}
            style={{
              width: "100%",
              padding: "12px",
              background: "transparent",
              color: theme.colors.textSecondary,
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              fontSize: "0.875rem",
              cursor: "pointer",
              fontFamily: theme.fonts.base,
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = theme.colors.textSecondary;
              (e.currentTarget as HTMLButtonElement).style.color = theme.colors.textPrimary;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = theme.colors.border;
              (e.currentTarget as HTMLButtonElement).style.color = theme.colors.textSecondary;
            }}
          >
            Adjust my preferences
          </button>
        </div>
      </div>
    </div>
  );
}
