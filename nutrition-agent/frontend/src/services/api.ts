// Vite proxy in vite.config.ts forwards /onboarding/* → http://localhost:8000 in dev.
// In production set VITE_API_URL to the backend base URL.
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

// ── Shared types ──────────────────────────────────────────────────────────────

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

export default { onboarding };
