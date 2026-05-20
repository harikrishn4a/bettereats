from typing import Any

# Harris-Benedict activity multipliers
ACTIVITY_FACTORS: dict[str, float] = {
    "sedentary":          1.2,
    "lightly_active":     1.375,
    "moderately_active":  1.55,
    "very_active":        1.725,
}

# Calorie delta on top of TDEE for the broad diet goal
GOAL_ADJUSTMENTS: dict[str, int] = {
    "build_muscle":   500,
    "fat_loss":      -500,
    "eat_healthier":   0,
    "maintain_weight": 0,
}

# Macro split by broad goal (protein/carbs/fat as % of target calories)
MACRO_RATIOS: dict[str, dict[str, float]] = {
    "build_muscle":   {"protein": 0.30, "carbs": 0.50, "fat": 0.20},
    "fat_loss":       {"protein": 0.35, "carbs": 0.40, "fat": 0.25},
    "eat_healthier":  {"protein": 0.25, "carbs": 0.50, "fat": 0.25},
    "maintain_weight": {"protein": 0.25, "carbs": 0.50, "fat": 0.25},
}

# Macro split for goal-specific calorie adjustment (higher protein to protect muscle)
_GOAL_MACRO_RATIOS: dict[str, dict[str, float]] = {
    "loss": {"protein": 0.35, "carbs": 0.40, "fat": 0.25},  # preserve muscle on a cut
    "gain": {"protein": 0.30, "carbs": 0.50, "fat": 0.20},  # fuel muscle building
}


def calculate_macros(
    age: int,
    weight_kg: float,
    height_cm: float,
    gender: str,
    activity_level: str,
    diet_goal: str,
) -> dict[str, Any]:
    """
    Mifflin-St Jeor BMR → TDEE (activity multiplier) → goal-adjusted calories → macro grams.
    Protein and carbs yield 4 kcal/g; fat yields 9 kcal/g.
    """
    base = 10.0 * weight_kg + 6.25 * height_cm - 5.0 * age
    bmr  = base + 5.0 if gender.upper() in ("M", "MALE") else base - 161.0

    factor         = ACTIVITY_FACTORS.get(activity_level, ACTIVITY_FACTORS["moderately_active"])
    tdee           = bmr * factor
    adjustment     = GOAL_ADJUSTMENTS.get(diet_goal, 0)
    target_calories = tdee + adjustment

    ratios    = MACRO_RATIOS.get(diet_goal, MACRO_RATIOS["maintain_weight"])
    protein_g = round((target_calories * ratios["protein"]) / 4)
    carbs_g   = round((target_calories * ratios["carbs"]) / 4)
    fat_g     = round((target_calories * ratios["fat"]) / 9)

    return {
        "bmr":               round(bmr),
        "tdee":              round(tdee),
        "adjusted_calories": round(target_calories),
        "macros": {
            "calories":  round(target_calories),
            "protein_g": protein_g,
            "carbs_g":   carbs_g,
            "fat_g":     fat_g,
        },
    }


def adjust_macros_for_goal(
    maintenance_calories: float,
    daily_delta_kcal: float,
    goal_direction: str,
) -> dict[str, int]:
    """
    Apply a specific calorie delta (signed: positive = surplus, negative = deficit)
    and recalculate macros using goal-appropriate ratios.

    Uses higher protein than the broad-goal split to preserve / build muscle.
    """
    target_calories = maintenance_calories + daily_delta_kcal
    # Floor calories at a safe minimum
    target_calories = max(target_calories, 1200 if goal_direction == "loss" else 1500)

    ratios    = _GOAL_MACRO_RATIOS.get(goal_direction, _GOAL_MACRO_RATIOS["loss"])
    protein_g = round((target_calories * ratios["protein"]) / 4)
    carbs_g   = round((target_calories * ratios["carbs"]) / 4)
    fat_g     = round((target_calories * ratios["fat"]) / 9)

    return {
        "calories":  round(target_calories),
        "protein_g": protein_g,
        "carbs_g":   carbs_g,
        "fat_g":     fat_g,
    }
