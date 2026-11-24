import type { AchievementLayout } from "../types";
import { C8Card } from "./C8Card";
import { C8Tab } from "./C8Tab";
import "./c8.css";

export const c8Layout: AchievementLayout = { Tab: C8Tab, Card: C8Card, dialogVariant: "compact" };
