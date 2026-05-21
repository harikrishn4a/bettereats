import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Clock, Star, RefreshCw, ChevronRight, Plus } from "lucide-react";
import apiService, { type MealSuggestion, type MacroResult } from "@/services/api";
import { Shimmer } from "./shimmer";
import logo from "@/assets/logo.svg";

type MealType = "breakfast" | "lunch" | "dinner";

const MEAL_TABS: { key: MealType; label: string; emoji: string }[] = [
  { key: "breakfast", label: "Breakfast", emoji: "🌅" },
  { key: "lunch",    label: "Lunch",     emoji: "☀️"  },
  { key: "dinner",   label: "Dinner",    emoji: "🌙" },
];

// Score → colour
function scoreColor(score: number): string {
  if (score >= 85) return "text-green-400";
  if (score >= 65) return "oklch(0.7 0.14 42)";
  return "text-muted-foreground";
}

interface MealCardProps {
  suggestion: MealSuggestion;
}

function MealCard({ suggestion: s }: MealCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground text-sm leading-snug">{s.meal_name}</p>
          <p className="text-muted-foreground text-xs mt-0.5">{s.restaurant_name}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-foreground text-sm">SGD {s.price_sgd.toFixed(2)}</p>
          <div className="flex items-center justify-end gap-1 mt-0.5">
            <Star className="h-3 w-3 text-primary fill-primary" />
            <span className="text-xs text-muted-foreground">{s.restaurant_rating.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Macro pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          { label: "cal",     value: s.estimated_calories,         unit: "kcal" },
          { label: "protein", value: Math.round(s.estimated_protein_g), unit: "g" },
          { label: "carbs",   value: Math.round(s.estimated_carbs_g),   unit: "g" },
          { label: "fat",     value: Math.round(s.estimated_fat_g),     unit: "g" },
        ].map(({ label, value, unit }) => (
          <span key={label}
            className="text-xs px-2 py-0.5 rounded-full border border-border/60 bg-muted text-muted-foreground">
            {value}{unit} {label}
          </span>
        ))}
      </div>

      {/* Match score + delivery */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="text-xs font-semibold"
            style={{ color: s.match_score >= 85 ? "#4ade80" : s.match_score >= 65 ? "oklch(0.7 0.14 42)" : undefined }}
          >
            {s.match_score}% match
          </span>
          <span className="text-xs text-muted-foreground">· {s.match_explanation}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span className="text-xs">{s.delivery_time_mins} min</span>
        </div>
      </div>

      {/* Order button */}
      <a
        href={s.grab_meal_url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        Order on Grab
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

interface MealSuggestionsProps {
  userId: string;
  macros: MacroResult;
  onUpdatePreferences: () => void;
}

export default function MealSuggestions({ userId, macros, onUpdatePreferences }: MealSuggestionsProps) {
  const [activeTab, setActiveTab] = useState<MealType>("lunch");
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);
  const [searchSource, setSearchSource] = useState<"grab" | "fallback" | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async (mealType: MealType, signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setSuggestions([]);
    setSearchSource(null);
    setStatusMessage(null);
    try {
      const res = await apiService.suggestions.get(userId, mealType);
      if (signal?.aborted) return;
      setSuggestions(res.suggestions);
      setSearchSource(res.search_source);
      setStatusMessage(res.message);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSuggestions(activeTab, controller.signal);
    return () => controller.abort();
  }, [activeTab, fetchSuggestions]);

  const m = macros.macros;

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">

      {/* Header */}
      <header className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <h1 className="flex items-center gap-2.5 flex-1 min-w-0">
          <img src={logo} alt="bettereats" className="w-7 h-7 shrink-0" />
          <span className="text-[1.05rem] font-bold tracking-tight leading-none">bettereats</span>
        </h1>
        <button
          onClick={onUpdatePreferences}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Update preferences
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">

          {/* Macro summary bar */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Your daily targets</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Calories", value: m.calories,  unit: "kcal", color: "text-primary" },
                { label: "Protein",  value: m.protein_g, unit: "g",    color: "text-indigo-400" },
                { label: "Carbs",    value: m.carbs_g,   unit: "g",    color: "text-emerald-400" },
                { label: "Fat",      value: m.fat_g,     unit: "g",    color: "text-amber-400" },
              ].map(({ label, value, unit, color }) => (
                <div key={label}>
                  <p className={`text-base font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{unit}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Meal type tabs */}
          <div className="flex gap-2">
            {MEAL_TABS.map(({ key, label, emoji }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  "flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors border",
                  activeTab === key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                ].join(" ")}
              >
                {emoji} {label}
              </button>
            ))}
          </div>

          {/* Suggestions */}
          {statusMessage && !isLoading && !error && (
            <p className={`text-xs px-3 py-2 rounded-lg border ${
              searchSource === "grab"
                ? "border-green-500/30 bg-green-500/10 text-green-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
            }`}>
              {searchSource === "grab" ? "✓ Live from Grab" : "⚠ Curated picks"} — {statusMessage}
            </p>
          )}

          {isLoading ? (
            <div className="flex flex-col gap-3 mt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-4">
                  <Shimmer>Finding meals that fit your plan…</Shimmer>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-border bg-card p-5 text-center flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                onClick={() => void fetchSuggestions(activeTab)}
                className="flex items-center gap-1.5 mx-auto text-xs text-primary hover:text-primary/80"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {suggestions.map((s) => (
                <MealCard key={s.rank} suggestion={s} />
              ))}

              {suggestions.length > 0 && (
                <button
                  onClick={() => void fetchSuggestions(activeTab)}
                  className="flex items-center justify-center gap-1.5 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh suggestions
                </button>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
