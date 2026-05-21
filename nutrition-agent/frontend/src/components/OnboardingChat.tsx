import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp } from "lucide-react";
import { Message, MessageContent, MessageResponse } from "./message";
import { Conversation, ConversationContent, ConversationScrollButton } from "./conversation";
import { Shimmer } from "./shimmer";
import apiService, {
  type ConversationItem,
  type MacroResult,
} from "@/services/api";
import logo from "@/assets/logo.svg";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  age: "age",
  weight_kg: "weight",
  height_cm: "height",
  gender: "gender",
  activity_level: "activity level",
  diet_goal: "nutrition goal",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

// Extract missing field names from a FastAPI 422 error message like:
// "422 {"detail":"Cannot calculate macros — missing: ['age', 'weight_kg']"}"
function parseMissingFields(errorText: string): string[] {
  try {
    // Try to parse JSON body
    const jsonStart = errorText.indexOf("{");
    if (jsonStart !== -1) {
      const body = JSON.parse(errorText.slice(jsonStart)) as { detail?: string };
      const detail = body.detail ?? "";
      const match = detail.match(/\[([^\]]+)\]/);
      if (match) {
        return match[1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
      }
    }
    // Fallback: look for bracket list in plain text
    const match = errorText.match(/\[([^\]]+)\]/);
    if (match) {
      return match[1].split(",").map((s) => s.trim().replace(/['"]/g, ""));
    }
  } catch {}
  return [];
}

// ── Step tracking ─────────────────────────────────────────────────────────────

const STEP_NUMBER: Record<string, number> = {
  greeting:        0,
  diet_goal:       1,
  activity_level:  2,
  body_stats:      3,
  taste_preferences: 4,
  budget:          5,
  meal_times:      6,
  weight_goal:     7,
  timeline:        8,
  goal_validation: 9,
  done:           10,
};
const TOTAL_STEPS = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

interface UiMessage {
  id: string;
  sender: "agent" | "user";
  text: string;
  options?: string[] | null;
}

interface OnboardingChatProps {
  userId: string;
  onComplete: (macros: MacroResult, data: Record<string, unknown>) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const DATA_KEY = "bettereats:onboarding_data:v1";

function loadSavedData(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function OnboardingChat({ userId, onComplete }: OnboardingChatProps) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [currentStep, setCurrentStep] = useState("greeting");
  const [isLoading, setIsLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  // Initialise from localStorage so a page reload doesn't lose extracted fields
  const [accumulatedData, setAccumulatedData] = useState<Record<string, unknown>>(loadSavedData);
  const [history, setHistory] = useState<ConversationItem[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initCalledRef = useRef(false); // guard against StrictMode double-invoke

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    void initConversation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist accumulated data so a page reload doesn't lose it ─────────────
  useEffect(() => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(accumulatedData));
    } catch {}
  }, [accumulatedData]);

  // ── Scroll & resize ───────────────────────────────────────────────────────

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [inputText]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addMessage = useCallback((msg: Omit<UiMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }, []);

  // ── Complete onboarding — callable from multiple places ──────────────────
  // Delays briefly so the agent's "plan locked in" message is visible first.
  const attemptComplete = useCallback(
    async (data: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        const result = await apiService.onboarding.complete(userId, data);
        // Clear persisted draft data now that it's saved
        try { localStorage.removeItem(DATA_KEY); } catch {}
        onComplete(result.macros, data);
      } catch (err: unknown) {
        const errorText = err instanceof Error ? err.message : String(err);
        const missingFields = parseMissingFields(errorText);
        if (missingFields.length > 0) {
          const labels = missingFields.map(fieldLabel).join(" and ");
          addMessage({
            sender: "agent",
            text: `I'm missing your ${labels} to finish the calculation — could you share that?`,
            options: null,
          });
          // Keep currentStep at "done" so the next user reply retries complete
          // rather than going into a regular chat step
          setCurrentStep("_retry_complete");
        } else {
          addMessage({
            sender: "agent",
            text: "Something went wrong saving your plan. Tap below to try again.",
            options: ["Save my plan"],
          });
          setCurrentStep("goal_validation");
        }
      }
    },
    [userId, onComplete, addMessage]
  );

  // ── Conversation start ────────────────────────────────────────────────────

  const initConversation = async () => {
    setIsLoading(true);
    try {
      const { agent_response } = await apiService.onboarding.start(userId);
      addMessage({
        sender: "agent",
        text: agent_response.agent_message,
        options: agent_response.options,
      });
      setCurrentStep(agent_response.next_step);
      setHistory([
        { sender: "agent", message: agent_response.agent_message, timestamp: new Date().toISOString() },
      ]);
    } catch {
      addMessage({
        sender: "agent",
        text: "Something went wrong connecting. Please refresh and try again.",
        options: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Send a message (text or MCQ selection) ────────────────────────────────

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isLoading) return;

      const now = new Date().toISOString();

      // Show user bubble immediately
      addMessage({ sender: "user", text: userText, options: null });
      setInputText("");
      setIsLoading(true);

      const updatedHistory: ConversationItem[] = [
        ...history,
        { sender: "user", message: userText, timestamp: now },
      ];

      // ── Recovery path: user provided a missing field, retry complete ────────
      if (currentStep === "_retry_complete") {
        const retryData = { ...accumulatedData, _user_provided: userText };
        setHistory(updatedHistory);
        addMessage({
          sender: "agent",
          text: "Got it! Saving your plan now…",
          options: null,
        });
        setIsLoading(false);
        void attemptComplete(retryData);
        return;
      }

      try {
        const { agent_response, current_step: nextStep } = await apiService.onboarding.chat(
          userId,
          userText,
          currentStep,
          updatedHistory,
          accumulatedData,
        );

        // Merge any newly extracted data
        const newData = agent_response.extracted_data
          ? { ...accumulatedData, ...agent_response.extracted_data }
          : accumulatedData;

        setAccumulatedData(newData);
        setCurrentStep(nextStep);

        const agentHistoryItem: ConversationItem = {
          sender: "agent",
          message: agent_response.agent_message,
          timestamp: new Date().toISOString(),
          extracted_data: agent_response.extracted_data ?? null,
        };
        setHistory([...updatedHistory, agentHistoryItem]);

        addMessage({
          sender: "agent",
          text: agent_response.agent_message,
          options: agent_response.options,
        });

        // "done" means user confirmed the goal plan — save to DB
        if (nextStep === "done") {
          void attemptComplete(newData);
        }
      } catch {
        addMessage({
          sender: "agent",
          text: "Sorry, I had a hiccup. Could you say that again?",
          options: null,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, history, currentStep, accumulatedData, userId, addMessage, onComplete]
  );

  // ── Input handlers ────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputText);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  };

  // ── Derived display state ─────────────────────────────────────────────────

  const lastMessage = messages[messages.length - 1];
  // Show MCQ pills only when the last agent message has options and we're not loading
  const showMCQ =
    lastMessage?.sender === "agent" &&
    !!lastMessage.options?.length &&
    !isLoading;
  // Show text input when no MCQ pending and conversation is ongoing
  const showTextInput = !showMCQ && currentStep !== "done";

  const stepNumber = STEP_NUMBER[currentStep] ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <h1 className="flex items-center gap-2.5 flex-1 min-w-0">
          <img src={logo} alt="bettereats" className="w-7 h-7 shrink-0" />
          <span className="text-[1.05rem] font-bold tracking-tight leading-none">bettereats</span>
          <span className="text-muted-foreground text-sm hidden sm:block">
            setting up your preferences
          </span>
        </h1>

        {/* Step badge — only show once conversation has started */}
        {stepNumber > 0 && stepNumber < TOTAL_STEPS && (
          <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full shrink-0">
            Step {stepNumber} of {TOTAL_STEPS}
          </span>
        )}
      </header>

      {/* ── Progress bar ── */}
      {stepNumber > 0 && (
        <div className="h-0.5 bg-border shrink-0">
          <div
            className="h-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min((stepNumber / TOTAL_STEPS) * 100, 100)}%` }}
          />
        </div>
      )}

      {/* ── Messages ── */}
      <Conversation>
        <ConversationContent ref={scrollRef} onScroll={handleScroll}>
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">

            {messages.map((msg) => (
              <Message key={msg.id} from={msg.sender === "agent" ? "assistant" : "user"}>
                <MessageContent>
                  {msg.sender === "agent" ? (
                    <MessageResponse>{msg.text}</MessageResponse>
                  ) : (
                    <p className="whitespace-pre-wrap leading-relaxed text-sm">{msg.text}</p>
                  )}
                </MessageContent>
              </Message>
            ))}

            {/* MCQ option pills — shown only after the latest agent message */}
            {showMCQ && (
              <div className="flex flex-wrap gap-2">
                {lastMessage.options!.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => void sendMessage(opt)}
                    className="px-4 py-2 rounded-full border border-border/70 bg-card/60 text-sm text-foreground
                               hover:border-primary/50 hover:bg-card transition-all
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {/* Thinking indicator */}
            {isLoading && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer>Thinking…</Shimmer>
                </MessageContent>
              </Message>
            )}

          </div>
        </ConversationContent>

        <ConversationScrollButton
          show={showScrollBtn}
          onClick={() =>
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
          }
        />
      </Conversation>

      {/* ── Text input — hidden during MCQ steps ── */}
      {showTextInput && (
        <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
            <div className="rounded-2xl border border-border/70 bg-card shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-primary/40 focus-within:border-primary/40 transition-[border-color,box-shadow] duration-150">
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response…"
                rows={1}
                disabled={isLoading}
                autoFocus
                className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                style={{ minHeight: "44px", maxHeight: "160px" }}
              />
              <div className="flex items-center justify-end px-3 pb-3">
                <button
                  onClick={() => void sendMessage(inputText)}
                  disabled={!inputText.trim() || isLoading}
                  aria-label="Send"
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground
                             hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed
                             transition-[opacity,background-color] duration-150
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
