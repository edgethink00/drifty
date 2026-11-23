import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_GROUPS, type AchievementGroup, type AchievementId } from "../../achievementCatalog";
import { achievementCondition, achievementDay, achievementName, formatAchievementDay, medalName, raritySentence, shownRarity } from "../../achievementCopy";
import { readAchievementStore } from "../../achievementStore";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementLayoutCardProps } from "../types";
import { C1Medal, C1SwapMedal } from "./C1Medal";
import { rarestEarned } from "./c1Copy";
import "./c1-card.css";

/** When a new slot takes its medal: once the large medal has settled (c1-card.css times the rest). */
const LAND_AT_MS = 700;
/** One new: a copy of the large medal travels up into the slot and arrives about here. */
const SINGLE_LAND_AT_MS = 900;
const SEVERAL_LAND_STEP_MS = 70;
const FIRST_LOOK_SWAP_AT_MS = 320;
const FIRST_LOOK_STEP_MS = 50;

type Row = { readonly group: AchievementGroup; readonly items: readonly AchievementItem[] };

/** Every achievement of a group as it stands now: the new ones as given, the others from the saved record. */
function rowsFor(groups: readonly AchievementGroup[], fresh: readonly AchievementItem[], earlier: "saved" | "none"): Row[] {
  const byId = new Map(fresh.map((item) => [item.definition.id, item]));
  const saved = earlier === "saved" ? readAchievementStore().earned : {};
  return groups.map((group) => ({
    group,
    items: ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.group === group).map((definition) => byId.get(definition.id)
      ?? { definition, earned: saved[definition.id] ?? null, progress: null, rarity: null }),
  }));
}

function groupLabel(group: AchievementGroup, t: ReturnType<typeof useLocalization>["t"]): string {
  return t(("achievements.group." + group) as TranslationKey);
}

type SlotProps = {
  readonly item: AchievementItem;
  readonly fresh: boolean;
  /** The one new slot that carries the lit plate and notch; other new ones keep a dot and a bold name. */
  readonly lead: boolean;
  readonly landAt: number;
  readonly small: boolean;
};

/** One place in a group's row, as on the board: medal over name. A new one lands here. */
function Slot({ item, fresh, lead, landAt, small }: SlotProps) {
  const { t } = useLocalization();
  return (
    <span
      className="c1-slot"
      data-new={fresh ? "true" : undefined}
      data-lead={fresh && lead ? "true" : undefined}
      data-state={item.earned ? "earned" : "locked"}
      style={fresh ? ({ "--c1-land-at": landAt + "ms" } as CSSProperties) : undefined}
    >
      {fresh && lead ? <span className="c1-slot__notch" aria-hidden="true" /> : null}
      {fresh ? <C1SwapMedal item={item} small={small} delay={landAt} /> : <C1Medal item={item} small={small} />}
      <span className="c1-slot__name">
        {fresh ? <span className="c1-dot" aria-hidden="true" /> : null}
        {achievementName(item, t)}
      </span>
    </span>
  );
}

function FirstLook({ ordered, titleId }: { readonly ordered: readonly AchievementItem[]; readonly titleId: string }) {
  const { t } = useLocalization();
  const rows = useMemo(() => rowsFor(ACHIEVEMENT_GROUPS, ordered, "none"), [ordered]);
  const rarest = rarestEarned(ordered);
  let found = 0;
  return (
    <>
      <div className="c1-card__text">
        <h2 id={titleId} className="c1-card__title">{t("achievements.dialog.firstLookTitle", { count: ordered.length })}</h2>
        <p className="c1-card__condition">{t("achievements.dialog.firstLookBody")}</p>
        {rarest ? <p className="c1-card__rarest">{t("achievements.dialog.rarest", { name: achievementName(rarest, t) })}</p> : null}
      </div>
      <div className="c1-look">
        {rows.map((row) => (
          <section key={row.group} className="c1-look__row" aria-label={groupLabel(row.group, t)}>
            <span className="c1-look__head">
              <span className="c1-look__title">{groupLabel(row.group, t)}</span>
              <span className="c1-look__count">{row.items.filter((item) => item.earned).length}/{row.items.length}</span>
            </span>
            {row.items.map((item) => {
              const delay = item.earned ? FIRST_LOOK_SWAP_AT_MS + found++ * FIRST_LOOK_STEP_MS : 0;
              return (
                <span key={item.definition.id} className="c1-look__slot" data-state={item.earned ? "earned" : "locked"}>
                  {item.earned ? <C1SwapMedal item={item} delay={delay} /> : <C1Medal item={item} />}
                  <span className="c1-look__name">{achievementName(item, t)}</span>
                </span>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

/**
 * One new achievement: the group's row from the board anchors the card. Its
 * count ticks up, its pip fills and the slot lights as the medal lands; the
 * large medal rises centred beneath it, then its name and rarity.
 */
/** Layout offset from the document, ignoring transforms, so entrance animations do not skew it. */
function layoutOffset(element: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

function Single({ hero, titleId }: { readonly hero: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const stripRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const flyRef = useRef<HTMLSpanElement>(null);
  // Aim the travelling copy from the large medal to the lit slot's medal.
  useLayoutEffect(() => {
    const fly = flyRef.current;
    const from = stageRef.current?.querySelector<HTMLElement>(".c1-card__hero");
    const to = stripRef.current?.querySelector<HTMLElement>('.c1-slot[data-lead="true"] .c1-medal');
    if (!fly || !from || !to || from.offsetWidth === 0) return;
    const a = layoutOffset(from);
    const b = layoutOffset(to);
    fly.style.setProperty("--c1-fly-left", from.offsetLeft + "px");
    fly.style.setProperty("--c1-fly-top", from.offsetTop + "px");
    fly.style.setProperty("--c1-fly-x", b.x + to.offsetWidth / 2 - (a.x + from.offsetWidth / 2) + "px");
    fly.style.setProperty("--c1-fly-y", b.y + to.offsetHeight / 2 - (a.y + from.offsetHeight / 2) + "px");
    fly.style.setProperty("--c1-fly-s", String(to.offsetWidth / from.offsetWidth));
    fly.dataset.ready = "true";
  }, [hero]);
  const [row] = useMemo(() => rowsFor([hero.definition.group], [hero], "saved"), [hero]);
  const rarity = shownRarity(hero);
  const day = hero.earned ? formatAchievementDay(achievementDay(hero) ?? hero.earned.firstDay, effectiveLanguage) : null;
  const earnedNow = row ? row.items.filter((item) => item.earned).length : 0;
  return (
    <>
      <p className="c1-card__eyebrow c1-card__top">{t("achievements.dialog.eyebrow")}</p>
      {row ? (
        <section ref={stripRef} className="c1-strip" aria-label={groupLabel(row.group, t)} style={{ "--c1-land-at": SINGLE_LAND_AT_MS + "ms", "--c1-cols": row.items.length } as CSSProperties}>
          <span className="c1-strip__head">
            <span className="c1-strip__title">{groupLabel(row.group, t)}</span>
            <span className="c1-strip__meta">
              <span className="c1-strip__count">
                <span className="c1-tick">
                  <span className="c1-tick__from" aria-hidden="true">{Math.max(0, earnedNow - 1)}</span>
                  <span className="c1-tick__to">{earnedNow}</span>
                </span>
                /{row.items.length}
              </span>
              <span className="c1-pips" aria-hidden="true">
                {row.items.map((item) => (
                  <span
                    key={item.definition.id}
                    className="c1-pip"
                    data-on={item.earned ? "true" : undefined}
                    data-new={item.definition.id === hero.definition.id ? "true" : undefined}
                  />
                ))}
              </span>
            </span>
          </span>
          {row.items.map((item) => (
            <Slot key={item.definition.id} item={item} fresh={item.definition.id === hero.definition.id} lead landAt={SINGLE_LAND_AT_MS} small={false} />
          ))}
        </section>
      ) : null}
      <div ref={stageRef} className="c1-card__stage c1-card__stage--single">
        <C1Medal item={hero} className="c1-medal c1-card__hero" />
        <span ref={flyRef} className="c1-card__fly" aria-hidden="true">
          <C1Medal item={hero} className="c1-medal" />
        </span>
      </div>
      <div className="c1-card__text">
        <h2 id={titleId} className="c1-card__title">{achievementName(hero, t)}</h2>
        <p className="c1-card__condition">{achievementCondition(hero, t)}</p>
        {rarity ? <p className="c1-card__rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
        {day ? <p className="c1-card__date">{[t("achievements.dialog.earnedOn", { date: day }), medalName(hero, t)].filter(Boolean).join(" · ")}</p> : null}
      </div>
    </>
  );
}

/** Several at once: the rarest leads, then every group they touch, in board order and board columns. */
function Several({ ordered, hero, titleId }: { readonly ordered: readonly AchievementItem[]; readonly hero: AchievementItem; readonly titleId: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const fresh = useMemo(() => new Set<AchievementId>(ordered.map((item) => item.definition.id)), [ordered]);
  const rows = useMemo(() => {
    const touched = new Set(ordered.map((item) => item.definition.group));
    return rowsFor(ACHIEVEMENT_GROUPS.filter((group) => touched.has(group)), ordered, "saved");
  }, [ordered]);
  const rarity = shownRarity(hero);
  let landed = 0;
  return (
    <>
      <div className="c1-card__lead">
        <C1Medal item={hero} className="c1-medal c1-card__hero" />
        <div className="c1-card__text">
          <p className="c1-card__eyebrow">{t("achievements.dialog.eyebrowMany", { count: ordered.length })}</p>
          <h2 id={titleId} className="c1-card__title">{achievementName(hero, t)}</h2>
          <p className="c1-card__condition">{achievementCondition(hero, t)}</p>
          {rarity ? <p className="c1-card__rarity">{raritySentence(rarity, t, effectiveLanguage, "card")}</p> : null}
        </div>
      </div>
      <div className="c1-excerpt">
        {rows.map((row) => (
          <section key={row.group} className="c1-excerpt__row" aria-label={groupLabel(row.group, t)}>
            <span className="c1-excerpt__head">
              <span className="c1-excerpt__title">{groupLabel(row.group, t)}</span>
              <span className="c1-excerpt__count">{row.items.filter((item) => item.earned).length}/{row.items.length}</span>
            </span>
            {row.items.map((item) => {
              const isFresh = fresh.has(item.definition.id);
              const landAt = isFresh ? LAND_AT_MS + landed++ * SEVERAL_LAND_STEP_MS : 0;
              return <Slot key={item.definition.id} item={item} fresh={isFresh} lead={item.definition.id === hero.definition.id} landAt={landAt} small />;
            })}
          </section>
        ))}
      </div>
    </>
  );
}

export function C1Card({ ordered, lead, others, showFirstLook, titleId, onClose, onView }: AchievementLayoutCardProps) {
  const { t } = useLocalization();
  const hero = rarestEarned(ordered) ?? lead;
  return (
    <>
      {showFirstLook ? <FirstLook ordered={ordered} titleId={titleId} />
        : others.length > 0 ? <Several ordered={ordered} hero={hero} titleId={titleId} />
          : <Single hero={hero} titleId={titleId} />}
      <div className="c1-card__actions">
        <button type="button" className="modal-btn modal-btn--ghost" onClick={onClose}>{t("achievements.dialog.close")}</button>
        <button type="button" className="modal-btn modal-btn--primary" onClick={onView}>{t("achievements.dialog.view")}</button>
      </div>
    </>
  );
}
