import { useState } from "react";
import OnboardingChat from "@/components/OnboardingChat";
import { Button } from "@/components/ui/button";
import type { MacroResult } from "@/services/api";
import logo from "@/assets/logo.svg";

// In Phase 2 this will come from auth; for now a fixed ID is fine.
const USER_ID = "user_1";

export default function App() {
  const [done, setDone] = useState(false);
  const [macros, setMacros] = useState<MacroResult | null>(null);

  if (!done) {
    return (
      <OnboardingChat
        userId={USER_ID}
        onComplete={(result) => {
          setMacros(result);
          setDone(true);
        }}
      />
    );
  }

  // Phase 2 placeholder — shown after the conversational onboarding finishes
  return (
    <div className="h-dvh flex flex-col items-center justify-center bg-background text-foreground gap-5 p-6">
      <img src={logo} alt="bettereats" className="w-12 h-12" />
      <div className="text-center max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Preferences saved!</h1>
        {macros && (
          <p className="text-muted-foreground text-sm mb-1">
            Target: {macros.macros.calories} kcal · {macros.macros.protein_g}g protein ·{" "}
            {macros.macros.carbs_g}g carbs · {macros.macros.fat_g}g fat
          </p>
        )}
        <p className="text-muted-foreground text-sm leading-relaxed mt-2">
          Grab meal suggestions are coming in Phase 2 — we'll use your plan to find the best
          options for you.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setDone(false);
          setMacros(null);
        }}
      >
        Update preferences
      </Button>
    </div>
  );
}
