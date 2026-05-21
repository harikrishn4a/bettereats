"""Test Stage 3: nutrition enrichment with all 3 layers (FatSecret → Claude → heuristic)."""
import asyncio
from integrations.nutrition_enrichment import enrich_meals_with_nutrition

TEST_MEALS = [
    {"meal_name": "Hainanese Chicken Rice", "restaurant_name": "Tian Tian",    "price_sgd": 8.50},
    {"meal_name": "Butter Chicken Naan",    "restaurant_name": "Punjab Grill", "price_sgd": 14.90},
    {"meal_name": "Mala Xiang Guo",         "restaurant_name": "Liang Ji",     "price_sgd": 14.50},
    {"meal_name": "Tuna Salad Bowl",        "restaurant_name": "SaladStop",    "price_sgd": 13.00},
]

async def main() -> None:
    print("Testing nutrition enrichment…\n")
    enriched = await enrich_meals_with_nutrition(TEST_MEALS, meal_type="lunch")

    print(f"Enriched {len(enriched)} meals:\n")
    all_sane = True
    for m in enriched:
        cal  = int(m.get("estimated_calories") or 0)
        prot = float(m.get("estimated_protein_g") or 0)
        sane = 150 <= cal <= 1500 and prot >= 3
        flag = "✅" if sane else "❌"
        all_sane = all_sane and sane
        print(f"  {flag} {m['meal_name'][:35]:35s} "
              f"{cal:4d} kcal | P:{prot:5.1f}g | "
              f"C:{float(m.get('estimated_carbs_g',0)):.1f}g | "
              f"F:{float(m.get('estimated_fat_g',0)):.1f}g  "
              f"[{m.get('source','?')}]")

    print(f"\nAll values realistic: {'✅' if all_sane else '❌'}")
    print("✅ Nutrition test complete")

if __name__ == "__main__":
    asyncio.run(main())
