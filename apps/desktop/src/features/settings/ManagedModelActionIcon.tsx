type ManagedModelActionIconName = "download" | "finder" | "delete";

export function ManagedModelActionIcon({ icon }: { readonly icon: ManagedModelActionIconName }) {
  switch (icon) {
    case "download":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M10 3.5v8" />
          <path d="M6.8 8.6 10 11.8l3.2-3.2" />
          <path d="M4.5 14.5h11" />
        </svg>
      );
    case "finder":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M4.2 5.4h4.2l1.3 1.4h6.1v7.8H4.2z" />
          <path d="M4.2 8.2h11.6" />
        </svg>
      );
    case "delete":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M6.2 7.3h7.6" />
          <path d="M8.2 7.3V5.5h3.6v1.8" />
          <path d="M7.1 9.2v5.1M10 9.2v5.1M12.9 9.2v5.1" />
          <path d="M6.8 7.3 7.5 16h5l0.7-8.7" />
        </svg>
      );
    default:
      return assertNeverIcon(icon);
  }
}

class ManagedModelActionIconError extends Error {
  constructor(readonly icon: string) {
    super(`Unhandled managed local AI action icon: ${icon}`);
    this.name = "ManagedModelActionIconError";
  }
}

function assertNeverIcon(value: never): never {
  throw new ManagedModelActionIconError(String(value));
}
