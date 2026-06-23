import { TypewriterSequence } from "../TypewriterSequence";

export function WelcomeStep() {
  return (
    <div className="onb-welcome">
      <TypewriterSequence
        key="welcome-intro"
        speed={18}
        segments={[
          { text: "Hey, I'm drifty!", className: "tw-title" },
          { text: "Your AI Time Tracker.", className: "tw-title" },
          {
            text:
              "I'm your focus companion. I show where your time goes and help you stay with what matters.",
            className: "tw-message",
          },
          { text: "Let's set up a few things. This takes about a minute.", className: "tw-sub" },
        ]}
      />
    </div>
  );
}
