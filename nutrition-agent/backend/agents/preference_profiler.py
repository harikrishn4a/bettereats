import anthropic
import json

client = anthropic.Anthropic()

async def preferance_profiler_agent(user_input):
    """
    Agent that validates and normalizes user preferences.
    """
    prompt = f"""
You are a nutrition preference profiler. A user has provided their preferences:
- Weekly budget: ${user_input.weekly_budget_sgd}
- Diet goals: {json.dumps(user_input.diet_goals)}
- Taste profile: {json.dumps(user_input.taste_profile)}
- Meal timings: {json.dumps(user_input.meal_timings)}

Your job:
1. Validate these inputs (e.g., is budget reasonable, are calories in healthy range)
2. Normalize them (e.g., convert breakfast time to standard format)
3. Flag any concerns (e.g., "budget is tight for 3 meals/day")
4. Return a JSON response with:
   - "valid": true/false
   - "normalized_prefs": {...}
   - "warnings": [...]
   - "next_step": "suggest_initial_meals"

Be concise and data-focused.
""" 
    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=500,
        messages=[
            {"role": "user", "content": prompt}
        ]
    )
    return json.loads(response.content[0].text)
