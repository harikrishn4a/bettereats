import React from "react";
import { theme } from "../styles/theme";

interface ChatBubbleProps {
  message: string;
  sender: "agent" | "user";
}

export default function ChatBubble({ message, sender }: ChatBubbleProps) {
  const isAgent = sender === "agent";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isAgent ? "flex-start" : "flex-end",
        marginBottom: "10px",
        animation: "fadeSlideIn 0.25s ease-out",
      }}
    >
      {isAgent && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #6366f1, #818cf8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            marginRight: 10,
            flexShrink: 0,
            alignSelf: "flex-end",
            boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
          }}
        >
          🍽
        </div>
      )}

      <div
        style={{
          maxWidth: "72%",
          padding: "11px 15px",
          borderRadius: isAgent
            ? `${theme.radii.lg} ${theme.radii.lg} ${theme.radii.lg} 4px`
            : `${theme.radii.lg} ${theme.radii.lg} 4px ${theme.radii.lg}`,
          background: isAgent
            ? theme.colors.surface
            : theme.colors.accentSecondary,
          color: theme.colors.textPrimary,
          fontSize: "0.92rem",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          border: isAgent ? `1px solid ${theme.colors.border}` : "none",
          boxShadow: isAgent ? "none" : "0 2px 12px rgba(249,115,22,0.25)",
        }}
      >
        {message}
      </div>
    </div>
  );
}
