/**
 * The medal's design axes the dev review compares, each with five choices,
 * the first being the medal as shipped. Kept free of three.js so the review
 * state and the page around the app can use it; render3d/medal.ts reads it.
 */
export const MEDAL_FORMS = ["struck", "coin", "dome", "pin", "plate"] as const;
export const MEDAL_PALETTES = ["original", "muted", "pastel", "jewel", "group"] as const;
export const MEDAL_METALS = ["polished", "satin", "rose", "gunmetal", "platinum"] as const;
export const MEDAL_MARKS = ["glaze", "metal", "tone", "engraved", "ink"] as const;
export const MEDAL_ARTS = ["line", "relief", "seal", "geo", "numeral"] as const;

export type MedalForm = (typeof MEDAL_FORMS)[number];
export type MedalPalette = (typeof MEDAL_PALETTES)[number];
export type MedalMetal = (typeof MEDAL_METALS)[number];
export type MedalMark = (typeof MEDAL_MARKS)[number];
export type MedalArt = (typeof MEDAL_ARTS)[number];

export type MedalStyle = {
  readonly form: MedalForm;
  readonly palette: MedalPalette;
  readonly metal: MedalMetal;
  readonly mark: MedalMark;
  /** What the mark is drawn as; mark says what it is made of. */
  readonly art: MedalArt;
};

export const DEFAULT_MEDAL_STYLE: MedalStyle = { form: "struck", palette: "original", metal: "polished", mark: "glaze", art: "line" };

/** The owner's choice of 2026-11-26 for form, palette and metal; the review opens on it until it is baked in. */
export const CHOSEN_MEDAL_STYLE: MedalStyle = { form: "coin", palette: "muted", metal: "rose", mark: "glaze", art: "line" };

/** The style's axes in the order its key and links spell them. */
export const MEDAL_STYLE_KEYS = ["form", "palette", "metal", "mark", "art"] as const;

/** The axes in picker order, with the review page's words for each choice. */
export const MEDAL_STYLE_AXES = [
  { key: "form", label: "배지 형태 (3D)", options: [
    ["struck", "타각 메달 (지금)"], ["coin", "두꺼운 동전"], ["dome", "유리 돔"], ["pin", "에나멜 핀"], ["plate", "각진 판"],
  ] },
  { key: "palette", label: "배지 색 팔레트", options: [
    ["original", "원래 색 (지금)"], ["muted", "차분한 색"], ["pastel", "파스텔"], ["jewel", "보석 색"], ["group", "묶음별 4색"],
  ] },
  { key: "metal", label: "배지 금속", options: [
    ["polished", "광택 은·금 (지금)"], ["satin", "무광 은·금"], ["rose", "은·로즈골드"], ["gunmetal", "건메탈·금"], ["platinum", "백금·샴페인"],
  ] },
  { key: "art", label: "배지 마크 그림", options: [
    ["line", "선 아이콘 (지금)"], ["relief", "돋을새김 그림"], ["seal", "문장 (테 안 그림)"], ["geo", "기하 문양"], ["numeral", "숫자"],
  ] },
  { key: "mark", label: "배지 마크 재질", options: [
    ["glaze", "흰 유약 (지금)"], ["metal", "금속 양각"], ["tone", "같은 색 양각"], ["engraved", "음각"], ["ink", "평면 인쇄"],
  ] },
] as const;

const CHOICES: Readonly<Record<keyof MedalStyle, readonly string[]>> = { form: MEDAL_FORMS, palette: MEDAL_PALETTES, metal: MEDAL_METALS, mark: MEDAL_MARKS, art: MEDAL_ARTS };

/** A style from untrusted input, each axis falling back to the shipped choice. */
export function readMedalStyle(value: unknown, base: MedalStyle = DEFAULT_MEDAL_STYLE): MedalStyle {
  const input = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const pick = <K extends keyof MedalStyle>(key: K): MedalStyle[K] => (typeof input[key] === "string" && CHOICES[key].includes(input[key] as string) ? input[key] : base[key]) as MedalStyle[K];
  return { form: pick("form"), palette: pick("palette"), metal: pick("metal"), mark: pick("mark"), art: pick("art") };
}

/** A style from a key or link ("coin.muted.rose.glaze.relief"); missing axes take base's. */
export function parseMedalStyleKey(key: string | null | undefined, base: MedalStyle = DEFAULT_MEDAL_STYLE): MedalStyle {
  const parts = (key ?? "").split(".");
  return readMedalStyle(Object.fromEntries(MEDAL_STYLE_KEYS.map((axis, index) => [axis, parts[index]])), base);
}

export function medalStyleKey(style: MedalStyle): string {
  return MEDAL_STYLE_KEYS.map((axis) => style[axis]).join(".");
}

export function isShippedMedalStyle(style: MedalStyle): boolean {
  return medalStyleKey(style) === medalStyleKey(DEFAULT_MEDAL_STYLE);
}
