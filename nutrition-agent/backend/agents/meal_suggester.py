"""
Full 4-stage meal suggestion pipeline:
  1. grab_searcher      → find restaurants near the user
  2. grab_menu_scraper  → scrape actual menu items from each restaurant
  3. nutrition_enrichment → add calorie/macro data to every item
  4. ranking_engine     → Claude picks & explains the best 3

Falls back gracefully at every stage so the API always returns 3 suggestions.
"""

from __future__ import annotations

from typing import Any

from integrations.grab_searcher import search_grab_meals_authenticated
from integrations.grab_menu_scraper import scrape_multiple_restaurants
from integrations.nutrition_enrichment import enrich_meals_with_nutrition
from agents.ranking_engine import rank_meals_by_user_macros

# ── Static fallback pool ──────────────────────────────────────────────────────
# Used only when Grab search + menu scraping both return nothing.

_FALLBACK_MEALS: list[dict[str, Any]] = [
    {
        "meal_name": "Hainanese Chicken Rice",
        "restaurant_name": "Tian Tian Chicken Rice",
        "price_sgd": 8.50,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.5,
        "delivery_time_mins": 25,
    },
    {
        "meal_name": "Thai Basil Chicken with Rice",
        "restaurant_name": "Saap Saap Thai",
        "price_sgd": 12.90,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.3,
        "delivery_time_mins": 30,
    },
    {
        "meal_name": "Mala Xiang Guo (Medium)",
        "restaurant_name": "Liang Ji Mala",
        "price_sgd": 14.50,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.2,
        "delivery_time_mins": 35,
    },
    {
        "meal_name": "Nasi Lemak with Fried Chicken",
        "restaurant_name": "Ponggol Nasi Lemak",
        "price_sgd": 7.80,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.4,
        "delivery_time_mins": 28,
    },
    {
        "meal_name": "Grilled Chicken Teriyaki Bowl",
        "restaurant_name": "Wafuken",
        "price_sgd": 13.50,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.6,
        "delivery_time_mins": 32,
    },
    {
        "meal_name": "Butter Chicken with Garlic Naan",
        "restaurant_name": "Punjab Grill Express",
        "price_sgd": 14.90,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.4,
        "delivery_time_mins": 35,
    },
    {
        "meal_name": "Spicy Tuna Salad Bowl",
        "restaurant_name": "SaladStop",
        "price_sgd": 13.00,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.3,
        "delivery_time_mins": 25,
    },
    {
        "meal_name": "Char Siew Roasted Duck Rice",
        "restaurant_name": "Roast Paradise",
        "price_sgd": 9.50,
        "grab_meal_url": "https://food.grab.com/sg/en/",
        "restaurant_rating": 4.5,
        "delivery_time_mins": 28,
    },
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _build_search_query(taste_profile: dict | None, meal_type: str) -> str:
    """Build a Grab search query from taste preferences."""
    likes = list((taste_profile or {}).get("likes") or [])
    if likes:
        return " ".join(str(x) for x in likes[:2])
    return {"breakfast": "breakfast egg toast", "lunch": "rice bowl", "dinner": "dinner set"}.get(
        meal_type, "chicken rice"
    )


def _per_meal_budget(weekly_budget_sgd: float | None, meals_per_week: int | None) -> float:
    if not weekly_budget_sgd or weekly_budget_sgd <= 0:
        return 15.0
    count = meals_per_week if (meals_per_week and meals_per_week > 0) else 10
    return weekly_budget_sgd / count


def _fallback_meals_for_taste(taste_profile: dict | None) -> list[dict[str, Any]]:
    """Filter fallback pool by dislikes; return all if nothing passes the filter."""
    dislikes = [str(x).lower() for x in (taste_profile or {}).get("dislikes") or []]
    filtered = [
        meal.copy() for meal in _FALLBACK_MEALS
        if not any(d in meal["meal_name"].lower() for d in dislikes)
    ]
    return filtered or [m.copy() for m in _FALLBACK_MEALS]


def _format_suggestion(meal: dict[str, Any], rank: int) -> dict[str, Any]:
    """Shape a ranked meal dict into the MealSuggestion schema."""
    return {
        "rank":                rank,
        "meal_name":           str(meal.get("meal_name") or "Unknown"),
        "restaurant_name":     str(meal.get("restaurant_name") or "Unknown"),
        "price_sgd":           float(meal.get("price_sgd") or 0),
        "estimated_calories":  int(meal.get("estimated_calories") or 0),
        "estimated_protein_g": float(meal.get("estimated_protein_g") or 0),
        "estimated_carbs_g":   float(meal.get("estimated_carbs_g") or 0),
        "estimated_fat_g":     float(meal.get("estimated_fat_g") or 0),
        "match_score":         int(meal.get("match_score") or meal.get("claude_score") or 70),
        "match_explanation":   str(meal.get("match_explanation") or meal.get("claude_reason") or ""),
        "grab_meal_url":       str(meal.get("grab_meal_url") or "https://food.grab.com/sg/en/"),
        "restaurant_rating":   float(meal.get("restaurant_rating") or 4.0),
        "delivery_time_mins":  int(meal.get("delivery_time_mins") or 30),
    }


# ── Main pipeline ──────────────────────────────────────────────────────────────

async def get_meal_suggestions(
    user_id: str,
    meal_type: str,
    user_prefs: dict[str, Any],
    latitude: float,
    longitude: float,
) -> tuple[list[dict[str, Any]], str]:
    """
    Run the full 4-stage pipeline and return (suggestions, search_source).

    search_source is "grab" when live Grab results were used, "fallback" otherwise.
    """
    taste  = user_prefs.get("taste_profile") or {}
    query  = _build_search_query(taste, meal_type)
    budget = _per_meal_budget(user_prefs.get("weekly_budget_sgd"), user_prefs.get("meals_per_week"))
    search_source = "fallback"

    # ── Stage 1: Find restaurants on Grab ─────────────────────────────────────
    print(f"\n{'─'*50}")
    print(f"🍽  suggest_meals | user={user_id} | type={meal_type} | query='{query}'")

    try:
        restaurants = await search_grab_meals_authenticated(
            search_query=query,
            latitude=latitude,
            longitude=longitude,
            max_results=8,
        )
    except Exception as exc:
        print(f"⚠️  Stage 1 (restaurant search) failed: {exc}")
        restaurants = []

    # ── Stage 2: Scrape menu items from each restaurant ───────────────────────
    candidate_meals: list[dict[str, Any]] = []

    if restaurants:
        try:
            candidate_meals = await scrape_multiple_restaurants(
                restaurants=restaurants,
                latitude=latitude,
                longitude=longitude,
                max_per_restaurant=12,
                max_restaurants=4,
            )
            if candidate_meals:
                search_source = "grab"
        except Exception as exc:
            print(f"⚠️  Stage 2 (menu scraping) failed: {exc}")

    if not candidate_meals:
        print("⚠️  No Grab menu items — using curated fallback pool")
        candidate_meals = _fallback_meals_for_taste(taste)

    print(f"📦 {len(candidate_meals)} candidate items entering nutrition stage")

    # ── Stage 3: Enrich with nutrition data ───────────────────────────────────
    try:
        enriched = await enrich_meals_with_nutrition(candidate_meals, meal_type)
    except Exception as exc:
        print(f"⚠️  Stage 3 (nutrition enrichment) failed: {exc}")
        enriched = candidate_meals  # proceed with missing nutrition data

    # ── Stage 4: Claude ranking ────────────────────────────────────────────────
    ranking_prefs: dict[str, Any] = {
        "meal_type":           meal_type,
        "target_calories":     user_prefs.get("adjusted_calories"),
        "target_protein":      user_prefs.get("adjusted_protein_g"),
        "target_carbs":        user_prefs.get("adjusted_carbs_g"),
        "target_fat":          user_prefs.get("adjusted_fat_g"),
        "budget_sgd":          budget,
        "dietary_restrictions": [],
    }

    try:
        top3 = await rank_meals_by_user_macros(enriched, ranking_prefs, top_n=3)
    except Exception as exc:
        print(f"⚠️  Stage 4 (ranking) failed: {exc}")
        top3 = enriched[:3]

    suggestions = [_format_suggestion(meal, rank + 1) for rank, meal in enumerate(top3)]

    # Safety net: if we still have fewer than 3, pad from fallback
    if len(suggestions) < 3:
        fallback_enriched = await enrich_meals_with_nutrition(
            _fallback_meals_for_taste(taste), meal_type
        )
        seen = {s["restaurant_name"].lower() for s in suggestions}
        for meal in fallback_enriched:
            if len(suggestions) >= 3:
                break
            if meal.get("restaurant_name", "").lower() not in seen:
                seen.add(meal.get("restaurant_name", "").lower())
                suggestions.append(_format_suggestion(meal, len(suggestions) + 1))

    print(f"✅ Returning {len(suggestions)} suggestions (source: {search_source})")
    return suggestions, search_source
