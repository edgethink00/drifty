import { createContext } from "react";
import type { BrowserContentIntentStatus } from "./browserContentIntent";

export const BrowserContentIntentContext = createContext<{
  readonly status: BrowserContentIntentStatus;
  readonly retry: () => void;
}>({ status: "unmanaged", retry: () => undefined });
