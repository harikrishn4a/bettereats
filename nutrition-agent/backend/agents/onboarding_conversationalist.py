import json
from typing import Any
import anthropic
from agents.goal_validation_agent import goal_validation_agent

async_client = anthropic.AsyncAnthropic()

# ── Step metadata ─────────────────────────────────────────────────────────────

STEPS: dict[str, dict] = {
    "greeting": {
        "purpose": "Welcome the user and build excitement",
        "options": ["Let's go! 🚀"],
        "next_step": "diet_goal",
        "extract": None,
    },
    "diet_goal": {
        "purpose": "Understand the user's primary nutrition goal",
        "options": ["Build muscle 💪", "Lose fat 🔥", "Eat healthier 🥗", "Maintain weight ⚖️"],
        "next_step": "activity_level",
        "extract": 'diet_goal: exactly one of ["build_muscle", "fat_loss", "eat_healthier", "maintain_weight"]',
    },
    "activity_level": {
        "purpose": "Gauge how active the user is day-to-day",
        "options": [
            "Sedentary (desk job, little exercise)",
            "Lightly active (1–3 days/week)",
            "Moderately active (3–5 days/week)",
            "Very active (6–7 days/week)",
        ],
        "next_step": "body_stats",
        "extract": 'activity_level: exactly one of ["sedentary", "lightly_active", "moderately_active", "very_active"]',
    },
    "body_stats": {
        "purpose": "Collect all four body stats required for macro calculation — age, weight, height, gender",
        "options": None,
        "next_step": "taste_preferences",
        "extract": (
            "Extract ALL FOUR fields. If ANY are missing, set needs_clarification=true and ask specifically.\n"
            "• age (integer, years — REQUIRED. If not provided, ask: 'And how old are you?')\n"
            "• weight_kg (float — convert lbs×0.4536 if in pounds)\n"
            "• height_cm (float — convert feet/inches: total inches × 2.54)\n"
            '• gender ("M" or "F" — infer from male/female/man/woman/he/she)\n'
            "Only advance (next_step='taste_preferences') once all four are present."
        ),
    },
    "taste_preferences": {
        "purpose": "Learn what foods the user loves and wants to avoid",
        "options": None,
        "next_step": "budget",
        "extract": "taste_profile: {likes: [list of strings], dislikes: [list of strings]}",
    },
    "budget": {
        "purpose": "Get a realistic weekly food budget",
        "options": None,
        "next_step": "meal_times",
        "extract": "weekly_budget_sgd (float — if USD multiply ×1.35, if GBP ×1.70, no currency → assume SGD)",
    },
    "meal_times": {
        "purpose": "Set preferred meal times for breakfast, lunch, dinner",
        "options": [
            "7am · 12pm · 7pm",
            "7am · 1pm · 8pm",
            "8am · 12pm · 6pm",
            "Custom times",
        ],
        "next_step": "weight_goal",   # ← leads into goal-setting flow
        "extract": 'meal_timings: {breakfast: "HH:MM", lunch: "HH:MM", dinner: "HH:MM"} in 24h format',
    },

    # ── Goal-setting steps (new) ──────────────────────────────────────────────

    "weight_goal": {
        "purpose": "Find out how much weight the user wants to gain or lose",
        "options": None,
        "next_step": "timeline",
        "extract": (
            "weight_goal_kg (float, always positive — e.g. '5 kilos' → 5.0)\n"
            "weight_goal_direction: infer from context:\n"
            "  • diet_goal='build_muscle' → 'gain' (unless user says otherwise)\n"
            "  • diet_goal='fat_loss'     → 'loss' (unless user says otherwise)\n"
            "  • other goals: infer from verbs ('lose/shed/drop' → 'loss', 'gain/build/add' → 'gain')\n"
            "If the user has NO specific weight target (e.g. 'just want to feel healthier'), "
            "set weight_goal_kg=0, weight_goal_direction='loss', and next_step='goal_validation'."
        ),
    },
    "timeline": {
        "purpose": "Set a realistic timeline for achieving the weight goal",
        "options": None,
        "next_step": "goal_validation",
        "extract": (
            "target_timeline_weeks (integer — convert natural language):\n"
            "  '3 months' → 12   '6 weeks' → 6   '1 year' → 52   '2 months' → 8\n"
            "Extract only this field; goal validation runs automatically after."
        ),
    },
    "goal_validation": {
        "purpose": "User responding to their personalised macro plan — confirm or adjust",
        "options": ["Let's find meals! 🍜", "Adjust these numbers"],
        "next_step": "done",
        "extract": None,  # handled specially in process_chat
    },
    "done": {
        "purpose": "Onboarding confirmed — data is being saved",
        "options": None,
        "next_step": None,
        "extract": None,
    },
}

# Preset meal time option → structured timings
MEAL_TIME_PRESETS: dict[str, dict[str, str]] = {
    "7am · 12pm · 7pm": {"breakfast": "07:00", "lunch": "12:00", "dinner": "19:00"},
    "7am · 1pm · 8pm":  {"breakfast": "07:00", "lunch": "13:00", "dinner": "20:00"},
    "8am · 12pm · 6pm": {"breakfast": "08:00", "lunch": "12:00", "dinner": "18:00"},
}


# ── Hardcoded greeting (no Claude call needed) ────────────────────────────────

async def start_onboarding() -> dict[str, Any]:
    return {
        "agent_message": (
            "Hi there! I'm your Better Eats assistant. 👋\n\n"
            "I'm going to help you discover meals you'll actually love — "
            "ones that fit your goals, taste, and budget. "
            "We'll have a quick chat and I'll put together a personalised nutrition plan just for you.\n\n"
            "Takes about 2 minutes. Ready?"
        ),
        "options": ["Let's go! 🚀"],
        "extracted_data": None,
        "next_step": "diet_goal",
        "is_complete": False,
        "needs_clarification": False,
        "calculated_macros": None,
    }


# ── Main chat processor ───────────────────────────────────────────────────────

async def process_chat(
    current_step: str,
    user_message: str,
    conversation_history: list[dict],
    accumulated_data: dict,
) -> dict[str, Any]:
    """Process a user message for the current step and return the agent's response."""

    # ── Special case: goal_validation ─────────────────────────────────────────
    # The plan has already been shown; the user is either confirming or adjusting.
    if current_step == "goal_validation":
        msg_lower = user_message.lower()
        if any(w in msg_lower for w in ["adjust", "change", "tweak", "modify", "different", "no"]):
            return {
                "agent_message": (
                    "No problem — let's revisit your target! "
                    "How much weight are you looking to gain or lose?"
                ),
                "options": None,
                "extracted_data": None,
                "next_step": "weight_goal",
                "is_complete": False,
                "needs_clarification": False,
                "calculated_macros": None,
            }
        # Confirmed → done
        return {
            "agent_message": "Your plan is locked in! Saving your preferences now. 🍴",
            "options": None,
            "extracted_data": None,
            "next_step": "done",
            "is_complete": True,
            "needs_clarification": False,
            "calculated_macros": None,
        }

    # ── Standard step processing ──────────────────────────────────────────────
    step = STEPS.get(current_step, STEPS["greeting"])

    history_text = "\n".join(
        f"{'Assistant' if item['sender'] == 'agent' else 'User'}: {item['message']}"
        for item in conversation_history[-14:]
    )

    prompt = f"""You are Better Eats Assistant — a warm, encouraging nutrition guide helping users build their personalised meal plan through a friendly 1-on-1 chat.

CURRENT STEP: {current_step}
STEP PURPOSE: {step["purpose"]}
DATA TO EXTRACT: {step.get("extract") or "none — just acknowledge and ask the next question"}
NEXT STEP: {step["next_step"] or "none"}

CONVERSATION HISTORY:
{history_text or "(start of conversation)"}

USER JUST SAID: "{user_message}"

YOUR TASK:
1. Acknowledge warmly and naturally (1 short sentence — never robotic)
2. Extract required structured data from the response
3. Ask the next question OR gently request clarification if data is missing

OPTIONS TO SHOW (null = text input):
{json.dumps(step.get("options"))}

EXTRACTION + CONVERSION RULES:
- Body stats: "6 foot 2" → 187.96 cm | "165 lbs" → 74.84 kg | "male/man/he" → "M" | "female/woman/she" → "F"
- Budget: USD ×1.35 | GBP ×1.70 | no currency → assume SGD
- Meal presets: "7am · 12pm · 7pm" → {{"breakfast":"07:00","lunch":"12:00","dinner":"19:00"}}
               "7am · 1pm · 8pm"  → {{"breakfast":"07:00","lunch":"13:00","dinner":"20:00"}}
               "8am · 12pm · 6pm" → {{"breakfast":"08:00","lunch":"12:00","dinner":"18:00"}}
- "Custom times" → needs_clarification: true, ask them to type their times
- Weight goal: "lose 10kg" → {{weight_goal_kg:10, weight_goal_direction:"loss"}}
              "gain 5 kilos" → {{weight_goal_kg:5, weight_goal_direction:"gain"}}
- Timeline: "3 months" → 12, "6 weeks" → 6, "1 year" → 52, "a month" → 4
- For weight_goal step: if user has no specific target, set weight_goal_kg=0 and next_step="goal_validation"

TONE (REQUIRED):
✅ "Love that! Spicy Asian food is a great choice."
✅ "Got it — moderately active works perfectly for the calculation!"
❌ NEVER: "Input received." / "Data recorded." / "Processing."
- Sound like a helpful friend, not a form processor
- 1 emoji max per message
- 1-sentence acknowledgement, then the next question

Return ONLY valid JSON:
{{
  "agent_message": "...",
  "options": [...] or null,
  "extracted_data": {{...}} or null,
  "next_step": "{step["next_step"] or "done"}",
  "is_complete": false,
  "needs_clarification": false,
  "calculated_macros": null
}}"""

    response = await async_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    result: dict[str, Any] = json.loads(raw.strip())

    # ── Auto-trigger goal validation after timeline extraction ─────────────────
    # Once we have the timeline, we immediately calculate and show the plan.
    if current_step == "timeline" and not result.get("needs_clarification"):
        merged = {**accumulated_data}
        if result.get("extracted_data"):
            merged.update(result["extracted_data"])

        # Run goal validation if we have enough data
        if merged.get("target_timeline_weeks") or merged.get("weight_goal_kg", 0) == 0:
            try:
                validation = await goal_validation_agent(merged)
                # Prepend the timeline acknowledgement (first sentence only)
                ack = result.get("agent_message", "").split(".")[0]
                if ack:
                    validation["agent_message"] = ack + ".\n\n" + validation["agent_message"]
                # Merge extracted_data from both steps
                validation["extracted_data"] = {
                    **(result.get("extracted_data") or {}),
                    **(validation.get("extracted_data") or {}),
                }
                return validation
            except Exception:
                # If validation fails, fall through and return normal timeline response
                pass

    return result
