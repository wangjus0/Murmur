import { useMicrophone } from "./useMicrophone";

interface MicButtonProps {
  onAudioChunk: (base64: string) => void;
  onStartSession: () => void;
  onStop: () => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

export function MicButton({
  onAudioChunk,
  onStartSession,
  onStop,
  onError,
  disabled,
}: MicButtonProps) {
  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk,
    onStop,
    onError,
  });

  const handleClick = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    onStartSession();
    const started = await startRecording();
    if (!started) {
      onStop();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <button
        onClick={handleClick}
        disabled={disabled}
        style={{
          padding: "16px 32px",
          fontSize: "18px",
          fontWeight: "bold",
          border: "none",
          borderRadius: "50px",
          cursor: disabled ? "not-allowed" : "pointer",
          color: "#fff",
          background: isRecording
            ? "#ef4444"
            : disabled
              ? "#6b7280"
              : "#3b82f6",
          opacity: disabled ? 0.5 : 1,
          transition: "all 0.2s",
          animation: isRecording ? "pulse 1.5s infinite" : "none",
        }}
      >
        {isRecording ? "Stop" : "Start"}
      </button>
      <span
        aria-live="polite"
        style={{
          minHeight: "20px",
          fontSize: "13px",
          fontWeight: 600,
          color: isRecording ? "#a6e3a1" : "#6c7086",
          visibility: isRecording ? "visible" : "hidden",
        }}
      >
        Listening...
      </span>
    </div>
  );
}
