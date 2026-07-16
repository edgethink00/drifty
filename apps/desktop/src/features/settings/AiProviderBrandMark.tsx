import type { ReactNode } from "react";

import driftyLogoUrl from "../../assets/drifty-icon.png";
import openRouterLogoUrl from "../../assets/openrouter-logo.png";

/** Providers that carry a recognizable brand mark in the AI-setup surfaces. */
export type AiProviderBrandKind = "drifty" | "openrouter" | "openai" | "anthropic" | "custom";

// Official brand-mark paths, shared by the provider cards and the tinted
// "pick" badges rendered inside the Model-being-used provider dropdowns.
const OPENAI_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9a6.0651 6.0651 0 0 0-4.5972-2.9088 5.9847 5.9847 0 0 0-3.9977 2.9A6.0462 6.0462 0 0 0 1.8853 6.4939a5.9847 5.9847 0 0 0 .7367 7.0965 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5142 2.9002A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z";
const ANTHROPIC_PATH =
  "M32.73 0h-6.94l12.65 32h6.94L32.73 0ZM12.65 0 0 32h7.08l2.59-6.71h13.23L25.49 32h7.08L19.92 0h-7.27Zm-.65 19.34 4.32-11.22 4.33 11.22H12Z";
const CUSTOM_PATHS = ["M5 6.4h6.8a3.6 3.6 0 0 1 0 7.2H8.2", "M8.2 9.9h6.8", "M8.2 13.6a3.6 3.6 0 0 1 0-7.2h3.6"] as const;

type AiProviderBrandMarkOptions = {
  /** Adds the `--pick` modifier for the compact tinted badge used inside dropdowns. */
  readonly pick?: boolean;
};

/**
 * Renders a provider's brand mark. Without options it is the 1.8rem card badge;
 * with `{ pick: true }` it is the compact tinted badge reused as the leading icon
 * inside the Model-being-used provider dropdowns.
 */
export function aiProviderBrandMark(kind: AiProviderBrandKind, options?: AiProviderBrandMarkOptions): ReactNode {
  const className = `ai-setup-brand-mark ai-setup-brand-mark--${kind}${options?.pick ? " ai-setup-brand-mark--pick" : ""}`;
  return (
    <span className={className} aria-hidden="true">
      {brandMarkInner(kind)}
    </span>
  );
}

function brandMarkInner(kind: AiProviderBrandKind): ReactNode {
  switch (kind) {
    case "drifty":
      return <img src={driftyLogoUrl} alt="" />;
    case "openrouter":
      return <img src={openRouterLogoUrl} alt="" />;
    case "openai":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={OPENAI_PATH} />
        </svg>
      );
    case "anthropic":
      return (
        <svg viewBox="0 0 46 32" aria-hidden="true" focusable="false">
          <path d={ANTHROPIC_PATH} />
        </svg>
      );
    case "custom":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          {CUSTOM_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      );
    default:
      return assertNever(kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AI provider brand kind: ${String(value)}`);
}
