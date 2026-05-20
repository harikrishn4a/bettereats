import React, { useState } from "react";

interface MCQButtonsProps {
  options: string[];
  onSelect: (option: string) => void;
  disabled?: boolean;
}

export default function MCQButtons({ options, onSelect, disabled = false }: MCQButtonsProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleClick = (option: string) => {
    if (disabled || selected) return;
    setSelected(option);
    onSelect(option);
  };

  return (
    <div className="mcq-group">
      {options.map((opt) => {
        const isSelected = selected === opt;
        const isDimmed = selected !== null && !isSelected;
        return (
          <button
            key={opt}
            onClick={() => handleClick(opt)}
            disabled={disabled || selected !== null}
            className={[
              "mcq-btn",
              isSelected ? "mcq-btn--selected" : "",
              isDimmed ? "mcq-btn--dimmed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
