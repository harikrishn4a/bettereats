"""
Nutrition Enrichment — 3-layer fallback

1. FatSecret API (database lookup)
2. Claude estimate (meal name + restaurant context)
3. Heuristic keyword rules (last resort)
"""

import asyncio
import json
import os
from decimal import Decimal
from typing import List, Dict, Optional, Any

import anthropic
from dotenv import load_dotenv
try:
    from fatsecret import Fatsecret as _Fatsecret
    _FATSECRET_AVAILABLE = True
except ImportError:
    _Fatsecret = None  # type: ignore[assignment,misc]
    _FATSECRET_AVAILABLE = False

load_dotenv()

_claude_client = anthropic.AsyncAnthropic()


def _float_val(value: Decimal | float | int | str | None) -> float:
    if value is None:
        return 0.0
    return float(value)


def _pick_serving(food: Any) -> Any | None:
    """Return default serving if flagged, otherwise the first serving."""
    servings_wrapper = getattr(food, "servings", None)
    if not servings_wrapper:
        return None
    servings = getattr(servings_wrapper, "serving", None)
    if not servings:
        return None
    if not isinstance(servings, list):
        servings = [servings]
    for serving in servings:
        if getattr(serving, "is_default", None):
            return serving
    return servings[0]


def _parse_claude_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


def _nutrition_payload(
    *,
    food_name: str,
    calories: float,
    protein: float,
    carbs: float,
    fat: float,
    confidence: float,
    source: str,
) -> Dict:
    return {
        "food_name": food_name,
        "estimated_calories": calories,
        "estimated_protein_g": protein,
        "estimated_carbs_g": carbs,
        "estimated_fat_g": fat,
        "estimation_confidence": confidence,
        "source": source,
    }


class NutritionEnricher:
    """
    Enriches meal data with nutrition information using FatSecret API.
    """
    
    def __init__(self):
        """Initialize FatSecret API client."""
        self.client_id = os.getenv("FATSECRET_CLIENT_ID")
        self.client_secret = os.getenv("FATSECRET_CLIENT_SECRET")

        if not self.client_id or not self.client_secret:
            print("⚠️ FatSecret credentials not found in env variables")
            print("Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET")

        if _FATSECRET_AVAILABLE and self.client_id and self.client_secret:
            auth_mode = os.getenv("FATSECRET_AUTH", "oauth2")
            self.fs = _Fatsecret(
                self.client_id,
                self.client_secret,
                auth=auth_mode,  # type: ignore[arg-type]
            )
        else:
            self.fs = None  # will skip FatSecret layer in search_food_on_fatsecret
    
    def search_food_on_fatsecret(self, food_name: str) -> Optional[Dict]:
        """
        Search FatSecret for a food item.
        
        Args:
            food_name: Name of the food (e.g., "Falafel", "Chicken Rice")
        
        Returns:
            Dict with nutrition data or None if not found
        """
        if not food_name.strip() or not self.fs:
            return None

        try:
            # ChocoTonic fatsecret SDK: fs.foods.search_v* (not legacy foods_search)
            results = self.fs.foods.search_v2(
                search_expression=food_name,
                page_number=0,
                max_results=1,
                flag_default_serving=True,
                region=os.getenv("FATSECRET_REGION", "SG"),
            )

            if not results:
                return None

            food = results[0]
            serving = _pick_serving(food)
            if not serving:
                return None

            return _nutrition_payload(
                food_name=food.food_name or food_name,
                calories=_float_val(serving.calories),
                protein=_float_val(serving.protein),
                carbs=_float_val(serving.carbohydrate),
                fat=_float_val(serving.fat),
                confidence=0.95,
                source="fatsecret",
            )
        
        except Exception as e:
            print(f"Error searching FatSecret: {e}")
            return None

    async def estimate_nutrition_claude(self, meal_data: Dict) -> Optional[Dict]:
        """
        Layer 2: Ask Claude to estimate macros from meal name and restaurant context.
        """
        meal_name = (meal_data.get("meal_name") or meal_data.get("name") or "").strip()
        restaurant = (
            meal_data.get("restaurant_name")
            or meal_data.get("restaurant")
            or "Unknown restaurant"
        )
        price_sgd = meal_data.get("price_sgd")

        if not meal_name:
            return None
        if not os.getenv("ANTHROPIC_API_KEY"):
            print("⚠️ ANTHROPIC_API_KEY not set — skipping Claude nutrition estimate")
            return None

        price_line = f"\n- Price: SGD {price_sgd}" if price_sgd is not None else ""

        prompt = f"""You are a nutrition estimator for a Singapore food delivery app.

Estimate the typical macros for ONE standard serving of this dish as sold on GrabFood.

Meal: "{meal_name}"
Restaurant: "{restaurant}"{price_line}

Assume a normal single-person portion (not shared). Use typical Singapore hawker / restaurant portions.

Return ONLY valid JSON — no markdown, no commentary:
{{
  "estimated_calories": <number>,
  "estimated_protein_g": <number>,
  "estimated_carbs_g": <number>,
  "estimated_fat_g": <number>
}}"""

        try:
            response = await _claude_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=256,
                messages=[{"role": "user", "content": prompt}],
            )
            data = _parse_claude_json(response.content[0].text)
            return _nutrition_payload(
                food_name=meal_name,
                calories=float(data["estimated_calories"]),
                protein=float(data["estimated_protein_g"]),
                carbs=float(data["estimated_carbs_g"]),
                fat=float(data["estimated_fat_g"]),
                confidence=0.85,
                source="claude",
            )
        except Exception as e:
            print(f"Error estimating with Claude: {e}")
            return None
    
    def estimate_nutrition_heuristic(self, meal_data: Dict) -> Dict:
        """
        Fallback: Estimate nutrition using heuristics if FatSecret search fails.
        
        Uses meal name, description, and cuisine type to estimate macros.
        """
        meal_name = meal_data.get('meal_name', '').lower()
        description = meal_data.get('description', '').lower()
        cuisine = meal_data.get('cuisine', '').lower()
        price = meal_data.get('price_sgd', 10)
        
        # Identify meal type from name/description
        keywords = f"{meal_name} {description}".lower()
        
        # Initialize with defaults
        calories = 600
        protein = 25
        carbs = 70
        fat = 15
        
        # Adjust based on cuisine/ingredients
        if any(word in keywords for word in ['rice', 'risotto']):
            calories = 700
            carbs = 85
            fat = 15
        elif any(word in keywords for word in ['noodle', 'pasta', 'spaghetti']):
            calories = 650
            carbs = 80
            fat = 15
        elif any(word in keywords for word in ['salad', 'vegetable']):
            calories = 350
            protein = 15
            carbs = 40
            fat = 10
        elif any(word in keywords for word in ['burger', 'sandwich', 'wrap']):
            calories = 600
            protein = 30
            carbs = 60
            fat = 20
        elif any(word in keywords for word in ['kebab', 'shawarma', 'doner']):
            calories = 550
            protein = 35
            carbs = 50
            fat = 18
        elif any(word in keywords for word in ['curry', 'thai']):
            calories = 650
            protein = 25
            carbs = 70
            fat = 22
        elif any(word in keywords for word in ['pizza']):
            calories = 700
            protein = 20
            carbs = 85
            fat = 25
        
        # Adjust protein if meat is mentioned
        if any(word in keywords for word in ['chicken', 'beef', 'lamb', 'pork', 'meat']):
            protein = min(40, protein + 10)
        
        # Adjust if vegetarian/vegan
        if any(word in keywords for word in ['vegetarian', 'vegan', 'tofu']):
            protein = min(25, protein)
        
        # Adjust if seafood
        if any(word in keywords for word in ['fish', 'salmon', 'tuna', 'shrimp']):
            protein = 35
            calories = 500
        
        return _nutrition_payload(
            food_name=meal_data.get("meal_name", ""),
            calories=calories,
            protein=protein,
            carbs=carbs,
            fat=fat,
            confidence=0.70,
            source="heuristic",
        )
    
    @staticmethod
    def _is_plausible(nutrition: Dict) -> bool:
        """
        Sanity-check FatSecret results against realistic ranges for a single Grab meal serving.

        A main dish should have:
          calories  : 150 – 1 500 kcal
          protein   : 3 – 100 g
          carbs     : 3 – 200 g
          fat       : 1 – 100 g

        Any result outside these bounds is likely a wrong match (e.g. "mala" matched a spice packet).
        """
        cal  = float(nutrition.get("estimated_calories") or 0)
        prot = float(nutrition.get("estimated_protein_g") or 0)
        carb = float(nutrition.get("estimated_carbs_g") or 0)
        fat  = float(nutrition.get("estimated_fat_g") or 0)

        return (
            150 <= cal  <= 1_500 and
            3   <= prot <= 100   and
            3   <= carb <= 200   and
            1   <= fat  <= 100
        )

    async def enrich_meal(self, meal: Dict) -> Dict:
        """
        Enrich a single meal with nutrition data.

        Flow:
        1. FatSecret (exact name, then first keyword) — accepted only if values pass sanity check
        2. Claude API estimate  — if FatSecret absent or implausible
        3. Heuristic keywords   — last resort
        """
        meal_name = meal.get("meal_name", "")
        nutrition: Optional[Dict] = None

        # ── Layer 1: FatSecret ───────────────────────────────────────────────
        for query in [meal_name, (meal_name.split()[0] if meal_name else "")]:
            candidate = await asyncio.to_thread(self.search_food_on_fatsecret, query)
            if candidate:
                if self._is_plausible(candidate):
                    nutrition = candidate
                    break
                else:
                    print(
                        f"⚠️  FatSecret result for '{query}' failed sanity check "
                        f"(cal={candidate.get('estimated_calories')}, "
                        f"prot={candidate.get('estimated_protein_g')}g) — falling back to Claude"
                    )

        # ── Layer 2: Claude estimate ─────────────────────────────────────────
        if not nutrition:
            nutrition = await self.estimate_nutrition_claude(meal)

        # ── Layer 3: Heuristic ───────────────────────────────────────────────
        if not nutrition:
            nutrition = self.estimate_nutrition_heuristic(meal)

        meal.update(nutrition)
        return meal


async def enrich_meals_with_nutrition(
    meals: List[Dict],
    meal_type: str = "lunch"
) -> List[Dict]:
    """
    Add nutrition data to meals using a 3-layer pipeline:
    FatSecret → Claude → heuristic.
    
    Args:
        meals: List of meals from Grab
        meal_type: "breakfast", "lunch", or "dinner"
    
    Returns:
        Same meals with nutrition data
    """
    
    enricher = NutritionEnricher()
    enriched_meals = []
    
    print(f"🔬 Enriching {len(meals)} meals with nutrition data...")
    
    # Process meals concurrently (faster)
    tasks = [enricher.enrich_meal(meal.copy()) for meal in meals]
    enriched_meals = await asyncio.gather(*tasks)
    
    # Log results
    sources = {}
    for meal in enriched_meals:
        source = meal.get('source', 'unknown')
        sources[source] = sources.get(source, 0) + 1
    
    print(f"✓ Enriched {len(enriched_meals)} meals")
    for source, count in sources.items():
        print(f"  - {count} from {source}")
    
    return enriched_meals


# Quick test
if __name__ == "__main__":
    async def test():
        # Test with sample meals
        test_meals = [
            {
                "meal_name": "Falafel Donner Kebab",
                "restaurant_name": "Kebabs Faktory",
                "price_sgd": 11.90
            },
            {
                "meal_name": "Chicken Fried Rice",
                "restaurant_name": "XYZ Noodles",
                "price_sgd": 12.50
            }
        ]
        
        enriched = await enrich_meals_with_nutrition(test_meals)
        
        for meal in enriched:
            print(f"\n{meal['meal_name']}")
            print(f"  Calories: {meal.get('estimated_calories')} kcal")
            print(f"  Protein: {meal.get('estimated_protein_g')}g")
            print(f"  Confidence: {meal.get('estimation_confidence')} ({meal.get('source')})")
    
    asyncio.run(test())