"""Test Stage 2: menu scraping from a single Grab restaurant."""
import asyncio
from integrations.grab_menu_scraper import scrape_restaurant_menu

# A real Tian Tian Chicken Rice restaurant page
TEST_URL = "https://food.grab.com/sg/en/restaurant/tian-tian-hainanese-chicken-rice-delivery"

async def main() -> None:
    print("Testing menu scraper…\n")
    items = await scrape_restaurant_menu(
        restaurant_url=TEST_URL,
        restaurant_name="Tian Tian Chicken Rice (Test)",
        restaurant_rating=4.5,
        delivery_time_mins=25,
        latitude=1.2763,
        longitude=103.8451,
        max_items=15,
    )

    print(f"\nFound {len(items)} menu items:")
    for item in items:
        print(f"  • {item['meal_name'][:40]:40s}  SGD {item['price_sgd']:.2f}")

    assert isinstance(items, list), "Should return a list"
    print("\n✅ Menu scraper test complete")

if __name__ == "__main__":
    asyncio.run(main())
