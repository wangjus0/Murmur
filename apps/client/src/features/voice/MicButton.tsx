import { useMicrophone } from "./useMicrophone";

interface MicButtonProps {
  onAudioChunk: (base64: string) => void;
  onStartSession: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function MicButton({
  onAudioChunk,
  onStartSession,
  onStop,
  disabled,
}: MicButtonProps) {
  const { startRecording, stopRecording, isRecording } = useMicrophone({
    onAudioChunk,
    onStop,
  });

  const handleClick = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      onStartSession();
      await startRecording();
    }
  };

  return (
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
  );
}
