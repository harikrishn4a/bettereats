from sqlalchemy import Column, String, Float, JSON, DateTime, ForeignKey, Integer, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base

# ⚠️  Schema changed — delete nutrition_agent.db and restart to recreate tables.


class User(Base):
    __tablename__ = "users"

    id         = Column(String, primary_key=True)
    email      = Column(String, unique=True, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    preferences = relationship("UserPreference", back_populates="user", uselist=False)
    orders      = relationship("OrderHistory",   back_populates="user")


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)

    # ── Onboarding state ──────────────────────────────────────────────────────
    onboarding_complete  = Column(Boolean, default=False, nullable=False)
    onboarding_step      = Column(String,  default="greeting", nullable=False)
    conversation_history = Column(JSON,    default=list)

    # ── Body stats ────────────────────────────────────────────────────────────
    age       = Column(Integer, nullable=True)
    gender    = Column(String,  nullable=True)   # "M" | "F"
    weight_kg = Column(Float,   nullable=True)
    height_cm = Column(Float,   nullable=True)

    # ── Diet & activity goals ─────────────────────────────────────────────────
    diet_goal      = Column(String, nullable=True)  # build_muscle | fat_loss | eat_healthier | maintain_weight
    activity_level = Column(String, nullable=True)  # sedentary | lightly_active | moderately_active | very_active

    # ── Specific weight goal (new) ────────────────────────────────────────────
    weight_goal_kg        = Column(Float,   nullable=True)   # absolute kg to gain or lose
    weight_goal_direction = Column(String,  nullable=True)   # "gain" | "loss"
    target_timeline_weeks = Column(Integer, nullable=True)   # how many weeks to achieve it

    # ── Baseline macros (TDEE-based, before goal adjustment) ─────────────────
    bmr                 = Column(Float, nullable=True)
    tdee                = Column(Float, nullable=True)   # = maintenance_calories
    maintenance_calories = Column(Float, nullable=True)  # explicit alias kept for clarity

    # ── Goal-adjusted macros ──────────────────────────────────────────────────
    daily_calories  = Column(Float, nullable=True)  # target = tdee ± deficit
    daily_protein_g = Column(Float, nullable=True)
    daily_carbs_g   = Column(Float, nullable=True)
    daily_fat_g     = Column(Float, nullable=True)

    # ── Goal plan metadata ────────────────────────────────────────────────────
    weekly_deficit_kcal = Column(Float,  nullable=True)  # total weekly surplus/deficit
    daily_deficit_kcal  = Column(Float,  nullable=True)  # per-day surplus/deficit
    realism_status      = Column(String, nullable=True)  # conservative | realistic | aggressive

    # ── Preferences (Phase 2 suggestion engine) ───────────────────────────────
    weekly_budget_sgd = Column(Float, nullable=True)
    meals_per_week    = Column(Integer, nullable=True)  # how many Grab meals the budget covers
    taste_profile     = Column(JSON,  nullable=True)  # {likes: [...], dislikes: [...]}
    meal_timings      = Column(JSON,  nullable=True)  # {breakfast: "07:00", ...}

    # Legacy field — kept for backward-compat; mirrors daily macro values
    diet_goals = Column(JSON, nullable=True)

    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user = relationship("User", back_populates="preferences")


class OrderHistory(Base):
    __tablename__ = "order_history"

    id         = Column(String, primary_key=True)
    user_id    = Column(String, ForeignKey("users.id"), nullable=False)
    date       = Column(String, nullable=False)
    restaurant = Column(String, nullable=False)
    dishes     = Column(JSON,   nullable=False)   # [{name, protein_g, calories, ...}]
    total_cost = Column(Float,  nullable=False)
    meal_type  = Column(String, nullable=False)   # breakfast | lunch | dinner

    user      = relationship("User",        back_populates="orders")
    feedbacks = relationship("Feedback",    back_populates="order")


class Feedback(Base):
    __tablename__ = "feedback"

    id                 = Column(String,  primary_key=True)
    order_id           = Column(String,  ForeignKey("order_history.id"), nullable=False)
    user_id            = Column(String,  nullable=False)
    taste_rating       = Column(Integer, nullable=False)          # 1–5
    satiation          = Column(Integer, nullable=False)          # 1–5
    nutrition_accuracy = Column(String,  nullable=False)          # accurate | protein_low | calories_high | very_off
    would_reorder      = Column(Integer, nullable=False)          # 1–5
    notes              = Column(String,  nullable=True)
    created_at         = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    order = relationship("OrderHistory", back_populates="feedbacks")
