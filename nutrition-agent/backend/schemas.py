from pydantic import BaseModel
from typing import Optional, Any


# ── Legacy preference form (Phase 1 initial version) ─────────────────────────

class PreferenceInput(BaseModel):
    user_id: str
    weekly_budget_sgd: float
    diet_goals: dict
    taste_profile: dict
    meal_timings: dict

    model_config = {
        "json_schema_extra": {
            "examples": [{
                "user_id": "user_1",
                "weekly_budget_sgd": 100.0,
                "diet_goals": {"calories": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 65},
                "taste_profile": {"likes": ["spicy", "asian"], "dislikes": ["seafood"]},
                "meal_timings": {"breakfast": "07:00", "lunch": "12:30", "dinner": "19:00"},
            }]
        }
    }


class PreferenceResponse(BaseModel):
    status: str
    agent_validation: Optional[dict] = None
    ready_for_suggestions: bool


# ── Onboarding chat schemas ───────────────────────────────────────────────────

class ConversationItem(BaseModel):
    sender: str                                    # "agent" | "user"
    message: str
    timestamp: str                                 # ISO 8601
    extracted_data: Optional[dict[str, Any]] = None


class OnboardingStartRequest(BaseModel):
    user_id: str


class OnboardingChatRequest(BaseModel):
    user_id: str
    message: str
    current_step: str
    conversation_history: list[ConversationItem]
    accumulated_data: dict[str, Any] = {}


class AgentResponse(BaseModel):
    agent_message: str
    options: Optional[list[str]] = None
    extracted_data: Optional[dict[str, Any]] = None
    next_step: str
    is_complete: bool
    needs_clarification: bool
    calculated_macros: Optional[dict[str, Any]] = None


class OnboardingChatResponse(BaseModel):
    agent_response: AgentResponse
    current_step: str


class MacroBreakdown(BaseModel):
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int


class MacroResult(BaseModel):
    bmr: int
    tdee: int
    adjusted_calories: int
    macros: MacroBreakdown


class OnboardingCompleteRequest(BaseModel):
    user_id: str
    accumulated_data: dict[str, Any]


class OnboardingCompleteResponse(BaseModel):
    status: str
    macros: MacroResult
    message: str
