# Nutrition Agent System - Build & Architecture

## Overview

A Python/React web app that reduces decision fatigue around meal ordering by using AI agents to:
1. Learn user nutrition goals & taste preferences
2. Autonomously suggest meals from Grab Food
3. Execute orders (with user confirmation)
4. Collect feedback and improve recommendations

**Tech Stack:** Python 3.11 + FastAPI, React, SQLite, Claude API, Claude in Chrome MCP

**Timeline:** 1-2 days focused build

---

## System Architecture

```
Frontend (React)
    ↓ HTTP ↓
Backend (Python/FastAPI) + Agent Orchestrator
    ↓ Claude API ↓
Three Core Agents:
  1. Preference Profiler Agent
  2. Nutritional Investigator Agent
  3. Feedback Integrator Agent
    ↓ Integrations ↓
External: Grab Food (via Claude in Chrome), FatSecret API, SQLite DB
```

---

## Database Schema

```python
# Users
- id (primary key)
- email
- created_at

# UserPreference
- user_id (primary key)
- weekly_budget_sgd (float)
- diet_goals (JSON: {calories, protein_g, carbs_g, fat_g})
- taste_profile (JSON: {likes: [...], dislikes: [...]})
- meal_timings (JSON: {breakfast, lunch, dinner})
- updated_at

# OrderHistory
- id (primary key, UUID)
- user_id
- date
- restaurant (string)
- dishes (JSON array: [{name, protein_g, calories, ...}])
- total_cost (float)
- meal_type (breakfast/lunch/dinner)

# Feedback
- id (primary key, UUID)
- order_id
- user_id
- taste_rating (1-5)
- satiation (1-5)
- nutrition_accuracy (string: accurate/protein_low/calories_high/very_off)
- would_reorder (1-5)
- notes (text)
- created_at
```

---

## Agent Prompts

### 1. Preference Profiler Agent

**Purpose:** Validate, normalize, and store user preferences. Flag concerns.

```
You are a nutrition preference profiler. Your job is to validate and normalize user preferences for meal recommendations.

Input: User-provided preferences for:
- Weekly budget (SGD)
- Diet goals (calories/macros)
- Taste profile (likes/dislikes)
- Meal timings

Your tasks:
1. Validate inputs (e.g., is budget reasonable for meals/day? Are calories in healthy range?)
2. Normalize formats (e.g., convert 9am to "09:00")
3. Flag concerns/warnings (e.g., "SGD100/week = ~SGD14/meal, tight for diverse meals")
4. Extract implicit constraints (e.g., "hates seafood" → exclude all seafood restaurants)

Output format (JSON only):
{
  "valid": true/false,
  "normalized_prefs": {
    "weekly_budget_sgd": 100,
    "daily_budget_sgd": 14.29,
    "diet_goals": {...},
    "taste_profile": {...},
    "meal_timings": {...}
  },
  "warnings": ["..."],
  "next_step": "ready_for_suggestions"
}

Be strict on validation. If input is invalid, explain why.
Be concise—no paragraphs, JSON only.
```

### 2. Nutritional Investigator Agent

**Purpose:** Search Grab Food, filter by constraints, propose meals with nutrition matching.

```
You are a Nutritional Investigator Agent operating within a user's Grab Food session. Your job is to find 3 meal suggestions that align with their nutritional and budgetary constraints.

User context:
- Weekly budget: SGD {weekly_budget_sgd}
- Daily budget: SGD {daily_budget_sgd}
- Diet goals: {diet_goals_str}
- Taste profile: {taste_profile_str}
- Current meal type: {meal_type} (breakfast/lunch/dinner)
- Location: Singapore
- Recent orders (to avoid repetition): {recent_dishes_str}

Your workflow:
1. Search Grab Food for {meal_type} options
   - Use restaurant names and dish types that match their taste profile
   - Filter by price (must fit daily budget)
2. For each promising dish:
   - Estimate calories and macros from description (use knowledge of typical dishes)
   - Cross-reference with their diet goals
   - Estimate quality of match (% of daily goal)
3. Select 3 diverse options that maximize match across taste + budget + nutrition
4. Prioritize dishes NOT in recent_orders (avoid boredom)

Output format (JSON only):
{
  "suggestions": [
    {
      "rank": 1,
      "dish_name": "...",
      "restaurant_name": "...",
      "cuisine_type": "...",
      "estimated_calories": 650,
      "estimated_protein_g": 35,
      "estimated_carbs_g": 60,
      "estimated_fat_g": 18,
      "price_sgd": 12.50,
      "match_score": 85,
      "match_explanation": "Hits protein goal, within budget, spicy + asian (your taste profile)",
      "grab_search_query": "dish name to search on Grab"
    },
    ... 2 more suggestions ...
  ],
  "note": "All options fit your SGD {daily_budget_sgd}/meal budget and taste preferences"
}

Rules:
- Always return exactly 3 suggestions
- Never suggest the same restaurant twice
- Vary cuisines (if user has eaten asian 3 days, suggest indian/italian)
- Prioritize hit rate on protein goal (user explicitly set it)
- Be realistic about nutrition estimates (overestimate if unsure)
- If budget is very tight (<SGD10/meal), focus on hawker/local spots
- JSON only, no commentary
```

### 3. Feedback Integrator Agent

**Purpose:** Learn from user feedback to improve future suggestions. Detect patterns, track variety, refine recommendations.

```
You are a Feedback Integrator Agent. Your job is to extract learning from meal feedback to improve future recommendations.

Feedback received:
- Dish: {dish_name}
- Restaurant: {restaurant_name}
- User taste rating: {taste_rating}/5
- Satiation: {satiation}/5
- Nutrition accuracy: {nutrition_accuracy} (accurate/protein_low/calories_high/very_off)
- User notes: {notes}

Your tasks:
1. Diagnose what worked/didn't work
   - Was taste rating low? Why? (cooking style, spice, freshness?)
   - Was satiation low? Suggest higher protein or volume next time
   - Was nutrition off? (if protein_low, suggest dishes with explicit protein, e.g., grilled chicken)
2. Extract actionable insights for next recommendation
3. Flag if this dish is repeated too often (variety check)
4. Suggest adjustments to future searches

Output format (JSON only):
{
  "feedback_summary": "Short diagnosis of what worked/didn't",
  "what_worked": ["..."],
  "what_didnt_work": ["..."],
  "nutrition_lesson": "If nutrition was off, what to do next",
  "variety_check": {
    "days_since_similar_dish": N,
    "recommendation": "OK to order again" OR "Too recent, suggest alternative"
  },
  "next_recommendation_adjustments": {
    "priority_macros": ["protein", "..."],
    "avoid_restaurants": ["name"] (if food quality was poor),
    "seek_cuisines": ["..."],
    "priority": "satiation" OR "nutrition" OR "taste"
  },
  "learning_for_system": "Brief note for system memory (e.g., 'User strongly dislikes rice-based meals without protein')"
}

Be concise and actionable. This output directly shapes the next suggestion.
JSON only.
```

---

## API Endpoints

### `/preference` (POST)
Set user preferences. Triggers Preference Profiler Agent.
```json
Request:
{
  "user_id": "user_1",
  "weekly_budget_sgd": 100,
  "diet_goals": {"calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 65},
  "taste_profile": {"likes": ["spicy", "asian"], "dislikes": ["seafood", "oily"]},
  "meal_timings": {"breakfast": "07:00", "lunch": "12:30", "dinner": "19:00"}
}

Response:
{
  "status": "preference_set",
  "agent_validation": {...},
  "ready_for_suggestions": true
}
```

### `/suggest` (POST)
Get meal suggestions. Triggers Nutritional Investigator Agent.
```json
Request:
{
  "user_id": "user_1",
  "meal_type": "lunch"
}

Response:
{
  "suggestions": [
    {
      "rank": 1,
      "dish_name": "...",
      "restaurant_name": "...",
      "estimated_calories": 650,
      "estimated_protein_g": 35,
      "price_sgd": 12.50,
      "match_score": 85,
      "match_explanation": "..."
    },
    ...
  ]
}
```

### `/confirm-order` (POST)
User confirms they want to order (logs intent, stores in DB).
```json
Request:
{
  "user_id": "user_1",
  "restaurant_name": "XYZ Noodles",
  "dish_name": "Spicy Pad Thai",
  "price_sgd": 12.50,
  "meal_type": "lunch"
}

Response:
{
  "status": "order_created",
  "order_id": "order_abc123",
  "message": "Order logged. Please complete on Grab Food.",
  "grab_search_hint": "Spicy Pad Thai"
}
```

### `/feedback` (POST)
Submit post-meal feedback. Triggers Feedback Integrator Agent.
```json
Request:
{
  "user_id": "user_1",
  "order_id": "order_abc123",
  "taste_rating": 4,
  "satiation": 3,
  "nutrition_accuracy": "protein_low",
  "would_reorder": 2,
  "notes": "Good flavor but hungry 2 hours later"
}

Response:
{
  "status": "feedback_received",
  "learning": {
    "feedback_summary": "Good taste but insufficient protein",
    "next_recommendation_adjustments": {...}
  }
}
```

### `/order-history` (GET)
Fetch user's order history for variety tracking.
```json
Response:
{
  "orders": [
    {
      "id": "order_abc123",
      "date": "2025-05-19",
      "restaurant": "XYZ Noodles",
      "dishes": ["Spicy Pad Thai"],
      "total_cost": 12.50,
      "meal_type": "lunch",
      "feedback_rating": 4
    },
    ...
  ]
}
```

---

## Grab Integration Strategy

### Session Persistence Flow

**Problem:** Grab API not available. Solution: User logs in once, system operates within that session.

**Implementation:**

1. **User Login (One-time)**
   - User navigates to embedded Grab login or new tab
   - Logs in to https://food.grab.com/sg/en/ manually
   - Browser stores session cookies

2. **Agent Search Flow (Automated)**
   - Backend calls Claude in Chrome MCP with task: "Search Grab for [query]"
   - Claude navigates Grab using user's existing session
   - Extracts dish names, prices, restaurant names
   - Returns structured data to backend

3. **Order Confirmation (Semi-Automated)**
   - User clicks "Order this" on a suggestion
   - React opens Grab in new tab with search pre-filled
   - User manually adds to cart + completes checkout
   - Backend logs the order intent

4. **Feedback Collection (Automated)**
   - Next meal time, app prompts: "How was your lunch?"
   - User rates + provides feedback
   - System learns and refines next suggestions

### Claude in Chrome MCP Task Template

```python
# Backend calls Claude API with browser automation task
prompt = f"""
You have access to a browser where the user is logged into Grab Food.

Task: Search for {query} on Grab Food (location: Singapore).
Filter by price < SGD {max_price}.
Return top 5 results with:
- Restaurant name
- Dish name
- Price (SGD)
- Brief description (from Grab)

Instructions:
1. Go to https://food.grab.com/sg/en/ (user is logged in)
2. Click search box
3. Type: {query}
4. Wait for results
5. Extract visible results (restaurant + dish + price)
6. Return as JSON array

Return JSON only, no commentary.
"""

# Claude in Chrome executes, returns:
# [
#   {"restaurant": "XYZ", "dish": "Pad Thai", "price": 12.50, "description": "..."},
#   ...
# ]
```

---

## Build Checklist

### Day 1: Foundation
- [ ] Python project scaffold (FastAPI, SQLAlchemy, SQLite)
- [ ] Database schema setup
- [ ] Preference Profiler Agent + `/preference` endpoint
- [ ] React preference form + basic styling
- [ ] End-to-end test: Set preferences → validation → store in DB

### Day 2: Core Loop
- [ ] Nutritional Investigator Agent + `/suggest` endpoint
- [ ] Grab scraping integration (Claude in Chrome MPC task)
- [ ] FatSecret/nutrition API integration (fallback to heuristics)
- [ ] React suggestions UI
- [ ] `/confirm-order` endpoint + order history logging
- [ ] Feedback form + Feedback Integrator Agent + `/feedback` endpoint
- [ ] End-to-end test: Suggest → Confirm → Feedback → Learn

---

## Dependencies

```bash
# Backend
fastapi
uvicorn
pydantic
sqlalchemy
python-dotenv
anthropic
playwright
aiohttp
requests

# Frontend (React)
typescript
react
react-router-dom
axios
```

---

## Key Design Decisions

1. **Session Persistence:** User logs into Grab once. System operates within that browser session using Claude in Chrome MCP.

2. **Agent Orchestration:** All agents called via Claude API (not local LLMs). Each agent has a specific role + clear I/O contract.

3. **Nutrition Data:** Primary = FatSecret API. Fallback = heuristic estimates based on dish names.

4. **Order Execution:** Semi-automated. Agents suggest + confirm, but **user manually completes Grab checkout** to avoid ToS violations & CAPTCHA friction.

5. **Learning Loop:** Feedback directly shapes Nutritional Investigator prompts (recent orders, learned dislikes, macro priorities).

6. **Variety Tracking:** Feedback Integrator tracks days since last similar dish to prevent repetition boredom.

---

## Testing & Validation

### Unit Tests

```python
# test_agents.py
def test_preference_profiler_valid_input():
    # Valid input should return normalized_prefs
    
def test_preference_profiler_invalid_budget():
    # Budget < SGD 5/week should flag warning
    
def test_nutritional_investigator_respects_budget():
    # All suggestions must be < daily_budget_sgd
    
def test_nutritional_investigator_avoids_dislikes():
    # If user dislikes seafood, no seafood dishes suggested
    
def test_feedback_integrator_detects_pattern():
    # Low satiation → next suggestions should increase protein
```

### End-to-End Flow

1. User sets preferences (SGD 100/week, 2000 cal/day, 150g protein, likes spicy, dislikes seafood)
2. Request suggestions for lunch
3. Receive 3 options (e.g., spicy chicken rice, thai curry, korean beef bowl)
4. Confirm one order
5. Next day: submit feedback ("Good but protein was low")
6. Request lunch suggestions again
7. Verify next suggestions have more explicit protein dishes

---

## Deployment Checklist

- [ ] Environment variables (.env): ANTHROPIC_API_KEY, FATSECRET_API_KEY
- [ ] Database migrations (SQLAlchemy)
- [ ] CORS config for React frontend
- [ ] Rate limiting on Claude API calls (avoid budget overruns)
- [ ] Error handling & logging (FastAPI middleware)
- [ ] Frontend build: `npm run build`
- [ ] Host backend on Render/Railway, frontend on Vercel

---

## Future Enhancements

1. **Real Grab API Integration:** Once available, replace Claude in Chrome scraping with direct API calls.
2. **Multi-User Profiles:** Support household members with different goals.
3. **Real Nutrition Data:** Integrate with MealDB or restaurant nutrition databases.
4. **Predictive Ordering:** AI predicts next meal time + suggests 30 mins before (no user action).
5. **Macro Tracking:** Show cumulative macros across day (breakfast + lunch + dinner plan).
6. **Restaurant Blacklist:** Learn which restaurants have poor quality/hygiene based on feedback.
7. **Group Ordering:** Suggest meals for multiple people simultaneously.
8. **Budget Alerts:** Notify user if trending over weekly budget.

---

## Contact & Notes

- Build time estimate: 1-2 focused days
- Main risk: Grab scraping reliability (site structure changes)
- Mitigation: Use Claude in Chrome's flexibility + manual fallback
- Success metric: User receives 3 meal options within 10 seconds that match ≥80% of constraints