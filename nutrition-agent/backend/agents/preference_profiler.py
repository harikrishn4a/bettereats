import anthropic
import json


client = anthropic.Anthropic()


async def preference_profiler_agent(user_input) -> dict:
    prompt = f"""
You are a nutrition preference profiler. A user has provided their preferences:
- Weekly budget: SGD {user_input.weekly_budget_sgd}
- Diet goals: {json.dumps(user_input.diet_goals)}
- Taste profile: {json.dumps(user_input.taste_profile)}
- Meal timings: {json.dumps(user_input.meal_timings)}

Your job:
1. Validate these inputs (e.g., is budget reasonable, are calories in healthy range)
2. Normalize them (e.g., convert breakfast time to standard 24h format)
3. Flag any concerns (e.g., "budget is tight for 3 meals/day")
4. Return a JSON response with:
   - "valid": true/false
   - "normalized_prefs": {{...}}
   - "warnings": [...]
   - "next_step": "suggest_initial_meals"

Be concise and data-focused. Return JSON only, no commentary.
"""
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    # Strip markdown code fences if the model wraps the JSON
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())
