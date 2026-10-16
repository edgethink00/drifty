// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@drifty/domain";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { CategoryEditorSheet, type CategoryEditorSheetProps } from "./CategoryEditorSheet";
import { useCategoryCustomizationController } from "../settings/useCategoryCustomizationController";
import { CATEGORY_CUSTOMIZATION_STORAGE_KEY, PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY, readCategoryCustomizations, readProductivityCustomizations } from "../settings/settingsStorage";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Drifty 출시",
    description: "릴리스 노트, 노타리 작업, 출시 체크리스트",
    color: "#5366a3",
    status: "active",
    anchors: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSheet(overrides: Partial<CategoryEditorSheetProps> = {}) {
  const props: CategoryEditorSheetProps = {
    initialTarget: { group: "category", key: "learning" },
    categoryCustomizations: {},
    productivityCustomizations: {},
    categoryColorOverrides: {},
    appThemeColorOverrides: {},
    showProjects: true,
    projects: [project(), project({ id: "p2", name: "블로그", description: "", color: "#9b5b91", status: "archived" })],
    onSaveDefinitions: vi.fn(),
    onCategoryColorChange: vi.fn(),
    onCategoryColorReset: vi.fn(),
    onProductivityColorChange: vi.fn(),
    onProductivityColorReset: vi.fn(),
    onSaveProject: vi.fn().mockResolvedValue(true),
    onDeleteProject: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <LocalizationTestProvider language="ko">
      <CategoryEditorSheet {...props} />
    </LocalizationTestProvider>,
  );
  return props;
}

const tabs = () => screen.getByRole("tablist", { name: "분류 기준 목록" });
const tab = (name: string) => within(tabs()).getByRole("tab", { name: new RegExp("^" + name) });
// A card in the open group, found by the name it starts with.
const card = (name: string) => screen.queryAllByRole("button", { name: new RegExp("^" + name) }).find((button) => button.classList.contains("category-editor__card-button"));
// Opens a card for editing, switching to its group when it lives in another.
const openCard = (name: string) => {
  let button = card(name);
  for (const groupTab of within(tabs()).getAllByRole("tab")) {
    if (button) break;
    fireEvent.click(groupTab);
    button = card(name);
  }
  if (!button) throw new Error("no card named " + name);
  fireEvent.click(button);
};
const pane = () => screen.getByRole("region");

async function save() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장" })); });
}

describe("CategoryEditorSheet", () => {
  afterEach(() => cleanup());

  it("lists each group as cards and opens the requested one for editing", () => {
    renderSheet();

    // The flow chart's color-by switch order and names.
    expect(within(tabs()).getAllByRole("tab").map((groupTab) => groupTab.textContent)).toEqual(["생산성", "카테고리", "프로젝트"]);
    expect(tab("카테고리").getAttribute("aria-selected")).toBe("true");
    for (const name of ["작업", "유틸리티"]) expect(card(name)).toBeTruthy();
    expect(card("미분류")).toBeUndefined();
    expect(card("집중")).toBeUndefined();
    expect(screen.getByRole("region", { name: "학습" })).toBeTruthy();
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toMatch(/^정보를 찾거나 읽는 시간/);
    // Nothing changed yet, so the footer offers only Done.
    expect(screen.getByRole("button", { name: "완료" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "저장" })).toBeNull();
    // No standing footnote: the footer only speaks when saving will do something.
    expect(document.querySelector(".category-editor__foot-note")).toBeNull();

    // Switching groups closes the card being edited; each productivity label
    // lists the categories that count under it.
    fireEvent.click(tab("생산성"));
    for (const name of ["집중", "중립", "딴짓"]) expect(card(name)).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(card("집중")?.textContent).toContain("작업");
    expect(card("집중")?.textContent).toContain("학습");

    fireEvent.click(tab("프로젝트"));
    expect(card("Drifty 출시")).toBeTruthy();
    expect(card("블로그")?.closest(".category-editor__card")?.className).toContain("is-muted");
    expect(screen.getByRole("button", { name: "새 프로젝트" })).toBeTruthy();
  });

  it("keeps edits as drafts across definitions and saves them as one change", async () => {
    const props = renderSheet();

    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();

    openCard("딴짓");
    expect(screen.getByRole("region", { name: "딴짓" })).toBeTruthy();
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "유튜브 쇼츠" } });

    openCard("학습");
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("WWDC 세션");

    await save();

    expect(props.onSaveDefinitions).toHaveBeenCalledTimes(1);
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({
      categories: { learning: { description: "WWDC 세션" } },
      productivity: { drift: { description: "유튜브 쇼츠" } },
    });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("edits an item's own description, starting from Drifty's", async () => {
    const props = renderSheet({ categoryCustomizations: { workspace: { name: "개발", description: "사이드 프로젝트 코딩" } } });

    // The field holds the description in effect: Drifty's until it is edited.
    const field = within(pane()).getByLabelText("설명") as HTMLTextAreaElement;
    expect(field.value).toMatch(/^정보를 찾거나 읽는 시간/);
    expect(within(pane()).queryByRole("button", { name: "기본으로 복원" })).toBeNull();
    // Arriving by keyboard puts the caret after the prefilled text.
    field.setSelectionRange(0, 0);
    fireEvent.focus(field);
    expect(field.selectionStart).toBe(field.value.length);

    // A closed card shows a description the user wrote; Drifty's own shows
    // only in the open card's field.
    expect(card("개발")?.textContent).toContain("사이드 프로젝트 코딩");
    expect(card("커뮤니케이션")?.querySelector(".category-editor__card-detail")).toBeNull();

    // Editing Drifty's text makes it this item's description.
    // A space typed after the prefilled text stays while the next word comes.
    const builtIn = field.value;
    fireEvent.change(field, { target: { value: builtIn + " " } });
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe(builtIn + " ");
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: builtIn + " 유튜브 개발 강의도 여기로." } });
    expect(within(pane()).getByRole("button", { name: "기본으로 복원" })).toBeTruthy();

    // An emptied description goes back to Drifty's.
    openCard("개발");
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "" } });

    await save();
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({
      categories: {
        learning: { description: expect.stringMatching(/^정보를 찾거나 읽는 시간.* 유튜브 개발 강의도 여기로\.$/) },
        workspace: { name: "개발" },
      },
      productivity: {},
    });
  });

  it("renames a category and fixes its productivity from that label's card without asking for a reclassification", async () => {
    const props = renderSheet();

    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "개발 공부" } });
    expect(screen.getByRole("region", { name: "개발 공부" })).toBeTruthy();
    // A category's card defines it; where it counts is set on the productivity side.
    expect(within(pane()).queryByRole("radiogroup")).toBeNull();

    // Learning already counts as focus while Drifty decides; fixing it there is
    // still one pick from the focus card's list.
    openCard("집중");
    fireEvent.click(within(pane()).getByRole("button", { name: "카테고리 추가" }));
    const learning = screen.getByRole("menuitem", { name: /^개발 공부/ });
    expect(learning.textContent).toContain("Drifty 판단");
    fireEvent.click(learning);
    expect(within(pane()).getByRole("button", { name: "개발 공부 빼기" })).toBeTruthy();

    await save();

    expect(props.onSaveDefinitions).toHaveBeenCalledWith({
      categories: { learning: { name: "개발 공부", productivity: "focus" } },
      productivity: {},
    });
  });

  it("saves a color alone through the color handlers", async () => {
    const props = renderSheet({ initialTarget: { group: "productivity", key: "focus" } });

    fireEvent.click(within(pane()).getByRole("button", { name: /^색상 · / }));
    const swatch = within(pane()).getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") === "false");
    if (!swatch) throw new Error("no other swatch");
    fireEvent.click(swatch);

    await save();

    expect(props.onProductivityColorChange).toHaveBeenCalledWith("productivityFocus", expect.stringMatching(/^#[0-9a-f]{6}$/));
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
  });

  it("waits for definition persistence before closing or saving projects", async () => {
    let finish!: () => void;
    const props = renderSheet({ onSaveDefinitions: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });
    openCard("Drifty 출시");
    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "새 출시" } });
    await save();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSaveProject).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /저장/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); });
    expect(props.onSaveProject).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps both drafts after a real store failure and retries a partially saved definition batch", async () => {
    window.localStorage.clear();
    const controller = renderHook(() => useCategoryCustomizationController());
    const props = renderSheet({ onSaveDefinitions: changes => controller.result.current.saveDefinitions(changes) });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });
    openCard("집중");
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "개발 작업" } });
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY) throw new DOMException("Synthetic storage full", "QuotaExceededError");
      original.call(this, key, value);
    });
    try {
      await save();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("입력은 그대로예요");
      expect(readCategoryCustomizations().learning?.description).toBe("WWDC 세션");
      expect(window.localStorage.getItem(PRODUCTIVITY_CUSTOMIZATION_STORAGE_KEY)).toBeNull();
      expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("개발 작업");
      openCard("학습");
      expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("WWDC 세션");
      write.mockRestore();
      await save();
      expect(readProductivityCustomizations().focus?.description).toBe("개발 작업");
      expect(props.onClose).toHaveBeenCalledOnce();
    } finally { write.mockRestore(); window.localStorage.clear(); }
  });

  it("keeps a rejected description and recovers from a synchronous color failure", async () => {
    const color = vi.fn().mockImplementationOnce(() => { throw new Error("Synthetic color storage failure"); });
    const props = renderSheet({ initialTarget: { group: "productivity", key: "focus" }, onProductivityColorChange: color });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "개발 작업" } });
    fireEvent.click(within(pane()).getByRole("button", { name: /^색상 · / }));
    fireEvent.click(within(pane()).getAllByRole("radio").find(radio => radio.getAttribute("aria-checked") === "false")!);
    await save();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("개발 작업");
    await save();
    expect(color).toHaveBeenCalledTimes(2);
    expect(props.onSaveDefinitions).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("restores a definition to Drifty's own name, words, color and productivity in one step", async () => {
    const props = renderSheet({
      initialTarget: { group: "category", key: "game" },
      categoryCustomizations: { game: { name: "플레이", description: "보드게임 앱", productivity: "neutral" } },
      categoryColorOverrides: { game: "#2f7f78" },
    });
    expect(screen.getByRole("region", { name: "플레이" })).toBeTruthy();

    fireEvent.click(within(pane()).getByRole("button", { name: "기본으로 복원" }));

    expect(screen.getByRole("region", { name: "게임" })).toBeTruthy();
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toMatch(/^게임을 하는 시간/);
    expect(within(pane()).queryByRole("button", { name: "기본으로 복원" })).toBeNull();
    await save();
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { game: null }, productivity: {} });
    expect(props.onCategoryColorReset).toHaveBeenCalledWith("game");
  });

  it("folds the open card on Escape before closing the sheet", () => {
    const props = renderSheet();
    expect(screen.getByRole("region", { name: "학습" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("opens the category list when a door names Unclassified, which it does not list", () => {
    renderSheet({ initialTarget: { group: "category", key: "unknown" } });

    expect(tab("카테고리").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("region")).toBeNull();
    expect(card("작업")).toBeTruthy();
    expect(card("미분류")).toBeUndefined();
  });

  it("keeps the footer to its buttons when a description changes", () => {
    renderSheet();

    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });

    expect(document.querySelector(".category-editor__foot-note")).toBeNull();
    expect(screen.getByRole("button", { name: "저장" })).toHaveProperty("disabled", false);
  });

  it("discards every draft on Cancel", () => {
    const props = renderSheet();
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
  });

  it("locks only the projects tab, and only while Intelligence is missing", () => {
    renderSheet({ intelligenceUnavailable: true, onOpenIntelligence: vi.fn(), onConnectProvider: vi.fn() });
    openCard("학습");
    expect(screen.queryByText("프로젝트에 쓸 Intelligence를 골라 주세요")).toBeNull();
    expect(screen.queryByText("Intelligence를 연결해야 프로젝트를 추가하고 고칠 수 있어요.")).toBeNull();
    cleanup();

    renderSheet({ initialTarget: { group: "project" }, intelligenceUnavailable: false, onOpenIntelligence: vi.fn(), onConnectProvider: vi.fn() });
    expect(screen.queryByText("Intelligence를 연결해야 프로젝트를 추가하고 고칠 수 있어요.")).toBeNull();
    expect((screen.getByRole("button", { name: "새 프로젝트" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks the empty projects tab with one row per way in, each saying what it takes", () => {
    for (const [cloudOffer, detail, go] of [
      ["sign-in", "로그인하면 1주 무료 체험", "로그인"],
      ["trial", "1주 무료 체험", "체험 시작"],
      ["plan", "Pro 구독 · 유료", "요금제 보기"],
    ] as const) {
      renderSheet({ projects: [], intelligenceUnavailable: true, cloudOffer, onOpenIntelligence: vi.fn(), onConnectProvider: vi.fn() });
      fireEvent.click(tab("프로젝트"));

      expect(screen.getByText("프로젝트에 쓸 Intelligence를 골라 주세요")).toBeTruthy();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByRole("button", { name: "새 프로젝트" })).toBeNull();
      const cloud = screen.getByRole("button", { name: /^Drifty Cloud/ });
      expect(within(cloud).getByText(detail)).toBeTruthy();
      expect(within(cloud).getByText(go)).toBeTruthy();
      for (const name of ["OpenRouter", "사용자 지정 엔드포인트", "OpenAI", "Anthropic"]) {
        expect(screen.getByRole("button", { name: new RegExp("^" + name) })).toBeTruthy();
      }
      cleanup();
    }
  });

  it("opens the lock instead of a draft when a new project is asked for while locked", () => {
    renderSheet({ initialTarget: { group: "project", key: "new" }, projects: [], intelligenceUnavailable: true, onOpenIntelligence: vi.fn(), onConnectProvider: vi.fn() });

    expect(screen.queryByRole("region", { name: "이름 없는 프로젝트" })).toBeNull();
    expect(screen.getByText("프로젝트에 쓸 Intelligence를 골라 주세요")).toBeTruthy();
  });

  it("starts the Drifty Cloud trial without leaving the editor", async () => {
    const onStartTrial = vi.fn().mockResolvedValue(undefined);
    const onStartCloud = vi.fn();
    const props = renderSheet({ projects: [], intelligenceUnavailable: true, cloudOffer: "trial", onOpenIntelligence: vi.fn(), onStartCloud, onStartTrial, onConnectProvider: vi.fn() });
    fireEvent.click(tab("프로젝트"));

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Drifty Cloud/ })); });
    expect(onStartTrial).toHaveBeenCalledOnce();
    expect(onStartCloud).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens the plans for Drifty Cloud when no trial is left", async () => {
    const onStartCloud = vi.fn();
    const onStartTrial = vi.fn();
    const props = renderSheet({ projects: [], intelligenceUnavailable: true, cloudOffer: "plan", onOpenIntelligence: vi.fn(), onStartCloud, onStartTrial, onConnectProvider: vi.fn() });
    fireEvent.click(tab("프로젝트"));

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Drifty Cloud/ })); });
    expect(onStartCloud).toHaveBeenCalledOnce();
    expect(onStartTrial).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("connects a ready OpenRouter key in place and sends other models to their settings card", async () => {
    const onConnectProvider = vi.fn();
    const props = renderSheet({ projects: [], intelligenceUnavailable: true, cloudOffer: "sign-in", openRouterReady: true, onOpenIntelligence: vi.fn(), onConnectProvider });
    fireEvent.click(tab("프로젝트"));

    const openRouter = screen.getByRole("button", { name: /^OpenRouter/ });
    expect(within(openRouter).getByText("바로 연결")).toBeTruthy();
    fireEvent.click(openRouter);
    expect(onConnectProvider).toHaveBeenLastCalledWith("openrouter", true);
    expect(props.onClose).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^사용자 지정 엔드포인트/ })); });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(onConnectProvider).toHaveBeenLastCalledWith("self_hosted", false);
  });

  it("saves other edits before leaving for an Intelligence setting", async () => {
    const onConnectProvider = vi.fn();
    const props = renderSheet({ projects: [], intelligenceUnavailable: true, onOpenIntelligence: vi.fn(), onConnectProvider });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "WWDC 세션" } });
    fireEvent.click(tab("프로젝트"));

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Anthropic/ })); });
    expect(props.onSaveDefinitions).toHaveBeenCalledOnce();
    expect(onConnectProvider).toHaveBeenCalledWith("anthropic", false);
  });

  it("keeps existing projects visible but closed while locked", async () => {
    const onOpenIntelligence = vi.fn();
    renderSheet({ initialTarget: { group: "project" }, intelligenceUnavailable: true, onOpenIntelligence, onConnectProvider: vi.fn() });

    expect(screen.getByText("Intelligence를 연결해야 프로젝트를 추가하고 고칠 수 있어요.")).toBeTruthy();
    expect((card("Drifty 출시") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "새 프로젝트" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Intelligence 설정/ })); });
    expect(onOpenIntelligence).toHaveBeenCalledOnce();
  });

  it("starts a new project as a draft that needs a name", async () => {
    const props = renderSheet({ initialTarget: { group: "project", key: "new" } });
    expect(screen.getByRole("region", { name: "이름 없는 프로젝트" })).toBeTruthy();

    await save();
    expect(within(pane()).getByRole("alert").textContent).toBe("저장하려면 프로젝트 이름을 적어 주세요.");
    expect(props.onSaveProject).not.toHaveBeenCalled();

    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "블로그 리뉴얼" } });
    fireEvent.change(within(pane()).getByLabelText(/설명/), { target: { value: "새 디자인과 글 옮기기" } });
    await save();

    expect(props.onSaveProject).toHaveBeenCalledWith({ name: "블로그 리뉴얼", description: "새 디자인과 글 옮기기", color: expect.any(String), status: "active" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("adds and discards a project draft under the project cards", () => {
    renderSheet();

    fireEvent.click(tab("프로젝트"));
    fireEvent.click(screen.getByRole("button", { name: "새 프로젝트" }));
    expect(screen.getByRole("region", { name: "이름 없는 프로젝트" })).toBeTruthy();
    fireEvent.click(within(pane()).getByRole("button", { name: "추가 취소" }));

    expect(screen.queryByRole("region")).toBeNull();
    expect(card("이름 없는 프로젝트")).toBeUndefined();
    expect(card("Drifty 출시")).toBeTruthy();
    expect(screen.getByRole("button", { name: "완료" })).toBeTruthy();
  });

  it("keeps the sheet open on the project that failed to save", async () => {
    const props = renderSheet({
      initialTarget: { group: "project", key: "p1" },
      onSaveProject: vi.fn().mockResolvedValue({ saved: false, error: "database is locked" }),
    });

    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "Drifty 2.0" } });
    await save();

    expect(props.onSaveProject).toHaveBeenCalledWith({ id: "p1", name: "Drifty 2.0", description: "릴리스 노트, 노타리 작업, 출시 체크리스트", color: "#5366a3", status: "active" });
    expect(within(pane()).getByRole("alert").textContent).toBe("database is locked");
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Drifty 2.0" })).toBeTruthy();
  });

  it("archives a project at once and deletes it only after confirming", async () => {
    const props = renderSheet({ initialTarget: { group: "project", key: "p1" } });

    await act(async () => { fireEvent.click(within(pane()).getByRole("button", { name: "보관" })); });
    expect(props.onSaveProject).toHaveBeenCalledWith(expect.objectContaining({ id: "p1", status: "archived" }));

    fireEvent.click(within(pane()).getByRole("button", { name: "프로젝트 삭제" }));
    expect(props.onDeleteProject).not.toHaveBeenCalled();
    const confirm = screen.getByRole("dialog", { name: /Drifty 출시/ });
    await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "프로젝트 삭제" })); });
    expect(props.onDeleteProject).toHaveBeenCalledWith("p1");
  });

  it("says how much recent time a project holds before deleting it", () => {
    renderSheet({ initialTarget: { group: "project", key: "p1" }, projectRecentSeconds: new Map([["p1", 2 * 3600 + 30 * 60]]) });

    fireEvent.click(within(pane()).getByRole("button", { name: "프로젝트 삭제" }));

    const confirm = screen.getByRole("dialog", { name: /Drifty 출시/ });
    expect(within(confirm).getByText("최근 7일 동안 2시간 30분이 연결돼 있어요.")).toBeTruthy();
  });

  it("leaves the time out of the confirmation when the project has none", () => {
    renderSheet({ initialTarget: { group: "project", key: "p1" }, projectRecentSeconds: new Map() });

    fireEvent.click(within(pane()).getByRole("button", { name: "프로젝트 삭제" }));

    const confirm = screen.getByRole("dialog", { name: /Drifty 출시/ });
    expect(within(confirm).queryByText(/연결돼 있어요/)).toBeNull();
  });

  it("keeps the projects tab open when there is no project", () => {
    renderSheet({ projects: [] });

    fireEvent.click(tab("프로젝트"));

    expect(tab("프로젝트").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("아직 프로젝트가 없어요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 프로젝트" })).toBeTruthy();
  });

  it("hides projects when they are off", () => {
    renderSheet({ showProjects: false });

    expect(within(tabs()).getAllByRole("tab").map((groupTab) => groupTab.textContent)).toEqual(["생산성", "카테고리"]);
  });

  it("keeps a category row to its name, leaving where it counts to the productivity tab", () => {
    renderSheet({ initialTarget: { group: "category" }, categoryCustomizations: { learning: { productivity: "focus" } } });

    // Learning is fixed to focus and communication is decided per activity; neither row says so.
    expect(card("학습")?.textContent).toBe("학습");
    expect(card("커뮤니케이션")?.textContent).toBe("커뮤니케이션");
    fireEvent.click(tab("생산성"));
    expect(card("집중")?.textContent).toContain("학습");
  });

  it("adds a productivity level after neutral that saves with its name, color, and the categories fixed to it", async () => {
    const props = renderSheet({ initialTarget: { group: "productivity" } });
    const tagsOf = (name: string) => Array.from(card(name)?.querySelectorAll(".category-editor__tag") ?? [], (tag) => tag.textContent);

    fireEvent.click(screen.getByRole("button", { name: "새 단계" }));
    // A new level has a name and a color, and no description: the classifier never picks it.
    expect(screen.getByRole("region", { name: "새 단계" }).closest("li")?.classList.contains("is-new")).toBe(true);
    expect((within(pane()).getByLabelText("이름") as HTMLInputElement).placeholder).toBe("예: 가벼운 일");
    expect(within(pane()).queryByLabelText("설명")).toBeNull();
    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "휴식" } });
    fireEvent.click(within(pane()).getByRole("button", { name: "카테고리 추가" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /엔터테인먼트/ }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(tagsOf("휴식")).toEqual(["엔터테인먼트"]);
    expect(tagsOf("딴짓")).not.toContain("엔터테인먼트");
    const order = screen.getAllByRole("button").filter((button) => button.classList.contains("category-editor__card-button")).map((button) => button.textContent?.slice(0, 2));
    expect(order).toEqual(["집중", "중립", "휴식", "딴짓"]);
    await save();

    const changes = vi.mocked(props.onSaveDefinitions).mock.calls[0]?.[0];
    const [id, level] = Object.entries(changes?.productivity ?? {})[0] ?? [];
    expect(id).toMatch(/^level-[a-z0-9]{8}$/);
    expect(level).toEqual({ name: "휴식", color: expect.stringMatching(/^#[0-9a-f]{6}$/), createdAt: expect.any(String) });
    // The category counts as neutral wherever a score is kept.
    expect(changes?.categories).toEqual({ entertainment: { productivity: "neutral", level: id } });
  });

  it("asks for a new level's name once it holds a category, and drops one left untouched", async () => {
    const props = renderSheet({ initialTarget: { group: "productivity" } });

    fireEvent.click(screen.getByRole("button", { name: "새 단계" }));
    fireEvent.click(within(pane()).getByRole("button", { name: "카테고리 추가" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /음악/ }));
    await save();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
    expect(within(pane()).getByRole("alert").textContent).toBe("저장하려면 단계 이름을 적어 주세요.");

    fireEvent.click(within(pane()).getByRole("button", { name: "추가 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "새 단계" }));
    await save();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("deletes a saved level so its categories go back to Drifty's judgment, with an undo until Save", async () => {
    const props = renderSheet({
      initialTarget: { group: "productivity", key: "focus" },
      productivityCustomizations: { "level-rest0001": { name: "휴식", color: "#5b86b5", createdAt: "2026-10-16T00:00:00.000Z" } },
      categoryCustomizations: { entertainment: { productivity: "neutral", level: "level-rest0001" } },
    });
    const tagsOf = (name: string) => Array.from(card(name)?.querySelectorAll(".category-editor__tag") ?? [], (tag) => tag.textContent);

    // The built-in levels stay; an added one can go.
    expect(within(pane()).queryByRole("button", { name: "삭제" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(tagsOf("휴식")).toEqual(["엔터테인먼트"]);
    openCard("휴식");
    fireEvent.click(within(pane()).getByRole("button", { name: "삭제" }));
    expect(screen.getByText("저장하면 지워져요")).toBeTruthy();
    expect(tagsOf("딴짓")).toContain("엔터테인먼트");
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(tagsOf("휴식")).toEqual(["엔터테인먼트"]);

    openCard("휴식");
    fireEvent.click(within(pane()).getByRole("button", { name: "삭제" }));
    await save();
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { entertainment: null }, productivity: { "level-rest0001": null } });
  });

  it("stops adding at six productivity levels", () => {
    const levels = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [
      "level-full000" + index,
      { name: "단계 " + index, color: "#5b86b5", createdAt: new Date(Date.UTC(2026, 9, 16, 0, index)).toISOString() },
    ]));
    renderSheet({ initialTarget: { group: "productivity" }, productivityCustomizations: levels });

    expect(card("단계 2")).toBeTruthy();
    const add = screen.getByRole("button", { name: "새 단계" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("생산성은 6단계까지 둘 수 있어요.");
  });

  it("answers ⌘/Ctrl+Enter with the primary button: Done before a change, Save after", async () => {
    const props = renderSheet();
    const field = within(pane()).getByLabelText("설명") as HTMLTextAreaElement;
    expect(screen.getByRole("button", { name: "완료" }).getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");

    fireEvent.change(field, { target: { value: "WWDC 세션" } });
    expect(screen.getByRole("button", { name: "저장" }).getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
    await act(async () => { fireEvent.keyDown(field, { key: "Enter", metaKey: true }); });
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { learning: { description: "WWDC 세션" } }, productivity: {} });

    // Nothing changed: the same key is Done and closes the sheet.
    cleanup();
    const fresh = renderSheet({ initialTarget: { group: "category" } });
    fireEvent.keyDown(screen.getByRole("tab", { name: /^카테고리/ }), { key: "Enter", metaKey: true });
    expect(fresh.onClose).toHaveBeenCalledTimes(1);
    expect(fresh.onSaveDefinitions).not.toHaveBeenCalled();
  });

  it("deletes and adds categories and adds levels, but never deletes a built-in level", () => {
    renderSheet();

    expect(within(pane()).getByRole("button", { name: "삭제" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 카테고리" })).toBeTruthy();
    fireEvent.click(tab("생산성"));
    expect(screen.getByRole("button", { name: "새 단계" })).toBeTruthy();
    openCard("집중");
    expect(within(pane()).queryByRole("button", { name: "삭제" })).toBeNull();
  });

  it("saves a deleted category with the time it stopped being used, and says which rules turn off", async () => {
    const props = renderSheet({ initialTarget: { group: "category" }, ruleCountByCategory: { shopping: 2 } });

    openCard("쇼핑");
    fireEvent.click(within(pane()).getByRole("button", { name: "삭제" }));
    expect(screen.getByText("저장하면 새 활동에는 쓰지 않아요 · 규칙 2개도 꺼져요")).toBeTruthy();
    await save();

    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { shopping: { deletedAt: expect.any(String) } }, productivity: {} });
  });

  it("adds a category that saves with its own id, name, words, color, and creation time", async () => {
    const props = renderSheet({ initialTarget: { group: "category" } });

    fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
    // The new card opens in edit with examples (kept gray) in place of Drifty's own words.
    expect(screen.getByRole("region", { name: "새 카테고리" }).closest("li")?.classList.contains("is-new")).toBe(true);
    expect((within(pane()).getByLabelText("이름") as HTMLInputElement).placeholder).toBe("예: 독서");
    expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "사이드 프로젝트" } });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "주말에 만드는 앱" } });
    await save();

    const saved = vi.mocked(props.onSaveDefinitions).mock.calls[0]?.[0].categories ?? {};
    const [id, entry] = Object.entries(saved)[0] ?? [];
    expect(id).toMatch(/^custom-[a-z0-9]{8}$/);
    expect(entry).toEqual({ name: "사이드 프로젝트", description: "주말에 만드는 앱", color: expect.stringMatching(/^#[0-9a-f]{6}$/), createdAt: expect.any(String) });
  });

  it("keeps a new category and its id after a real storage failure and retries it", async () => {
    window.localStorage.clear();
    const controller = renderHook(() => useCategoryCustomizationController());
    const persist = vi.fn((changes: Parameters<CategoryEditorSheetProps["onSaveDefinitions"]>[0]) => controller.result.current.saveDefinitions(changes));
    const props = renderSheet({ initialTarget: { group: "category" }, onSaveDefinitions: persist });
    fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
    fireEvent.change(within(pane()).getByLabelText("이름"), { target: { value: "사이드 프로젝트" } });
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "주말에 만드는 앱" } });
    const original = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === CATEGORY_CUSTOMIZATION_STORAGE_KEY) throw new DOMException("Synthetic storage full", "QuotaExceededError");
      original.call(this, key, value);
    });
    try {
      await save();
      const id = Object.keys(persist.mock.calls[0][0].categories ?? {})[0];
      expect(id).toMatch(/^custom-[a-z0-9]{8}$/);
      expect(readCategoryCustomizations()).toEqual({});
      expect(props.onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("입력은 그대로예요");
      expect(screen.getByRole("region", { name: "사이드 프로젝트" }).closest("li")?.classList.contains("is-new")).toBe(true);
      expect((within(pane()).getByLabelText("설명") as HTMLTextAreaElement).value).toBe("주말에 만드는 앱");
      write.mockRestore();
      await save();
      expect(Object.keys(persist.mock.calls[1][0].categories ?? {})).toEqual([id]);
      expect(readCategoryCustomizations()).toEqual({ [id]: { name: "사이드 프로젝트", description: "주말에 만드는 앱", color: expect.stringMatching(/^#[0-9a-f]{6}$/), createdAt: expect.any(String) } });
      expect(props.onClose).toHaveBeenCalledOnce();
    } finally { write.mockRestore(); window.localStorage.clear(); }
  });

  it("asks for a new category's name, and drops one left untouched", async () => {
    const props = renderSheet({ initialTarget: { group: "category" } });

    fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
    fireEvent.change(within(pane()).getByLabelText("설명"), { target: { value: "주말에 만드는 앱" } });
    await save();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
    expect(within(pane()).getByRole("alert").textContent).toBe("저장하려면 카테고리 이름을 적어 주세요.");

    fireEvent.click(within(pane()).getByRole("button", { name: "추가 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "새 카테고리" }));
    await save();
    expect(props.onSaveDefinitions).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("lists added categories after Drifty's own, edits them in place, and fixes their productivity from a label", async () => {
    const props = renderSheet({
      initialTarget: { group: "productivity", key: "focus" },
      categoryCustomizations: { "custom-side0001": { name: "사이드 프로젝트", color: "#3f7cac", createdAt: "2026-10-16T00:00:00.000Z" } },
    });

    fireEvent.click(within(pane()).getByRole("button", { name: "카테고리 추가" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^사이드 프로젝트/ }));
    await save();

    expect(props.onSaveDefinitions).toHaveBeenCalledWith({
      categories: { "custom-side0001": { name: "사이드 프로젝트", productivity: "focus", color: "#3f7cac", createdAt: "2026-10-16T00:00:00.000Z" } },
      productivity: {},
    });
  });

  it("stops adding at twenty live categories", () => {
    const added = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [
      "custom-full" + String(index).padStart(4, "0"),
      { name: "추가 " + index, color: "#3f7cac", createdAt: new Date(Date.UTC(2026, 9, 16, 0, index)).toISOString() },
    ]));
    renderSheet({ initialTarget: { group: "category" }, categoryCustomizations: added });

    expect(card("추가 10")).toBeTruthy();
    const add = screen.getByRole("button", { name: "새 카테고리" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("카테고리는 20개까지 둘 수 있어요.");
  });

  it("keeps deleted categories apart and restores one on save", async () => {
    const props = renderSheet({
      initialTarget: { group: "category" },
      categoryCustomizations: { shopping: { name: "장보기", deletedAt: "2026-10-15T12:00:00.000Z" } },
    });

    expect(card("장보기")).toBeUndefined();
    const deleted = screen.getByRole("list", { name: "삭제함" });
    expect(within(deleted).getByText("장보기")).toBeTruthy();
    fireEvent.click(within(deleted).getByRole("button", { name: "복원" }));
    expect(card("장보기")).toBeTruthy();
    await save();

    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { shopping: { name: "장보기" } }, productivity: {} });
  });

  it.each(["delete", "restore"] as const)("keeps a pending category %s after save failure and retries it", async (action) => {
    const persist = vi.fn().mockRejectedValueOnce(new Error("Synthetic storage failure")).mockResolvedValue(undefined);
    const props = renderSheet({ initialTarget: { group: "category" }, onSaveDefinitions: persist,
      ...(action === "restore" ? { categoryCustomizations: { shopping: { name: "장보기", deletedAt: "2026-10-15T12:00:00.000Z" } } } : {}) });
    if (action === "delete") {
      openCard("쇼핑");
      fireEvent.click(within(pane()).getByRole("button", { name: "삭제" }));
    } else {
      fireEvent.click(within(screen.getByRole("list", { name: "삭제함" })).getByRole("button", { name: "복원" }));
    }
    await save();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
    await save();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0].categories.shopping).toEqual(action === "delete" ? { deletedAt: expect.any(String) } : { name: "장보기" });
  });

  it("puts a category under a productivity label from that label's card", async () => {
    const props = renderSheet({ initialTarget: { group: "productivity", key: "drift" } });

    fireEvent.click(within(pane()).getByRole("button", { name: "카테고리 추가" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^음악/ }));
    expect(within(pane()).getByRole("button", { name: "음악 빼기" })).toBeTruthy();

    // A press on the list's empty space folds the card; the draft stays until Save.
    const list = screen.getByRole("list", { name: "생산성" });
    fireEvent.pointerDown(list);
    fireEvent.click(list);
    expect(screen.queryByRole("region")).toBeNull();
    expect(card("딴짓")?.textContent).toContain("음악");

    await save();
    expect(props.onSaveDefinitions).toHaveBeenCalledWith({ categories: { music: { productivity: "drift" } }, productivity: {} });
  });
});
