"""Quick test for Grab search — run: python test_grab.py"""

import asyncio

from integrations.grab_searcher import search_grab_meals


async def main() -> None:
    print("🔍 Testing Grab Scraper...\n")
    results = await search_grab_meals("chicken rice", 1.2763, 103.8451)

    sep = "=" * 50
    print(f"\n{sep}")
    print(f"✅ Found {len(results)} meals!")
    print(f"{sep}\n")

    for i, meal in enumerate(results[:5], 1):
        print(f"{i}. {meal['restaurant_name']}")
        print(
            f"   SGD {meal['price_sgd']} • "
            f"{meal['delivery_time_mins']} mins • "
            f"⭐{meal['restaurant_rating']}"
        )


if __name__ == "__main__":
    asyncio.run(main())
