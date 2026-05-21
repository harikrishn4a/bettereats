"""
Full pipeline integration test.
Runs all 4 stages end-to-end and reports what each stage produced.
"""
import asyncio, time
from agents.meal_suggester import get_meal_suggestions

USER_PREFS = {
    "adjusted_calories":  1993,
    "adjusted_protein_g": 174,
    "adjusted_carbs_g":   199,
    "adjusted_fat_g":      55,
    "weekly_budget_sgd":  120,
    "meals_per_week":      10,
    "taste_profile": {"likes": ["spicy", "Indian"], "dislikes": ["seafood"]},
}

# Singapore central (Tanjong Pagar)
LAT, LON = 1.2763, 103.8451

async def main() -> None:
    for i, meal_type in enumerate(["lunch", "dinner"]):
        if i > 0:
            print("\n⏳ Cooling down 12s between searches to avoid rate limiting…")
            await asyncio.sleep(12)

        print(f"\n{'═'*60}")
        print(f"Testing full pipeline — {meal_type.upper()}")
        print(f"{'═'*60}")

        t0 = time.time()
        suggestions, source = await get_meal_suggestions(
            user_id="test_pipeline",
            meal_type=meal_type,
            user_prefs=USER_PREFS,
            latitude=LAT,
            longitude=LON,
        )
        elapsed = time.time() - t0

        print(f"\nSource: {source}  |  Time: {elapsed:.1f}s")
        print(f"Got {len(suggestions)} suggestions:\n")

        all_ok = True
        for s in suggestions:
            sane = 150 <= s["estimated_calories"] <= 1500
            all_ok = all_ok and sane
            budget_ok = s["price_sgd"] <= (120 / 10) + 10  # ±10 tolerance
            flag = "✅" if sane else "❌"
            print(f"  {flag} #{s['rank']} {s['meal_name'][:38]:38s} SGD {s['price_sgd']:5.2f}")
            print(f"       {s['estimated_calories']} kcal | P:{s['estimated_protein_g']:.0f}g | "
                  f"score {s['match_score']} | {'within budget ✅' if budget_ok else 'over budget ⚠️'}")
            print(f"       {s['match_explanation'][:80]}")
            print()

        assert len(suggestions) == 3, f"Expected 3, got {len(suggestions)}"
        assert all_ok, "Some calorie values are unrealistic"
        print(f"✅ {meal_type} pipeline OK (source={source})")

    print("\n✅ Full pipeline test complete")

if __name__ == "__main__":
    asyncio.run(main())
