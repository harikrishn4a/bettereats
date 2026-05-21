import { useState } from "react";
import OnboardingChat from "@/components/OnboardingChat";
import MealSuggestions from "@/components/MealSuggestions";
import type { MacroResult } from "@/services/api";

// In Phase 2 this will come from auth; for now a fixed ID is fine.
const USER_ID = "user_1";

export default function App() {
  const [macros, setMacros] = useState<MacroResult | null>(null);

  if (!macros) {
    return (
      <OnboardingChat
        userId={USER_ID}
        onComplete={(result) => setMacros(result)}
      />
    );
  }


  return (
    <MealSuggestions
      userId={USER_ID}
      macros={macros}
      onUpdatePreferences={() => setMacros(null)}
    />
  );
}
