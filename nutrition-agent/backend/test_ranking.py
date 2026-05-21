"""Test Stage 4: Claude ranking of enriched meals."""
import asyncio
from agents.ranking_engine import rank_meals_by_user_macros

# Simulated enriched meal pool (as if from Stage 3)
MEALS = [
    {"meal_name": "Hainanese Chicken Rice",     "restaurant_name": "Tian Tian",    "price_sgd": 8.50,  "estimated_calories": 650, "estimated_protein_g": 38, "estimated_carbs_g": 72, "estimated_fat_g": 14},
    {"meal_name": "Thai Basil Chicken with Rice","restaurant_name": "Saap Saap",    "price_sgd": 12.90, "estimated_calories": 580, "estimated_protein_g": 32, "estimated_carbs_g": 65, "estimated_fat_g": 16},
    {"meal_name": "Grilled Chicken Teriyaki",   "restaurant_name": "Wafuken",       "price_sgd": 13.50, "estimated_calories": 620, "estimated_protein_g": 42, "estimated_carbs_g": 58, "estimated_fat_g": 12},
    {"meal_name": "Butter Chicken Naan",        "restaurant_name": "Punjab Grill",  "price_sgd": 14.90, "estimated_calories": 720, "estimated_protein_g": 35, "estimated_carbs_g": 80, "estimated_fat_g": 22},
    {"meal_name": "Mala Xiang Guo",             "restaurant_name": "Liang Ji Mala", "price_sgd": 14.50, "estimated_calories": 780, "estimated_protein_g": 30, "estimated_carbs_g": 45, "estimated_fat_g": 38},
]

# Fat-loss user: 1800 kcal daily → lunch target = 1800×0.35 = 630 kcal
USER_PREFS = {
    "meal_type":           "lunch",
    "target_calories":     1800,   # daily total (ranking engine divides by 0.35 for lunch)
    "target_protein":       130,   # daily → 45g per lunch
    "target_carbs":         170,   # daily → 60g per lunch
    "target_fat":            43,   # daily → 15g per lunch
    "budget_sgd":            12,
    "dietary_restrictions": [],
}

async def main() -> None:
    print("Testing Claude ranking…\n")
    ranked = await rank_meals_by_user_macros(MEALS, USER_PREFS, top_n=3)

    print(f"Top {len(ranked)} ranked meals:\n")
    for i, m in enumerate(ranked, 1):
        print(f"  #{i} [{m['match_score']:3d}]  {m['meal_name'][:40]:40s}")
        print(f"       Reason: {m['match_explanation']}")
        mm = m.get("macro_match") or {}
        if mm:
            print(f"       Macros: cal={mm.get('calories','?')} prot={mm.get('protein','?')} "
                  f"carbs={mm.get('carbs','?')} fat={mm.get('fat','?')}")
        print()

    assert len(ranked) <= 3, "Should return at most 3"
    assert all(0 <= m["match_score"] <= 100 for m in ranked), "Scores must be 0-100"
    print("✅ Ranking test complete")

if __name__ == "__main__":
    asyncio.run(main())
