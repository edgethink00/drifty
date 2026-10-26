import { createContext } from "react";
import type { ScreenContextClient } from "./screenContextClient";

/** Reuse the main window's account client; an inspector never creates another
 * account lease or capture controller. Browser/preview surfaces have no client. */
export const ScreenEvidenceContext = createContext<ScreenContextClient | null>(null);
