import json
import anthropic as _anthropic

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, init_db
from models import User, UserPreference
from schemas import (
    PreferenceInput, PreferenceResponse,
    OnboardingStartRequest, OnboardingChatRequest, OnboardingChatResponse,
    OnboardingCompleteRequest, OnboardingCompleteResponse,
    AgentResponse, MacroResult, MacroBreakdown,
    SuggestionsResponse,
)
from agents.preference_profiler import preference_profiler_agent
from agents.onboarding_conversationalist import start_onboarding, process_chat
from agents.macro_calculator import calculate_macros
from agents.meal_suggester import get_meal_suggestions

app = FastAPI(title="Better Eats API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    init_db()


# ── Onboarding chat endpoints ─────────────────────────────────────────────────

@app.post("/onboarding/start")
async def onboarding_start(
    req: OnboardingStartRequest, db: Session = Depends(get_db)
) -> dict:
    user = db.get(User, req.user_id)
    if not user:
        user = User(id=req.user_id)
        db.add(user)

    pref = db.get(UserPreference, req.user_id)
    if not pref:
        pref = UserPreference(
            user_id=req.user_id,
            onboarding_complete=False,
            onboarding_step="greeting",
            conversation_history=[],
        )
        db.add(pref)

    db.commit()

    greeting = await start_onboarding()
    return {"agent_response": greeting, "current_step": "greeting"}


@app.post("/onboarding/chat", response_model=OnboardingChatResponse)
async def onboarding_chat(
    req: OnboardingChatRequest, db: Session = Depends(get_db)
) -> OnboardingChatResponse:
    raw = await process_chat(
        current_step=req.current_step,
        user_message=req.message,
        conversation_history=[item.model_dump() for item in req.conversation_history],
        accumulated_data=req.accumulated_data,
    )

    pref = db.get(UserPreference, req.user_id)
    if pref:
        pref.onboarding_step = raw.get("next_step", req.current_step)
        db.commit()

    return OnboardingChatResponse(
        agent_response=AgentResponse(**raw),
        current_step=raw.get("next_step", req.current_step),
    )


@app.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def onboarding_complete(
    req: OnboardingCompleteRequest, db: Session = Depends(get_db)
) -> OnboardingCompleteResponse:
    data = dict(req.accumulated_data)  # mutable copy

    # ── Infer missing diet_goal from weight_goal_direction when possible ───────
    if not data.get("diet_goal"):
        direction = str(data.get("weight_goal_direction") or "")
        data["diet_goal"] = (
            "build_muscle" if direction == "gain"
            else "fat_loss" if direction == "loss"
            else "eat_healthier"          # safe default
        )

    # ── Infer activity_level default if somehow missing ────────────────────────
    if not data.get("activity_level"):
        data["activity_level"] = "moderately_active"

    required = ["age", "weight_kg", "height_cm", "gender", "activity_level", "diet_goal"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot calculate macros — missing: {missing}",
        )

    # Base macros (TDEE, BMR)
    base_macros = calculate_macros(
        age=int(data["age"]),
        weight_kg=float(data["weight_kg"]),
        height_cm=float(data["height_cm"]),
        gender=str(data["gender"]),
        activity_level=str(data["activity_level"]),
        diet_goal=str(data["diet_goal"]),
    )

    # Use goal-adjusted macros if they were calculated during onboarding (goal_validation step)
    adjusted = data.get("adjusted_macros")
    if adjusted and isinstance(adjusted, dict) and adjusted.get("calories"):
        final_macros_dict = adjusted
    else:
        final_macros_dict = base_macros["macros"]

    user = db.get(User, req.user_id)
    if not user:
        user = User(id=req.user_id)
        db.add(user)

    pref = db.get(UserPreference, req.user_id)
    if not pref:
        pref = UserPreference(user_id=req.user_id)
        db.add(pref)

    taste = data.get("taste_profile", {"likes": [], "dislikes": []})

    # ── Core fields ───────────────────────────────────────────────────────────
    pref.onboarding_complete = True
    pref.onboarding_step     = "done"
    pref.age                 = int(data["age"])
    pref.gender              = str(data["gender"])
    pref.weight_kg           = float(data["weight_kg"])
    pref.height_cm           = float(data["height_cm"])
    pref.diet_goal           = str(data["diet_goal"])
    pref.activity_level      = str(data["activity_level"])
    pref.weekly_budget_sgd   = float(data.get("weekly_budget_sgd", 0))
    if data.get("meals_per_week"):
        pref.meals_per_week = int(data["meals_per_week"])
    pref.taste_profile       = taste
    pref.meal_timings        = data.get("meal_timings", {})

    # ── Baseline macros ───────────────────────────────────────────────────────
    pref.bmr                  = base_macros["bmr"]
    pref.tdee                 = base_macros["tdee"]
    pref.maintenance_calories = base_macros["tdee"]

    # ── Goal-adjusted macros ──────────────────────────────────────────────────
    pref.daily_calories  = float(final_macros_dict["calories"])
    pref.daily_protein_g = float(final_macros_dict["protein_g"])
    pref.daily_carbs_g   = float(final_macros_dict["carbs_g"])
    pref.daily_fat_g     = float(final_macros_dict["fat_g"])
    pref.diet_goals      = final_macros_dict   # legacy field in sync

    # ── Weight goal metadata ──────────────────────────────────────────────────
    if data.get("weight_goal_kg"):
        pref.weight_goal_kg        = float(data["weight_goal_kg"])
        pref.weight_goal_direction = str(data.get("weight_goal_direction", "loss"))
    if data.get("target_timeline_weeks"):
        pref.target_timeline_weeks = int(data["target_timeline_weeks"])
    if data.get("realism_status"):
        pref.realism_status = str(data["realism_status"])
    if data.get("weekly_deficit_kcal"):
        pref.weekly_deficit_kcal = float(data["weekly_deficit_kcal"])
    if data.get("daily_deficit_kcal"):
        pref.daily_deficit_kcal = float(data["daily_deficit_kcal"])

    db.commit()

    return OnboardingCompleteResponse(
        status="onboarding_complete",
        macros=MacroResult(
            bmr=base_macros["bmr"],
            tdee=base_macros["tdee"],
            adjusted_calories=int(final_macros_dict["calories"]),
            macros=MacroBreakdown(**final_macros_dict),
        ),
        message="Your personalised nutrition plan is ready!",
    )


# ── Preference endpoints ─────────────────────────────────────────────────────

def _upsert_user_preferences(data: PreferenceInput, db: Session) -> None:
    user = db.get(User, data.user_id)
    if not user:
        user = User(id=data.user_id)
        db.add(user)

    pref = db.get(UserPreference, data.user_id)
    if pref:
        pref.weekly_budget_sgd = data.weekly_budget_sgd
        pref.diet_goals = data.diet_goals
        pref.taste_profile = data.taste_profile
        pref.meal_timings = data.meal_timings
    else:
        pref = UserPreference(
            user_id=data.user_id,
            weekly_budget_sgd=data.weekly_budget_sgd,
            diet_goals=data.diet_goals,
            taste_profile=data.taste_profile,
            meal_timings=data.meal_timings,
        )
        db.add(pref)

    db.commit()


@app.post("/preferences")
async def set_preferences(
    data: PreferenceInput, db: Session = Depends(get_db)
) -> dict:
    _upsert_user_preferences(data, db)
    return {
        "status": "success",
        "message": "Preferences saved successfully",
        "user_id": data.user_id,
    }


@app.get("/preferences/{user_id}")
async def get_preferences(
    user_id: str, db: Session = Depends(get_db)
) -> dict:
    pref = db.get(UserPreference, user_id)
    if not pref:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "user_id": user_id,
        "weekly_budget_sgd": pref.weekly_budget_sgd,
        "diet_goals": pref.diet_goals,
        "taste_profile": pref.taste_profile,
        "meal_timings": pref.meal_timings,
        "onboarding_complete": pref.onboarding_complete,
    }


@app.post("/preference", response_model=PreferenceResponse)
async def set_preference(
    data: PreferenceInput, db: Session = Depends(get_db)
) -> PreferenceResponse:
    result = await preference_profiler_agent(data)
    _upsert_user_preferences(data, db)

    return PreferenceResponse(
        status="preference_set",
        agent_validation=result,
        ready_for_suggestions=result.get("valid", False),
    )


@app.post("/suggest", response_model=SuggestionsResponse)
async def suggest_meals(
    user_id: str,
    meal_type: str,
    latitude: float,
    longitude: float,
    db: Session = Depends(get_db),
) -> SuggestionsResponse:
    if meal_type not in {"breakfast", "lunch", "dinner"}:
        raise HTTPException(status_code=400, detail="meal_type must be breakfast, lunch, or dinner")

    pref = db.get(UserPreference, user_id)
    if not pref:
        raise HTTPException(status_code=404, detail="User not found. Complete onboarding first.")

    diet_goals = pref.diet_goals if isinstance(pref.diet_goals, dict) else {}
    user_prefs = {
        "adjusted_calories": pref.daily_calories or diet_goals.get("calories"),
        "adjusted_protein_g": pref.daily_protein_g or diet_goals.get("protein_g"),
        "adjusted_carbs_g": pref.daily_carbs_g or diet_goals.get("carbs_g"),
        "adjusted_fat_g": pref.daily_fat_g or diet_goals.get("fat_g"),
        "diet_goals": diet_goals,
        "taste_profile": pref.taste_profile or {},
        "weekly_budget_sgd": pref.weekly_budget_sgd,
        "meals_per_week": pref.meals_per_week,
    }

    suggestions, search_source = await get_meal_suggestions(
        user_id=user_id,
        meal_type=meal_type,
        user_prefs=user_prefs,
        latitude=latitude,
        longitude=longitude,
    )

    if not suggestions:
        raise HTTPException(status_code=500, detail="Failed to get suggestions. Please try again.")

    message = (
        "Perfect! Here are 3 meals from Grab matched to your nutrition goals."
        if search_source == "grab"
        else "Here are 3 sample meals matched to your goals (Grab search unavailable — showing curated picks)."
    )

    return SuggestionsResponse(
        meal_type=meal_type,
        suggestions=suggestions,
        message=message,
        search_source=search_source,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ── Culinary chat streaming endpoint ─────────────────────────────────────────
# Implements the AI SDK Data Stream Protocol (ai@4.x) consumed by useChat({ api }).

_CULINARY_SYSTEM_PROMPT = """You are bettereats, a warm and knowledgeable culinary assistant.

Your role:
- Help people cook confidently and joyfully
- For recipes, output clean markdown: a bullet-point ingredients list, then numbered steps
- When an ingredient is missing, proactively suggest a smart swap
- Keep responses concise and encouraging — like a knowledgeable friend in the kitchen
- Avoid filler phrases and unnecessary health caveats
- If asked something unrelated to food or cooking, gently redirect back to culinary topics"""


def _extract_text(msg: dict) -> str:
    """Extract plain text from an AI SDK UIMessage (parts format or legacy content string)."""
    parts = msg.get("parts") or []
    if parts:
        return "".join(p.get("text", "") for p in parts if p.get("type") == "text")
    content = msg.get("content", "")
    return content if isinstance(content, str) else ""


@app.post("/api/chat")
async def api_chat(request: Request) -> StreamingResponse:
    body = await request.json()
    raw_messages: list[dict] = body.get("messages", [])

    # Build Anthropic-format message list (user/assistant only)
    anthropic_msgs = [
        {"role": m["role"], "content": _extract_text(m)}
        for m in raw_messages
        if m.get("role") in ("user", "assistant") and _extract_text(m).strip()
    ]

    async def generate():
        # ai@4.3.x with useChat({ api }) expects the AI SDK Data Stream Protocol:
        #   0:"text chunk"\n  — streamed text
        #   3:"error msg"\n   — error (if any)
        #   d:{...}\n         — finish message (usage, finishReason)
        client = _anthropic.AsyncAnthropic()

        prompt_tokens = 0
        completion_tokens = 0

        try:
            async with client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=_CULINARY_SYSTEM_PROMPT,
                messages=anthropic_msgs or [{"role": "user", "content": "Hello"}],
            ) as stream:
                async for chunk in stream.text_stream:
                    yield f"0:{json.dumps(chunk)}\n"

                final = await stream.get_final_message()
                prompt_tokens = final.usage.input_tokens
                completion_tokens = final.usage.output_tokens

        except Exception as exc:
            yield f'3:{json.dumps(f"Sorry, something went wrong: {exc}")}\n'

        yield f'd:{json.dumps({"finishReason": "stop", "usage": {"promptTokens": prompt_tokens, "completionTokens": completion_tokens}})}\n'

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={
            "x-vercel-ai-data-stream": "v1",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
