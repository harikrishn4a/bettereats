from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from models import UserPreference, create_session

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"]
    allow_methods=["*"]
    allow_headers=["*"]
)

# Defines expected formats
class PreferenceInput(BaseModel):
    user_id: str
    weekly_budget_sgd: float
    diet_goals: dict  # {"calories": 2000, "protein_g": 150}
    taste_profile: dict  # {"likes": ["spicy", "asian"], "dislikes": ["seafood"]}
    meal_timings: dict  # {"breakfast": "7:00", "lunch": "12:30", "dinner": "19:00"}


# create api route
@app.post{"/preference}
async def set_preference(data: PreferanceInput):
    result = await preferance_profiler_agent(data)
    # Validate & Store in DB
    session = create_session()
    session.merge(UserPreferance(**data.dict()))
    session.commit()
    return {"status": "preferance_set", "agent_response": result}

@app.get("/health")
def health():
    return {"status": "ok"}