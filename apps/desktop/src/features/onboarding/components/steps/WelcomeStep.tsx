import { TypewriterSequence } from "../TypewriterSequence";

export function WelcomeStep() {
  return (
    <div className="onb-welcome">
      <TypewriterSequence
        key="welcome-intro"
        speed={18}
        segments={[
          { text: "Hey, I'm drifty.", className: "tw-title" },
          { text: "Your AI time tracker.", className: "tw-title" },
          {
            text:
              "I show where your time actually goes, and gently help you stay with the work that matters.",
            className: "tw-message",
          },
          { text: "Let's set up a few things — about a minute.", className: "tw-sub" },
        ]}
      />
    </div>
  );
}
