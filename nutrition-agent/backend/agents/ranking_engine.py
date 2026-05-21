"""
Stage 4: Claude-powered meal ranking.

All candidates are batched into a single Claude prompt so we use exactly
one API call per /suggest request — cheap, fast, and consistent.
"""

from __future__ import annotations

import json
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv()

_client = anthropic.AsyncAnthropic()

# Fraction of daily macros per meal type
_MEAL_FRACTIONS: dict[str, float] = {
    "breakfast": 0.25,
    "lunch":     0.35,
    "dinner":    0.40,
}


def _meal_targets(user_prefs: dict[str, Any], meal_type: str) -> dict[str, float]:
    frac        = _MEAL_FRACTIONS.get(meal_type, 0.33)
    daily_cal   = float(user_prefs.get("target_calories") or 2000)
    daily_prot  = float(user_prefs.get("target_protein")  or 100)
    daily_carbs = float(user_prefs.get("target_carbs")    or 200)
    daily_fat   = float(user_prefs.get("target_fat")      or 65)
    return {
        "calories": round(daily_cal   * frac),
        "protein":  round(daily_prot  * frac),
        "carbs":    round(daily_carbs * frac),
        "fat":      round(daily_fat   * frac),
    }


def _heuristic_score(meal: dict[str, Any], targets: dict[str, float], budget: float) -> int:
    """
    Pure-Python fallback when Claude is unavailable.
    Scores 0-100 based on how close each macro is to target.
    """
    score = 60
    for macro, key in [
        ("calories", "estimated_calories"),
        ("protein",  "estimated_protein_g"),
        ("carbs",    "estimated_carbs_g"),
        ("fat",      "estimated_fat_g"),
    ]:
        val = float(meal.get(key) or 0)
        target = targets.get(macro, 1)
        if target <= 0:
            continue
        delta = abs(val - target) / target
        if delta <= 0.05:
            score += 10
        elif delta <= 0.15:
            score += 6
        elif delta <= 0.30:
            score += 2
        else:
            score -= 5

    price = float(meal.get("price_sgd") or 0)
    if price and price <= budget:
        score += 8

    return max(0, min(100, score))


async def rank_meals_by_user_macros(
    meals: list[dict[str, Any]],
    user_preferences: dict[str, Any],
    top_n: int = 3,
) -> list[dict[str, Any]]:
    """
    Score every meal against the user's per-meal macro targets using Claude.
    Returns `top_n` meals, each augmented with:
        claude_score    : int 0-100
        claude_reason   : str
        macro_match     : {calories/protein/carbs/fat → perfect|good|fair|poor}
        match_score     : same as claude_score (for API compat)
        match_explanation: same as claude_reason (for API compat)
    """
    if not meals:
        return []

    meal_type = str(user_preferences.get("meal_type", "lunch"))
    targets   = _meal_targets(user_preferences, meal_type)
    budget    = float(user_preferences.get("budget_sgd") or 15)
    restrict  = list(user_preferences.get("dietary_restrictions") or [])

    # Pre-filter: keep the 20 items closest in calories to the per-meal target.
    # This keeps the prompt short enough for Claude to respond with JSON directly
    # without reasoning preamble that can overflow max_tokens.
    def _cal_distance(m: dict[str, Any]) -> float:
        return abs(float(m.get("estimated_calories") or 0) - targets["calories"])

    candidates = sorted(meals, key=_cal_distance)[:20]

    meal_lines = "\n".join(
        f"{i + 1}. \"{m.get('meal_name','?')}\" @ {m.get('restaurant_name','?')} "
        f"SGD {float(m.get('price_sgd') or 0):.2f} | "
        f"{int(m.get('estimated_calories') or 0)} kcal | "
        f"P {float(m.get('estimated_protein_g') or 0):.0f}g | "
        f"C {float(m.get('estimated_carbs_g') or 0):.0f}g | "
        f"F {float(m.get('estimated_fat_g') or 0):.0f}g"
        for i, m in enumerate(candidates)
    )

    diet_line = f"\nDietary restrictions: {', '.join(restrict)}" if restrict else ""

    # Template-fill prompt: provide the exact structure and ask Claude to fill in values.
    # This avoids the reasoning-preamble problem — Claude fills blanks instead of explaining.
    prompt = f"""Rank these {meal_type} options for a user with the following targets.

TARGETS FOR THIS {meal_type.upper()} (daily÷meal-fraction already applied):
  Calories : {targets['calories']} kcal | Protein: {targets['protein']}g | Carbs: {targets['carbs']}g | Fat: {targets['fat']}g
  Budget   : SGD {budget:.2f} max{diet_line}

MEALS:
{meal_lines}

Pick the best 3 (prefer different restaurants). Score each 0-100 based on macro proximity to targets and budget fit.
Label each macro: "perfect" (within 5%), "good" (within 15%), "fair" (within 30%), "poor" (>30% off).
Write a warm 1-sentence reason per meal.

Fill in this JSON template exactly — replace every ? with the correct value.
Output ONLY the filled JSON array, nothing else before or after it:

[
  {{"index": ?, "score": ?, "reason": "?", "macro_match": {{"calories": "?", "protein": "?", "carbs": "?", "fat": "?"}}}},
  {{"index": ?, "score": ?, "reason": "?", "macro_match": {{"calories": "?", "protein": "?", "carbs": "?", "fat": "?"}}}},
  {{"index": ?, "score": ?, "reason": "?", "macro_match": {{"calories": "?", "protein": "?", "carbs": "?", "fat": "?"}}}}
]"""

    try:
        response = await _client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Extract the JSON array even if there's any surrounding text
        start = raw.find("[")
        end   = raw.rfind("]") + 1
        if start == -1 or end == 0:
            raise ValueError(f"No JSON array in response: {raw[:120]!r}")
        rankings: list[dict] = json.loads(raw[start:end])
    except Exception as exc:
        print(f"⚠️  Claude ranking failed ({exc}) — using heuristic fallback")
        scored = sorted(
            candidates,
            key=lambda m: -_heuristic_score(m, targets, budget),
        )
        seen_r: set[str] = set()
        top: list[dict[str, Any]] = []
        for m in scored:
            r = str(m.get("restaurant_name", "")).lower()
            if r in seen_r:
                continue
            seen_r.add(r)
            sc = _heuristic_score(m, targets, budget)
            meal = dict(m)
            meal.update({
                "claude_score":       sc,
                "claude_reason":      "Good match for your nutrition goals.",
                "macro_match":        {},
                "match_score":        sc,
                "match_explanation":  "Good match for your nutrition goals.",
            })
            top.append(meal)
            if len(top) >= top_n:
                break
        return top

    # Merge Claude's ranking metadata back into meal dicts
    seen_restaurants: set[str] = set()
    top_meals: list[dict[str, Any]] = []

    for entry in rankings:
        idx = int(entry.get("index", 1)) - 1
        if idx < 0 or idx >= len(candidates):
            continue
        meal = dict(candidates[idx])
        restaurant = str(meal.get("restaurant_name", "")).lower()
        if restaurant in seen_restaurants:
            continue
        seen_restaurants.add(restaurant)

        score  = max(0, min(100, int(entry.get("score") or 70)))
        reason = str(entry.get("reason") or "Good nutritional match.")
        macro_match = entry.get("macro_match") or {}

        meal.update({
            "claude_score":      score,
            "claude_reason":     reason,
            "macro_match":       macro_match,
            # API-compat aliases
            "match_score":       score,
            "match_explanation": reason,
        })
        top_meals.append(meal)
        if len(top_meals) >= top_n:
            break

    # If Claude returned fewer than top_n (shouldn't happen), pad with heuristics
    if len(top_meals) < top_n:
        for m in candidates:
            if len(top_meals) >= top_n:
                break
            r = str(m.get("restaurant_name", "")).lower()
            if r in seen_restaurants:
                continue
            seen_restaurants.add(r)
            sc = _heuristic_score(m, targets, budget)
            meal = dict(m)
            meal.update({
                "claude_score":      sc,
                "claude_reason":     "Solid option for your goals.",
                "macro_match":       {},
                "match_score":       sc,
                "match_explanation": "Solid option for your goals.",
            })
            top_meals.append(meal)

    return top_meals
