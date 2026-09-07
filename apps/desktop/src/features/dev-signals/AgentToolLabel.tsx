import codexIcon from "../../assets/agent-tools/codex_light.svg";
import claudeIcon from "../../assets/agent-tools/claude-ai-icon.svg";
import geminiIcon from "../../assets/agent-tools/gemini.svg";
import opencodeIcon from "../../assets/agent-tools/opencode.svg";
import cursorIcon from "../../assets/agent-tools/cursor_light.svg";
import copilotIcon from "../../assets/agent-tools/copilot.svg";

// These are execution-tool labels, not model names. Unknown tools stay text-only.
const TOOL_ICONS: Readonly<Record<string, { readonly src: string; readonly monochrome?: boolean; readonly padded?: boolean }>> = {
  Codex: { src: codexIcon, monochrome: true },
  "Claude Code": { src: claudeIcon },
  "Gemini CLI": { src: geminiIcon },
  OpenCode: { src: opencodeIcon, padded: true },
  "Cursor CLI": { src: cursorIcon, monochrome: true },
  "Copilot CLI": { src: copilotIcon, monochrome: true },
};

export function AgentToolLabel({ label }: { readonly label: string }) {
  const icon = Object.prototype.hasOwnProperty.call(TOOL_ICONS, label) ? TOOL_ICONS[label] : undefined;
  return (
    <span className="agents-hover-card__tool">
      {icon ? (
        <span className="agents-hover-card__tool-icon-frame" aria-hidden="true">
          <img
            className={[
              "agents-hover-card__tool-icon",
              icon.monochrome && "agents-hover-card__tool-icon--monochrome",
              icon.padded && "agents-hover-card__tool-icon--padded",
            ].filter(Boolean).join(" ")}
            src={icon.src}
            alt=""
            aria-hidden="true"
            width={16}
            height={16}
          />
        </span>
      ) : null}
      <span className="agents-hover-card__tool-label">{label}</span>
    </span>
  );
}
