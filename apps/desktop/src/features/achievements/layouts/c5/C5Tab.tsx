import { useLocalization } from "../../../localization/LocalizationContext";
import type { TranslationKey } from "../../../localization/translations";
import { ACHIEVEMENT_GROUPS, type AchievementGroup } from "../../achievementCatalog";
import { achievementName, rarityIsNotable, rarityTierName, shownRarity } from "../../achievementCopy";
import { progressShare } from "../../achievementProgress";
import type { AchievementItem } from "../../useAchievements";
import type { AchievementsTabModel } from "../../useAchievementsTab";
import type { AchievementLayoutTabProps } from "../types";
import { C5Medal } from "./C5Medal";
import { C5Rail } from "./C5Rail";
import "./c5-tab.css";

/** Slots per group, so a three-medal group under a four-medal one keeps the same columns. */
const COLUMNS: Readonly<Record<AchievementGroup, number>> = { focus: 4, rhythm: 3, consistency: 4, unexpected: 3 };

function Tile({ item, model }: { readonly item: AchievementItem; readonly model: AchievementsTabModel }) {
  const { t } = useLocalization();
  const name = achievementName(item, t);
  const share = item.earned || item.definition.hidden ? 0 : progressShare(item);
  const rarity = item.earned ? shownRarity(item) : null;
  const tier = rarity && rarityIsNotable(item, rarity) ? rarityTierName(item, rarity, t) : null;
  return (
    <button
      type="button"
      className="c5-tile"
      data-state={item.earned ? "earned" : "locked"}
      aria-pressed={item.definition.id === model.selected?.definition.id}
      aria-label={t(item.earned ? "achievements.tileEarned" : "achievements.tileLocked", { name }) + (tier ? ", " + tier : "")}
      onClick={() => model.choose(item.definition.id)}
    >
      <C5Medal item={item} />
      <span className="c5-tile__name">
        {model.isNew(item) ? <span className="c5-dot" aria-hidden="true" /> : null}
        {name}
      </span>
      {tier ? <span className="c5-tile__tier" aria-hidden="true">{tier}</span> : null}
      {share > 0 && share < 1 ? (
        <span className="c5-bar c5-bar--tile" aria-hidden="true"><span style={{ width: Math.round(share * 100) + "%" }} /></span>
      ) : null}
    </button>
  );
}

function Board({ model }: { readonly model: AchievementsTabModel }) {
  const { t } = useLocalization();
  return (
    <div className="c5-board">
      <p className="c5-board__count">{t("achievements.summary", { earned: model.earnedCount, total: model.items.length })}</p>
      {model.byGroup.map(({ group, items }) => (
        <section key={group} className="c5-group" data-group={group} aria-labelledby={"c5-group-" + group}>
          <div className="c5-group__head">
            <h2 id={"c5-group-" + group} className="c5-group__title">{t(("achievements.group." + group) as TranslationKey)}</h2>
            <span className="c5-group__count">{items.filter((item) => item.earned).length}/{items.length}</span>
          </div>
          <div
            className="c5-group__tiles"
            data-short={items.length < COLUMNS[group] ? "true" : undefined}
            style={{
              gridTemplateColumns: items.length < COLUMNS[group]
                ? `repeat(${items.length}, ${100 / COLUMNS[group]}%)`
                : `repeat(${COLUMNS[group]}, minmax(0, 1fr))`,
            }}
          >
            {items.map((item) => <Tile key={item.definition.id} item={item} model={model} />)}
          </div>
        </section>
      ))}
      <p className="c5-board__foot" role={model.status === "loading" ? "status" : undefined}>
        {model.status === "loading" ? t("achievements.loading") : t("achievements.note")}
      </p>
    </div>
  );
}

function Loading({ label }: { readonly label: string }) {
  return (
    <div className="c5-case c5-case--loading">
      <div className="c5-board" aria-hidden="true">
        {ACHIEVEMENT_GROUPS.map((group) => (
          <div key={group} className="c5-group" data-group={group}>
            <div className="c5-group__head"><span className="c5-skeleton c5-skeleton--label" /></div>
            <div className="c5-group__tiles" style={{ gridTemplateColumns: `repeat(${COLUMNS[group]}, minmax(0, 1fr))` }}>
              {Array.from({ length: group === "focus" ? 4 : 3 }, (_, index) => (
                <span key={index} className="c5-tile c5-tile--placeholder"><span className="c5-skeleton c5-skeleton--medal" /><span className="c5-skeleton c5-skeleton--name" /></span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="c5-rail c5-rail--loading">
        <div className="c5-rail__body">
          <span className="c5-skeleton c5-skeleton--rail-medal" aria-hidden="true" />
          <div className="c5-rail__story">
            <p className="c5-rail__context" role="status">{label}</p>
            <span className="c5-skeleton c5-skeleton--title" aria-hidden="true" />
            <span className="c5-skeleton c5-skeleton--line" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Insights › Achievements as one board: all thirteen in a single case, the chosen one's label under it. */
export function C5Tab({ model }: AchievementLayoutTabProps) {
  const { t } = useLocalization();
  const { status, failedEmpty, selected, isNew, onOpenDay, onRetry } = model;

  if (model.loading) return <Loading label={t("achievements.loading")} />;

  return (
    <>
      {status === "error" && !failedEmpty ? (
        <p className="c5-notice" role="alert">
          <span>{t("achievements.error")}</span>
          <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
        </p>
      ) : null}
      <div className="c5-case">
        <Board model={model} />
        {failedEmpty ? (
          <div className="c5-rail c5-rail--error" role="alert">
            <p>{t("achievements.error")}</p>
            <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onRetry}>{t("achievements.retry")}</button>
          </div>
        ) : selected ? (
          <C5Rail item={selected} isNew={isNew(selected)} onOpenDay={onOpenDay} />
        ) : null}
      </div>
    </>
  );
}
