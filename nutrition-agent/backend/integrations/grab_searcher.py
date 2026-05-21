"""
Improved Grab Food search via Playwright.

Uses Grab's public restaurant listing with better extraction.
"""

from __future__ import annotations

import re
import asyncio
from typing import List, Dict
from urllib.parse import quote_plus

try:
    from playwright.async_api import async_playwright as _async_playwright
    _PLAYWRIGHT_AVAILABLE = True
except ImportError:
    _async_playwright = None  # type: ignore[assignment]
    _PLAYWRIGHT_AVAILABLE = False

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _slugify_query(query: str) -> str:
    """Convert 'chicken rice' → 'chicken-rice' for Grab's ?search= param."""
    slug = re.sub(r"[^a-z0-9]+", "-", query.lower().strip())
    return slug.strip("-") or "popular"


async def search_grab_meals(
    search_query: str,
    latitude: float,
    longitude: float,
    max_results: int = 10,
) -> List[Dict]:
    """
    Search Grab Food restaurants near latitude/longitude.
    
    Uses Grab's public /restaurants?search= endpoint (login not required).
    """
    if not _PLAYWRIGHT_AVAILABLE:
        print("⚠️  Playwright not installed — Grab search unavailable.")
        return []

    slug = _slugify_query(search_query)
    print(f"🔍 Searching Grab for: {search_query} (slug={slug})")
    print(f"📍 Location: {latitude}, {longitude}")

    for attempt in range(1, 3):
        meals: List[Dict] = []
        try:
            async with _async_playwright() as p:
                launch_kwargs: dict = {"headless": True}
                try:
                    browser = await p.chromium.launch(channel="chrome", **launch_kwargs)
                except Exception:
                    browser = await p.chromium.launch(**launch_kwargs)

                context = await browser.new_context(
                    viewport={"width": 1280, "height": 900},
                    geolocation={"latitude": latitude, "longitude": longitude},
                    permissions=["geolocation"],
                    user_agent=_USER_AGENT,
                    locale="en-SG",
                )
                
                await context.grant_permissions(["geolocation"], origin="https://food.grab.com")

                page = await context.new_page()
                
                # Navigate to search page
                search_url = f"https://food.grab.com/sg/en/restaurants?search={quote_plus(slug)}"
                print(f"Going to: {search_url}")
                
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                print("✓ Page loaded (domcontentloaded)")
                
                # Wait for restaurant cards — longer on retries
                wait_ms = 12_000 if attempt == 1 else 20_000
                print(f"⏳ Waiting for restaurant cards (up to {wait_ms//1000}s)...")
                try:
                    await page.wait_for_selector('a[href*="/restaurant/"]', timeout=wait_ms)
                    print("✓ Restaurant cards loaded")
                except Exception as e:
                    print(f"⚠️  Timeout waiting for cards: {e}")

                # Extra stabilisation wait
                await page.wait_for_timeout(3000)
                print("✓ Waited 3s for content to stabilize")
                
                # Extract meals with improved method
                meals = await _extract_meals_improved(page)
                
                await browser.close()

                if meals:
                    print(f"✓ Found {len(meals)} Grab restaurants")
                    return meals[:max_results]

                print(f"⚠️  Attempt {attempt}: no Grab results")

        except Exception as e:
            print(f"❌ Grab search attempt {attempt} error: {e}")

        if attempt < 2:
            import random
            # Back off with jitter — mimic a human pausing before retrying
            await asyncio.sleep(8 + random.uniform(1, 4))

    print("✓ Found 0 Grab restaurants")
    return []


# Alias used by meal_suggester
search_grab_meals_authenticated = search_grab_meals


async def _extract_meals_improved(page) -> List[Dict]:
    """
    Improved extraction that gets better data.
    """
    
    extract_script = r"""
    () => {
        const meals = [];
        const seen = new Set();
        
        // Get all restaurant link containers
        const links = document.querySelectorAll('a[href*="/restaurant/"]');
        console.log(`Found ${links.length} links`);
        
        for (const link of links) {
            try {
                const href = link.href;
                if (!href.includes('/restaurant/')) continue;
                if (seen.has(href)) continue;
                seen.add(href);
                
                // Get the full text content
                const fullText = link.textContent || '';
                const cleanText = fullText.replace(/\s+/g, ' ').trim();
                
                if (cleanText.length < 5) continue;
                
                // Extract restaurant name (usually first meaningful part)
                const nameMatch = cleanText.match(/^([^0-9★⭐]+?)(?:\d\.\d|mins?|km|SGD|\$|[0-9])/);
                const name = nameMatch ? nameMatch[1].trim() : cleanText.slice(0, 100);
                
                // Extract rating (e.g., "4.5")
                let rating = 4.0;
                const ratingMatch = cleanText.match(/(\d\.\d+)/);
                if (ratingMatch) {
                    const parsed = parseFloat(ratingMatch[1]);
                    if (parsed >= 3 && parsed <= 5) rating = parsed;
                }
                
                // Extract delivery time (e.g., "33 mins", "33min")
                let mins = 30;
                const timeMatch = cleanText.match(/(\d{1,2})\s*mins?/i);
                if (timeMatch) {
                    const parsed = parseInt(timeMatch[1], 10);
                    mins = Math.min(Math.max(parsed, 15), 90);
                }
                
                // Extract price (e.g., "S$ 12.50" or just number)
                let price = 12.0;
                const priceMatch = cleanText.match(/S\$\s*([0-9.]+)|[0-9]+(?:\.[0-9]{2})?/);
                if (priceMatch) {
                    let priceStr = priceMatch[1] || priceMatch[0];
                    if (priceStr.includes('$')) {
                        priceStr = priceStr.replace('S$', '').trim();
                    }
                    const parsed = parseFloat(priceStr);
                    if (parsed > 0 && parsed < 200) price = parsed;
                }
                
                // Get restaurant name from URL
                const slugMatch = href.match(/\/restaurant\/([^\/\?]+)/);
                const slug = slugMatch ? slugMatch[1] : '';
                const restaurantName = slug
                    .replace(/-delivery$/, '')
                    .split('-')
                    .map(w => {
                        if (w === 's') return '\'s';
                        return w.charAt(0).toUpperCase() + w.slice(1);
                    })
                    .join(' ')
                    .replace(/\s's\s/, '\'s ') || 'Restaurant';
                
                meals.push({
                    meal_name: name.trim(),
                    restaurant_name: restaurantName,
                    price_sgd: price,
                    grab_meal_url: href.split('?')[0],
                    restaurant_rating: rating,
                    delivery_time_mins: mins
                });
                
                if (meals.length >= 20) break;
            } catch (e) {
                console.error('Error parsing meal:', e.message);
            }
        }
        
        return meals;
    }
    """
    
    try:
        meals = await page.evaluate(extract_script)
        print(f"📊 Extraction found {len(meals)} meals")
        return meals
    except Exception as e:
        print(f"❌ Extraction error: {e}")
        return []


if __name__ == "__main__":

    async def test() -> None:
        results = await search_grab_meals(
            search_query="chicken rice",
            latitude=1.2763,
            longitude=103.8451,
        )
        print(f"\n{'='*50}")
        print(f"Found {len(results)} meals:")
        print(f"{'='*50}\n")
        
        for i, meal in enumerate(results[:5], 1):
            print(f"#{i} {meal['restaurant_name']}")
            print(f"   {meal['meal_name'][:50]}")
            print(f"   SGD {meal['price_sgd']} • {meal['delivery_time_mins']} mins • ⭐{meal['restaurant_rating']}")
            print()

    asyncio.run(test())