const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postQuery<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
  ).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConversationItem {
  sender: "agent" | "user";
  message: string;
  timestamp: string;
  extracted_data?: Record<string, unknown> | null;
}

export interface AgentResponse {
  agent_message: string;
  options: string[] | null;
  extracted_data: Record<string, unknown> | null;
  next_step: string;
  is_complete: boolean;
  needs_clarification: boolean;
  calculated_macros: MacroResult | null;
}

export interface MacroBreakdown {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MacroResult {
  bmr: number;
  tdee: number;
  adjusted_calories: number;
  macros: MacroBreakdown;
}

export interface OnboardingCompleteResponse {
  status: string;
  macros: MacroResult;
  message: string;
}

export interface MealSuggestion {
  rank: number;
  meal_name: string;
  restaurant_name: string;
  price_sgd: number;
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  match_score: number;
  match_explanation: string;
  grab_meal_url: string;
  restaurant_rating: number;
  delivery_time_mins: number;
}

export interface SuggestionsResponse {
  meal_type: string;
  suggestions: MealSuggestion[];
  message: string;
  search_source: "grab" | "fallback";
}

interface ChatPayload {
  agent_response: AgentResponse;
  current_step: string;
}

// ── API service ───────────────────────────────────────────────────────────────

const onboarding = {
  start: (userId: string) =>
    post<ChatPayload>("/onboarding/start", { user_id: userId }),

  chat: (
    userId: string,
    message: string,
    currentStep: string,
    conversationHistory: ConversationItem[],
    accumulatedData: Record<string, unknown>,
  ) =>
    post<ChatPayload>("/onboarding/chat", {
      user_id: userId,
      message,
      current_step: currentStep,
      conversation_history: conversationHistory,
      accumulated_data: accumulatedData,
    }),

  complete: (userId: string, accumulatedData: Record<string, unknown>) =>
    post<OnboardingCompleteResponse>("/onboarding/complete", {
      user_id: userId,
      accumulated_data: accumulatedData,
    }),
};

const suggestions = {
  // Default location: Singapore city centre (Tanjong Pagar)
  get: (userId: string, mealType: "breakfast" | "lunch" | "dinner",
        lat = 1.2763, lon = 103.8451) =>
    postQuery<SuggestionsResponse>("/suggest", {
      user_id: userId,
      meal_type: mealType,
      latitude: lat,
      longitude: lon,
    }),
};

export default { onboarding, suggestions };
