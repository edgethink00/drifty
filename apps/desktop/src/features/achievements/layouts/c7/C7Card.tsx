import { useMemo, type CSSProperties } from "react";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { Translate } from "../../../localization/translate";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import { achievementBadgeStage } from "../../achievementBadge";
import { almostThere } from "../../achievementCollection";
import {
  achievementCondition,
  achievementDay,
  achievementName,
  formatAchievementDay,
  medalName,
  raritySentence,
  rarityTierName,
  shownRarity,
} from "../../achievementCopy";
import { readAchievementStore } from "../../achievementStore";
import { buildAchievementItems, type AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C7Holdings } from "./C7Holdings";
import { C7Medal, C7SwapMedal } from "./C7Medal";
import { entryLeft, ordinal } from "./c7Copy";

/** When a new slot takes its medal: once the large medal and its name have settled. */
const SINGLE_LAND_AT_MS = 620;
const SEVERAL_LAND_AT_MS = 420;
const SEVERAL_LAND_STEP_MS = 70;
const FIRST_LOOK_LAND_AT_MS = 320;
const FIRST_LOOK_STEP_MS = 50;

type Row = { readonly group: AchievementGroup; readonly items: readonly AchievementItem[] };

/** Every achievement as it stands now: the new ones as given, the rest from the saved record (or locked, for the first look). */
function collection(fresh: readonly AchievementItem[], earlier: "saved" | "none"): AchievementItem[] {
  const byId = new Map(fresh.map((item) => [item.definition.id, item]));
  const saved = earlier === "saved" ? buildAchievementItems(readAchievementStore()) : [];
  const savedById = new Map(saved.map((item) => [item.definition.id, item]));
  return ACHIEVEMENT_DEFINITIONS.map((definition) => byId.get(definition.id)
    ?? savedById.get(definition.id)
    ?? { definition, earned: null, progress: null, rarity: null });
}

function rowsOf(items: readonly AchievementItem[], groups: readonly AchievementGroup[]): Row[] {
  return groups.map((group) => ({ group, items: items.filter((item) => item.definition.group === group) }));
}

function groupLabel(group: AchievementGroup, t: Translate): string {
  return t(("achievements.group." + group) as TranslationKey);
}

function whenLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const earned = item.earned;
  if (!earned) return null;
  const day = formatAchievementDay(achievementDay(item) ?? earned.firstDay, language);
  return item.definition.repeatable && earned.count > 1
    ? t("achievements.c7.nthTime", { nth: ordinal(earned.count, t, language) }) + " · " + day
    : t("achievements.dialog.earnedOn", { date: day });
}

/** The tier it joins with rarity; without rarity only the medal metal, and nothing about rarity. */
function tierLine(item: AchievementItem, t: Translate, language: DisplayLanguage): string | null {
  const rarity = shownRarity(item);
  if (!rarity) return medalName(item, t);
  return t("achievements.c7.tier", { tier: rarityTierName(item, rarity, t) }) + " · " + raritySentence(rarity, t, language, "card");
}

type SlotProps = {
  readonly item: AchievementItem;
  readonly fresh: boolean;
  readonly lead: boolean;
  readonly landAt: number;
};

function Slot({ item, fresh, lead, landAt }: SlotProps) {
  const { t } = useLocalization();
  return (
    <span
      className="c7-slot"
      data-new={fresh ? "true" : undefined}
      data-lead={fresh && lead ? "true" : undefined}
      data-state={item.earned ? "earned" : "locked"}
      style={fresh ? ({ "--c7-land-at": landAt + "ms" } as CSSProperties) : undefined}
    >
      {fresh ? <C7SwapMedal item={item} small delay={landAt} /> : <C7Medal item={item} small />}
      <span className="c7-slot__name">
        {fresh ? <span className="c7-dot" aria-hidden="true" /> : null}
        {achievementName(item, t)}
      </span>
    </span>
  );
}

function RowHead({ row, fresh }: { readonly row: Row; readonly fresh: ReadonlySet<AchievementId> }) {
  const { t } = useLocalization();
  const now = row.items.filter((item) => item.earned).length;
  const before = now - row.items.filter((item) => fresh.has(item.definition.id)).length;
  return (
    <span className="c7-cardrow__head">
      <span className="c7-cardrow__title">{groupLabel(row.group, t)}</span>
      <span className="c7-cardrow__meta">
        <span className="c7-cardrow__count">
          <span className="c7-tick">
            {before !== now ? <span className="c7-tick__from" aria-hidden="true">{before}</span> : null}
            <span className={before !== now ? "c7-tick__to" : undefined}>{now}</span>
          </span>
          /{row.items.length}
        </span>
        <span className="c7-pips" aria-hidden="true">
          {row.items.map((item) => (
            <span key={item.definition.id} className="c7-pip" data-on={item.earned ? "true" : undefined} data-new={fresh.has(item.definition.id) ? "true" : undefined} />
          ))}
        </span>
      </span>
    </span>
  );
}

/** The goal closest to done once these are in: a small line at the card's foot. */
function NextGoal({ items }: { readonly items: readonly AchievementItem[] }) {
  const { effectiveLanguage, t } = useLocalization();
  const [next] = almostThere(items, { limit: 1 });
  if (!next) return null;
  return (
    <p className="c7-card__next">
      <C7Medal item={next.item} small className="c7-medal c7-card__next-medal" />
      <span>{t("achievements.c7.nextGoal", { name: achievementName(next.item, t), left: entryLeft(next, t, effectiveLanguage) })}</span>
    </p>
  );
}

function Single({ lead, titleId }: { readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const items = useMemo(() => collection([lead], "saved"), [lead]);
  const fresh = useMemo(() => new Set<AchievementId>([lead.definition.id]), [lead]);
  const [row] = rowsOf(items, [lead.definition.group]);
  const when = whenLine(lead, t, effectiveLanguage);
  const tier = tierLine(lead, t, effectiveLanguage);
  const count = lead.definition.repeatable && lead.earned && lead.earned.count > 1 ? lead.earned.count : null;
  return (
    <>
      <p className="c7-card__eyebrow c7-card__top">{t("achievements.dialog.eyebrow")}</p>
      <div className="c7-card__stage">
        <span className="c7-card__hero-box">
          <C7Medal item={lead} className="c7-medal c7-card__hero" />
          {count ? <span className="c7-chip" data-stage={achievementBadgeStage(lead)} aria-hidden="true">×{count}</span> : null}
        </span>
      </div>
      <div className="c7-card__text">
        <h2 id={titleId} className="c7-card__title">{achievementName(lead, t)}</h2>
        <p className="c7-card__condition">{achievementCondition(lead, t)}</p>
        {when ? <p className="c7-card__when">{when}</p> : null}
        {tier ? <p className="c7-card__tier">{tier}</p> : null}
      </div>
      {row ? (
        <section className="c7-cardrow c7-cardrow--strip" aria-label={groupLabel(row.group, t)} style={{ "--c7-land-at": SINGLE_LAND_AT_MS + "ms" } as CSSProperties}>
          <RowHead row={row} fresh={fresh} />
          {row.items.map((item) => (
            <Slot key={item.definition.id} item={item} fresh={fresh.has(item.definition.id)} lead landAt={SINGLE_LAND_AT_MS} />
          ))}
        </section>
      ) : null}
      <NextGoal items={items} />
    </>
  );
}

function Several({ ordered, lead, titleId }: { readonly ordered: readonly AchievementItem[]; readonly lead: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const items = useMemo(() => collection(ordered, "saved"), [ordered]);
  const fresh = useMemo(() => new Set<AchievementId>(ordered.map((item) => item.definition.id)), [ordered]);
  const touched = new Set(ordered.map((item) => item.definition.group));
  const rows = rowsOf(items, ACHIEVEMENT_GROUPS.filter((group) => touched.has(group)));
  const when = whenLine(lead, t, effectiveLanguage);
  const tier = tierLine(lead, t, effectiveLanguage);
  let landed = 0;
  return (
    <>
      <div className="c7-card__lead">
        <C7Medal item={lead} className="c7-medal c7-card__hero" />
        <div className="c7-card__text">
          <p className="c7-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
          <h2 id={titleId} className="c7-card__title">{achievementName(lead, t)}</h2>
          <p className="c7-card__condition">{achievementCondition(lead, t)}</p>
          {when || tier ? <p className="c7-card__when">{[when, tier].filter(Boolean).join(" · ")}</p> : null}
        </div>
      </div>
      <div className="c7-card__rows">
        {rows.map((row) => (
          <section key={row.group} className="c7-cardrow" aria-label={groupLabel(row.group, t)}>
            <RowHead row={row} fresh={fresh} />
            {row.items.map((item) => {
              const isFresh = fresh.has(item.definition.id);
              const landAt = isFresh ? SEVERAL_LAND_AT_MS + landed++ * SEVERAL_LAND_STEP_MS : 0;
              return <Slot key={item.definition.id} item={item} fresh={isFresh} lead={item.definition.id === lead.definition.id} landAt={landAt} />;
            })}
          </section>
        ))}
      </div>
    </>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const items = useMemo(() => collection(ordered, "none"), [ordered]);
  const fresh = useMemo(() => new Set<AchievementId>(ordered.map((item) => item.definition.id)), [ordered]);
  const rows = rowsOf(items, ACHIEVEMENT_GROUPS);
  let found = 0;
  return (
    <>
      <div className="c7-card__text c7-card__text--look">
        <h2 id={titleId} className="c7-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c7-card__condition">{t("achievements.dialog.firstLookBody")}</p>
        <C7Holdings items={ordered} className="c7-card__tiers" />
      </div>
      <div className="c7-card__rows c7-card__rows--look">
        {rows.map((row) => (
          <section key={row.group} className="c7-cardrow" aria-label={groupLabel(row.group, t)}>
            <RowHead row={row} fresh={fresh} />
            {row.items.map((item) => {
              const isFresh = fresh.has(item.definition.id);
              const landAt = isFresh ? FIRST_LOOK_LAND_AT_MS + found++ * FIRST_LOOK_STEP_MS : 0;
              return <Slot key={item.definition.id} item={item} fresh={isFresh} lead={false} landAt={landAt} />;
            })}
          </section>
        ))}
      </div>
    </>
  );
}

export function C7Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several ordered={ordered} lead={lead} titleId={titleId} />
          : <Single lead={lead} titleId={titleId} />}
      <div className="c7-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
