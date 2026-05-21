"""
Debug Grab scraper - see exactly what's happening
"""

import asyncio
import json
import re
from playwright.async_api import async_playwright

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_GEO_INIT_SCRIPT = """
(() => {
  const lat = __LAT__;
  const lng = __LNG__;
  const pos = () => ({ coords: { latitude: lat, longitude: lng, accuracy: 50 }, timestamp: Date.now() });
  navigator.geolocation.getCurrentPosition = (ok) => ok(pos());
  navigator.geolocation.watchPosition = (ok) => { ok(pos()); return 0; };
})();
"""


async def debug_grab():
    """Debug Grab scraping step by step."""
    
    latitude = 1.2763
    longitude = 103.8451
    
    print("\n" + "="*60)
    print("🔍 GRAB SCRAPER DEBUG")
    print("="*60)
    print(f"Location: {latitude}, {longitude}")
    print("="*60 + "\n")
    
    async with async_playwright() as p:
        try:
            # Try chrome channel first
            print("📱 Launching browser...")
            try:
                browser = await p.chromium.launch(channel="chrome", headless=True)
                print("✓ Launched with Chrome channel")
            except Exception as e:
                print(f"⚠️  Chrome channel failed: {e}")
                print("  Trying default Chromium...")
                browser = await p.chromium.launch(headless=True)
                print("✓ Launched with default Chromium")
            
            # Create context with geolocation
            print("\n📍 Setting up geolocation context...")
            context = await browser.new_context(
                viewport={"width": 1280, "height": 900},
                geolocation={"latitude": latitude, "longitude": longitude},
                permissions=["geolocation"],
                user_agent=_USER_AGENT,
                locale="en-SG",
            )
            print("✓ Context created with geolocation")
            
            # Add init script
            geo_script = _GEO_INIT_SCRIPT.replace("__LAT__", str(latitude)).replace("__LNG__", str(longitude))
            await context.add_init_script(geo_script)
            print("✓ Geolocation script injected")
            
            # Grant permissions
            await context.grant_permissions(["geolocation"], origin="https://food.grab.com")
            print("✓ Geolocation permissions granted")
            
            page = await context.new_page()
            
            # STEP 1: Visit home page
            print("\n" + "-"*60)
            print("STEP 1: Visit Grab home page")
            print("-"*60)
            
            home_url = "https://food.grab.com/sg/en/"
            print(f"Going to: {home_url}")
            
            try:
                response = await page.goto(home_url, wait_until="domcontentloaded", timeout=25000)
                print(f"✓ Loaded (status: {response.status if response else 'unknown'})")
            except Exception as e:
                print(f"❌ Failed to load: {e}")
                await browser.close()
                return
            
            await page.wait_for_timeout(3000)
            print("✓ Waited 3 seconds")
            
            # STEP 2: Check what's on the page
            print("\n" + "-"*60)
            print("STEP 2: Analyze page content")
            print("-"*60)
            
            page_title = await page.title()
            print(f"Page title: {page_title}")
            
            # Get page text
            page_text = await page.evaluate("() => document.body.innerText")
            lines = [l.strip() for l in page_text.split('\n') if l.strip()]
            print(f"Page text length: {len(page_text)} chars")
            print(f"Lines of text: {len(lines)}")
            print("\nFirst 15 lines:")
            for i, line in enumerate(lines[:15], 1):
                print(f"  {i}. {line[:80]}")
            
            # STEP 3: Look for restaurant links
            print("\n" + "-"*60)
            print("STEP 3: Search for restaurant links")
            print("-"*60)
            
            links = await page.evaluate("() => Array.from(document.querySelectorAll('a[href*=\"/restaurant/\"]')).map(a => ({ text: a.textContent, href: a.href }))")
            print(f"Found {len(links)} links with '/restaurant/'")
            
            if links:
                print("\nFirst 5 restaurant links:")
                for i, link in enumerate(links[:5], 1):
                    print(f"  {i}. Text: {link['text'][:60]}")
                    print(f"     URL: {link['href'][:100]}")
            else:
                print("⚠️  NO RESTAURANT LINKS FOUND on homepage")
            
            # STEP 4: Try search page
            print("\n" + "-"*60)
            print("STEP 4: Navigate to search page")
            print("-"*60)
            
            search_url = "https://food.grab.com/sg/en/restaurants?search=chicken-rice"
            print(f"Going to: {search_url}")
            
            try:
                response = await page.goto(search_url, wait_until="domcontentloaded", timeout=25000)
                print(f"✓ Loaded (status: {response.status if response else 'unknown'})")
            except Exception as e:
                print(f"❌ Failed to load: {e}")
                await browser.close()
                return
            
            await page.wait_for_timeout(4000)
            print("✓ Waited 4 seconds")
            
            # STEP 5: Check search results
            print("\n" + "-"*60)
            print("STEP 5: Analyze search results")
            print("-"*60)
            
            search_links = await page.evaluate("() => Array.from(document.querySelectorAll('a[href*=\"/restaurant/\"]')).map(a => ({ text: a.textContent, href: a.href }))")
            print(f"Found {len(search_links)} restaurant links on search page")
            
            if search_links:
                print("\nFirst 10 results:")
                for i, link in enumerate(search_links[:10], 1):
                    text = re.sub(r"\s+", " ", link["text"]).strip()[:70]
                    print(f"  {i}. {text}")
            else:
                print("⚠️  NO RESULTS ON SEARCH PAGE")
                
                # Check if page is showing "no results" message
                page_text = await page.evaluate("() => document.body.innerText")
                if "no restaurant" in page_text.lower() or "not found" in page_text.lower():
                    print("📝 Page shows: No restaurants found")
                else:
                    print("📝 Page might be loading or has different structure")
            
            # STEP 6: Save screenshots and HTML
            print("\n" + "-"*60)
            print("STEP 6: Save debug files")
            print("-"*60)
            
            # Screenshot of home page
            print("Taking screenshot of homepage...")
            await page.goto(home_url)
            await page.wait_for_timeout(2000)
            await page.screenshot(path="/tmp/grab_home.png")
            print("✓ Screenshot saved: /tmp/grab_home.png")
            
            # Screenshot of search page
            print("Taking screenshot of search page...")
            await page.goto(search_url)
            await page.wait_for_timeout(2000)
            await page.screenshot(path="/tmp/grab_search.png")
            print("✓ Screenshot saved: /tmp/grab_search.png")
            
            # Save HTML
            html = await page.content()
            with open("/tmp/grab_search.html", "w") as f:
                f.write(html)
            print(f"✓ HTML saved: /tmp/grab_search.html ({len(html)} bytes)")
            
            # STEP 7: Check for blocking
            print("\n" + "-"*60)
            print("STEP 7: Check for anti-bot detection")
            print("-"*60)
            
            detection = await page.evaluate("""
                () => ({
                    webdriver: navigator.webdriver,
                    chromeObj: !!window.chrome,
                    playwrightObj: !!window.__playwright,
                    headless: navigator.hardwareConcurrency === undefined,
                    userAgent: navigator.userAgent
                })
            """)
            
            print(f"WebDriver detected: {detection['webdriver']}")
            print(f"Chrome object: {detection['chromeObj']}")
            print(f"Playwright object: {detection['playwrightObj']}")
            print(f"User Agent: {detection['userAgent']}")
            
            # STEP 8: Try JavaScript extraction
            print("\n" + "-"*60)
            print("STEP 8: Try JavaScript extraction")
            print("-"*60)
            
            await page.goto(search_url)
            await page.wait_for_timeout(4000)
            
            extract_script = r"""
            () => {
                const meals = [];
                const links = document.querySelectorAll('a[href*="/restaurant/"]');
                console.log(`Found ${links.length} links`);
                
                for (const a of links) {
                    const href = a.href;
                    const text = a.textContent;
                    
                    if (text.length > 3) {
                        meals.push({
                            text: text.slice(0, 100),
                            href: href.slice(0, 150)
                        });
                    }
                }
                
                return meals;
            }
            """
            
            extracted = await page.evaluate(extract_script)
            print(f"Extracted {len(extracted)} items")
            
            if extracted:
                print("\nExtracted items:")
                for item in extracted[:5]:
                    print(f"  Text: {item['text']}")
                    print(f"  URL: {item['href']}\n")
            else:
                print("⚠️  Nothing extracted")
            
            # STEP 9: Summary
            print("\n" + "="*60)
            print("📊 SUMMARY")
            print("="*60)
            
            print(f"""
Issues found:
1. Home page links: {len(links)}
2. Search page links: {len(search_links)}
3. Extracted items: {len(extracted)}

Browser info:
- WebDriver detected: {detection['webdriver']}
- User agent: Chrome/120

Debug files saved:
- /tmp/grab_home.png
- /tmp/grab_search.png
- /tmp/grab_search.html

Next steps:
1. Check screenshots to see what Grab looks like
2. Check HTML file to see page structure
3. Look for "no results" message
4. Verify your location (lat/lng) is valid
            """)
            
            await browser.close()
            
        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(debug_grab())