"""
goal_validation_agent.py
Validates goal realism, calculates goal-adjusted macros, and generates a warm
conversational message that presents the full nutrition plan as a chat bubble.
Called automatically by process_chat after the timeline step.
"""

from typing import Any
import anthropic
from agents.macro_calculator import calculate_macros, adjust_macros_for_goal

async_client = anthropic.AsyncAnthropic()

# 1 kg of body fat ≈ 7,700 kcal
KCAL_PER_KG = 7_700.0


def _assess_realism(daily_delta_kcal: float) -> tuple[str, str]:
    """Classify the daily calorie swing and return (status, one-sentence note for Claude)."""
    abs_val = abs(daily_delta_kcal)
    if abs_val < 250:
        return (
            "conservative",
            "This is a very gradual pace — sustainable and low-stress on your body.",
        )
    elif abs_val <= 750:
        return (
            "realistic",
            "This is a well-paced, sustainable rate — you'll see real, lasting progress.",
        )
    else:
        return (
            "aggressive",
            (
                f"This is ambitious. A more sustainable pace would be around "
                f"{int(abs_val * 0.65)} kcal/day — still significant, but easier to stick to long-term."
            ),
        )


async def goal_validation_agent(accumulated_data: dict) -> dict[str, Any]:
    """
    Validates goal realism and generates the personalised plan message.

    Expects accumulated_data to contain (at minimum):
      age, weight_kg, height_cm, gender, activity_level, diet_goal,
      weight_goal_kg, weight_goal_direction, target_timeline_weeks
    """
    # ── Pull body stats ───────────────────────────────────────────────────────
    age            = int(accumulated_data.get("age", 25))
    weight_kg      = float(accumulated_data.get("weight_kg", 70))
    height_cm      = float(accumulated_data.get("height_cm", 170))
    gender         = str(accumulated_data.get("gender", "M"))
    activity_level = str(accumulated_data.get("activity_level", "moderately_active"))
    diet_goal      = str(accumulated_data.get("diet_goal", "maintain_weight"))

    weight_goal_kg  = float(accumulated_data.get("weight_goal_kg", 0))
    goal_direction  = str(accumulated_data.get("weight_goal_direction", "loss"))
    timeline_weeks  = max(1, int(accumulated_data.get("target_timeline_weeks", 12)))

    # ── Baseline macros (TDEE, BMR) ───────────────────────────────────────────
    base = calculate_macros(age, weight_kg, height_cm, gender, activity_level, diet_goal)
    tdee = float(base["tdee"])

    # ── Calorie delta for weight goal ─────────────────────────────────────────
    has_weight_goal = weight_goal_kg > 0 and diet_goal in ("build_muscle", "fat_loss")

    if has_weight_goal:
        weekly_kcal  = (weight_goal_kg * KCAL_PER_KG) / timeline_weeks
        daily_delta  = weekly_kcal / 7.0
        # Positive delta = calorie surplus (gain), negative = deficit (loss)
        signed_delta = daily_delta if goal_direction == "gain" else -daily_delta
        weekly_rate  = weight_goal_kg / timeline_weeks
        realism, realism_note = _assess_realism(daily_delta)
        adjusted_macros = adjust_macros_for_goal(
            maintenance_calories=tdee,
            daily_delta_kcal=signed_delta,
            goal_direction=goal_direction,
        )
    else:
        # No specific weight target — use diet_goal base macros
        weekly_kcal  = 0.0
        daily_delta  = 0.0
        weekly_rate  = 0.0
        realism      = "realistic"
        realism_note = "Your plan is calibrated to your activity level and goals."
        adjusted_macros = base["macros"]

    # ── Build warm message via Claude ─────────────────────────────────────────
    direction_label = "gain" if goal_direction == "gain" else "lose"
    trend_label     = "surplus" if goal_direction == "gain" else "deficit"

    if has_weight_goal:
        goal_context = (
            f"WEIGHT GOAL: {direction_label} {weight_goal_kg}kg in {timeline_weeks} weeks "
            f"({weekly_rate:.2f} kg/week, {int(daily_delta)} kcal/day {trend_label})\n"
            f"REALISM: {realism} — {realism_note}"
        )
    else:
        goal_context = "GOAL: No specific weight target — plan calibrated to activity and general goals."

    prompt = f"""You are Better Eats Assistant. The user has finished setting their preferences.
Write a warm, personal message presenting their adjusted nutrition plan.

{goal_context}

DAILY MACRO PLAN (use these exact numbers):
  Calories : {adjusted_macros['calories']} kcal  (maintenance TDEE: {int(tdee)} kcal)
  Protein  : {adjusted_macros['protein_g']}g
  Carbs    : {adjusted_macros['carbs_g']}g
  Fat      : {adjusted_macros['fat_g']}g

STRUCTURE YOUR MESSAGE AS:
1. One sentence reacting warmly to their goal using their actual numbers.
2. One sentence on realism — weave in the assessment naturally (not clinical).
3. Show the macro plan clearly with line breaks for each item.
4. End with exactly: "Ready to find meals on Grab that fit this plan?"

TONE RULES:
- Plain text, line breaks for structure — NO markdown headers or bullet characters
- At most 2 emojis total
- Sound like an excited, knowledgeable friend, not a nutrition app
- Under 180 words

Return ONLY the message text."""

    response = await async_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )

    agent_message = response.content[0].text.strip()

    # ── Return structured response ────────────────────────────────────────────
    return {
        "agent_message": agent_message,
        "options": ["Let's find meals! 🍜", "Adjust these numbers"],
        "extracted_data": {
            "adjusted_macros":        adjusted_macros,
            "realism_status":         realism,
            "weekly_deficit_kcal":    round(weekly_kcal),
            "daily_deficit_kcal":     round(daily_delta),
            "maintenance_calories":   round(tdee),
        },
        "next_step": "goal_validation",
        "is_complete": False,
        "needs_clarification": False,
        "calculated_macros": adjusted_macros,
    }
