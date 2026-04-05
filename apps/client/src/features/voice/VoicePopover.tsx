import { useEffect, useCallback } from "react";

const BAR_COUNT = 9;

const BAR_HEIGHTS = [24, 32, 20, 40, 28, 36, 22, 34, 26];

export function VoicePopover() {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      window.desktop?.shortcut?.closePopover();
    }
  }, []);

  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        userSelect: "none",
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
    >
      <style>{`
        @keyframes bar-pulse {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }

        @keyframes pill-glow {
          0%, 100% { box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4); }
          50% { box-shadow: 0 4px 32px rgba(0, 0, 0, 0.55); }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "5px",
          background: "#1a1a1a",
          borderRadius: "48px",
          padding: "20px 40px",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.4)",
          animation: "pill-glow 3s ease-in-out infinite",
        }}
      >
        {BAR_HEIGHTS.slice(0, BAR_COUNT).map((height, i) => (
          <div
            key={i}
            style={{
              width: "4px",
              height: `${height}px`,
              backgroundColor: "#f0f0f0",
              borderRadius: "2px",
              animation: `bar-pulse ${1.2 + i * 0.15}s ease-in-out infinite`,
              animationDelay: `${i * 0.1}s`,
              transformOrigin: "center",
            }}
          />
        ))}
      </div>
    </div>
  );
}
