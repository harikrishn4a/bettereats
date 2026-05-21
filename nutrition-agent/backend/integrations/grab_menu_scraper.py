"""
Stage 2: Scrape actual menu items from Grab restaurant detail pages.

Given restaurant URLs from grab_searcher, this extracts individual dish
names and prices so we have real items to rank — not just restaurant cards.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

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

# ── Python-side meal-name validation ──────────────────────────────────────────

_ALPHA_RE    = re.compile(r"[a-zA-Z]{3,}")
_METADATA_RE = re.compile(
    r"^\d+\.?\d*\s*(?:mins?|km|stars?|away)$"   # pure metadata
    r"|\d+\.?\d*\s*km\b"                          # "1.2 km" anywhere
    r"|\d{1,2}\s*mins?\s*\d",                     # "33 mins 1.2 km"
    re.I,
)
# Known Grab UI labels that get scraped as "items"
_UI_LABELS = frozenset({
    "save", "add", "order", "home", "menu", "cart", "checkout",
    "search", "back", "close", "cancel", "confirm", "share",
    "next", "prev", "previous", "select", "edit", "delete",
})
# CamelCase junction: a run of lowercase letters immediately followed by an
# uppercase letter signals where the description was appended to the name.
_CAMEL_JUNCTION = re.compile(r"[a-z][A-Z]")


def _clean_name(raw: str) -> str:
    """Strip descriptions appended without a separator, cap at 60 chars."""
    # Truncate at CamelCase junction (e.g., "BiryaniChicken biryani is...")
    m = _CAMEL_JUNCTION.search(raw)
    if m:
        raw = raw[: m.start() + 1]
    # Truncate at obvious description starts (lowercase continuation after sentence cap)
    for sep in (" is ", " are ", " was ", " with a ", ", served"):
        idx = raw.find(sep)
        if idx > 6:          # leave at least 6 chars for the actual name
            raw = raw[:idx]
    return raw.strip()[:60]  # hard cap


def _is_valid_meal_name(name: str) -> bool:
    """Return True only if `name` plausibly represents a real food item."""
    if not name or len(name) < 4:
        return False
    # Must contain at least one real alphabetic word
    if not _ALPHA_RE.search(name):
        return False
    # Reject delivery metadata
    if _METADATA_RE.search(name):
        return False
    # Reject known UI labels (exact match, case-insensitive)
    if name.strip().lower() in _UI_LABELS:
        return False
    # Reject names that start with known page-navigation prefixes
    lower = name.lower()
    for prefix in ("homerestaurant", "home restaurant", "restaurant home"):
        if lower.startswith(prefix):
            return False
    # Reject if fewer than 30% of chars are alphabetic
    if sum(c.isalpha() for c in name) / len(name) < 0.30:
        return False
    return True


# ── In-page extraction script ──────────────────────────────────────────────────
# Multiple strategies to handle Grab's dynamic React structure.
# Each strategy now filters out delivery-metadata strings at the JS level.
_EXTRACT_SCRIPT = r"""
() => {
    const items = [];
    const seen = new Set();
    let currentSection = '';

    function cleanName(s) {
        return s
            // Remove price patterns
            .replace(/S\$[\s\d.]+/g, '')
            // Remove delivery metadata tokens
            .replace(/\d+\.?\d*\s*(mins?|km|stars?|away)/gi, '')
            // Collapse whitespace
            .replace(/\s+/g, ' ')
            // Keep only printable word chars
            .replace(/[^\w\s\-()'&,./]/g, '')
            .trim();
    }

    function parsePrice(s) {
        const m = s.match(/S\$\s*([\d]+\.?[\d]{0,2})/);
        if (m) return parseFloat(m[1]);
        const m2 = s.match(/([\d]+\.[\d]{2})/);
        return m2 ? parseFloat(m2[1]) : null;
    }

    function isValidMealName(name) {
        if (!name || name.length < 4) return false;
        // Must have at least one real word (3+ letters)
        if (!/[a-zA-Z]{3,}/.test(name)) return false;
        // Reject pure delivery metadata
        if (/^\d+\.?\d*\s*(mins?|km|stars?|away)$/i.test(name)) return false;
        if (/\d+\.?\d*\s*km/i.test(name)) return false;
        // Reject if mostly numeric (< 30% alphabetic)
        const alphaCount = (name.match(/[a-zA-Z]/g) || []).length;
        if (alphaCount / name.length < 0.30) return false;
        return true;
    }

    // ── Strategy A: data-testid patterns ──────────────────────────────────────
    const itemEls = document.querySelectorAll(
        '[data-testid*="item"], [data-testid*="dish"], [data-testid*="product"]'
    );
    for (const el of itemEls) {
        const text = el.textContent || '';
        const price = parsePrice(text);
        if (!price || price < 0.5 || price > 80) continue;

        const nameEl = el.querySelector('h4, h3, [class*="name"], [class*="title"]');
        const rawName = nameEl ? nameEl.textContent?.trim() : text.split('\n')[0].trim();
        const name = cleanName(rawName || '');
        if (!isValidMealName(name) || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        items.push({ name, price, section: currentSection });
        if (items.length >= 40) break;
    }

    // ── Strategy B: DOM tree walk — price → infer name ────────────────────────
    if (items.length < 5) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const el = walker.currentNode;
            if (el.children.length > 5) continue;

            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.length < 5 || text.length > 300) continue;

            const price = parsePrice(text);
            if (!price || price < 0.5 || price > 80) continue;

            const priceIdx = text.search(/S\$\s*[\d]/);
            const rawName = priceIdx > 0 ? text.slice(0, priceIdx).trim() : text.split('\n')[0];
            const name = cleanName(rawName);
            if (!isValidMealName(name) || seen.has(name.toLowerCase())) continue;

            seen.add(name.toLowerCase());
            items.push({ name, price, section: currentSection });
            if (items.length >= 40) break;
        }
    }

    // ── Strategy C: sibling price + name pairs ────────────────────────────────
    if (items.length < 5) {
        const priceEls = Array.from(document.querySelectorAll('*')).filter(el => {
            const t = el.textContent?.trim() || '';
            return /^S\$\s*[\d]+\.[\d]{2}$/.test(t) && el.children.length === 0;
        });

        for (const priceEl of priceEls) {
            const price = parsePrice(priceEl.textContent || '');
            if (!price || price < 0.5 || price > 80) continue;

            const parent = priceEl.closest('[class]') || priceEl.parentElement;
            if (!parent) continue;

            const nameEl =
                parent.querySelector('h4, h3, span[class*="name"]') ||
                Array.from(parent.children).find(c => c !== priceEl && (c.textContent?.trim().length || 0) > 3);
            if (!nameEl) continue;

            const name = cleanName(nameEl.textContent || '');
            if (!isValidMealName(name) || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            items.push({ name, price, section: '' });
            if (items.length >= 40) break;
        }
    }

    return items;
}
"""


async def scrape_restaurant_menu(
    restaurant_url: str,
    restaurant_name: str,
    restaurant_rating: float,
    delivery_time_mins: int,
    latitude: float,
    longitude: float,
    max_items: int = 15,
) -> list[dict[str, Any]]:
    """
    Open a Grab restaurant page in Playwright and extract menu items.

    Returns:
        [{meal_name, restaurant_name, price_sgd, grab_meal_url,
          restaurant_rating, delivery_time_mins, section}]
    """
    if not _PLAYWRIGHT_AVAILABLE:
        return []

    print(f"  📋 Scraping: {restaurant_name} ({restaurant_url[:60]}...)")

    try:
        async with _async_playwright() as p:
            try:
                browser = await p.chromium.launch(channel="chrome", headless=True)
            except Exception:
                browser = await p.chromium.launch(headless=True)

            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                geolocation={"latitude": latitude, "longitude": longitude},
                permissions=["geolocation"],
                user_agent=_USER_AGENT,
                locale="en-SG",
            )
            page = await context.new_page()

            await page.goto(restaurant_url, wait_until="domcontentloaded", timeout=30_000)

            # Wait for dynamic menu content
            try:
                await page.wait_for_selector("h4, [class*='name'], [class*='item']", timeout=10_000)
            except Exception:
                pass

            # Scroll to trigger lazy loading
            for _ in range(4):
                await page.evaluate("window.scrollBy(0, 700)")
                await page.wait_for_timeout(700)

            raw_items: list[dict] = await page.evaluate(_EXTRACT_SCRIPT)
            await browser.close()

        # Python-side validation (second layer of defence)
        valid: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in raw_items:
            price = float(item.get("price") or 0)
            name  = _clean_name(str(item.get("name") or ""))
            if price < 0.5 or price > 80:
                continue
            if not _is_valid_meal_name(name):
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            valid.append({
                "meal_name":          name,
                "restaurant_name":    restaurant_name,
                "price_sgd":          round(price, 2),
                "grab_meal_url":      restaurant_url,
                "restaurant_rating":  restaurant_rating,
                "delivery_time_mins": delivery_time_mins,
                "section":            item.get("section", ""),
            })
            if len(valid) >= max_items:
                break

        print(f"  ✓ {restaurant_name}: {len(valid)} items")
        return valid

    except Exception as exc:
        print(f"  ⚠️  Menu scrape failed ({restaurant_name}): {exc}")
        return []


async def scrape_multiple_restaurants(
    restaurants: list[dict[str, Any]],
    latitude: float,
    longitude: float,
    max_per_restaurant: int = 12,
    max_restaurants: int = 4,
) -> list[dict[str, Any]]:
    """
    Scrape menus from up to `max_restaurants` restaurants, 2 at a time.
    Returns a flat list of all unique menu items found.
    """
    targets = restaurants[:max_restaurants]
    all_items: list[dict[str, Any]] = []

    for i in range(0, len(targets), 2):
        batch = targets[i : i + 2]
        tasks = [
            scrape_restaurant_menu(
                restaurant_url=r["grab_meal_url"],
                restaurant_name=r["restaurant_name"],
                restaurant_rating=float(r.get("restaurant_rating") or 4.0),
                delivery_time_mins=int(r.get("delivery_time_mins") or 30),
                latitude=latitude,
                longitude=longitude,
                max_items=max_per_restaurant,
            )
            for r in batch
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for res in results:
            if isinstance(res, list):
                all_items.extend(res)

        if i + 2 < len(targets):
            await asyncio.sleep(2)  # polite gap between batches

    print(f"📦 Total menu items scraped: {len(all_items)}")
    return all_items
