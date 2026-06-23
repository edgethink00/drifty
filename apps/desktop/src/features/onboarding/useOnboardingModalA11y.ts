import { useEffect, useRef } from "react";
import type { OnboardingStep } from "./onboardingFlow";

export function useOnboardingModalA11y(step: OnboardingStep) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const screenRef = useRef<HTMLElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const screen = screenRef.current;
    const appShell = screen?.parentElement;
    if (!screen || !appShell) return;
    const siblings = Array.from(appShell.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== screen,
    );
    const previousStates = siblings.map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.hasAttribute("inert"),
    }));
    for (const element of siblings) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }
    return () => {
      for (const { element, ariaHidden, inert } of previousStates) {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (!inert) element.removeAttribute("inert");
      }
    };
  }, []);

  return { screenRef, stepBodyRef, titleRef };
}
