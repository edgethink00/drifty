import { useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";

import type { AiModelOption } from "./AiSetupModelDialogs";
import {
  OPENROUTER_RECOMMENDED_MODELS,
  isForbiddenOpenRouterModel,
  isRecommendedOpenRouterModel,
  normalizeOpenRouterFallbackModels,
  normalizeOpenRouterPrimaryModel,
  uniqueOpenRouterModels,
} from "./localAiSetup";
import type { LocalAiSetupState } from "./localAiSetup";

export function useAiSetupModelPickers(
  localAiSetup: LocalAiSetupState,
  onLocalAiSetupChange: Dispatch<SetStateAction<LocalAiSetupState>>,
) {
  const [openRouterModelPickerOpen, setOpenRouterModelPickerOpen] = useState(false);
  const [openRouterCustomModel, setOpenRouterCustomModel] = useState("");

  const openRouterPrimaryModel = normalizeOpenRouterPrimaryModel(localAiSetup.openRouterModel);
  const openRouterFallbackModels = useMemo(
    () => normalizeOpenRouterFallbackModels(openRouterPrimaryModel, localAiSetup.openRouterFallbackModels),
    [localAiSetup.openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterSelectedModels = useMemo(
    () => uniqueOpenRouterModels([openRouterPrimaryModel, ...openRouterFallbackModels]),
    [openRouterFallbackModels, openRouterPrimaryModel],
  );
  const openRouterCustomSelectedModels = openRouterSelectedModels.filter((model) => !isRecommendedOpenRouterModel(model));
  const openRouterModelOptions = useMemo((): readonly AiModelOption[] => [
    ...OPENROUTER_RECOMMENDED_MODELS,
    ...openRouterCustomSelectedModels.map((model) => ({ id: model, label: model, detail: "Other model" })),
  ], [openRouterCustomSelectedModels]);
  const openRouterSelectionSummary = openRouterFallbackModels.length > 0
    ? `${openRouterPrimaryModel} + ${openRouterFallbackModels.length} fallback${openRouterFallbackModels.length === 1 ? "" : "s"}`
    : openRouterPrimaryModel;

  const handleOpenRouterModelToggle = (model: string, selected: boolean) => {
    const modelId = model.trim();
    if (!modelId) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (selected) {
        if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
        return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
      }

      if (modelId === primaryModel) {
        const [nextPrimaryModel, ...nextFallbackModels] = fallbackModels;
        if (!nextPrimaryModel) return current;
        return { ...current, openRouterModel: nextPrimaryModel, openRouterFallbackModels: nextFallbackModels };
      }

      return { ...current, openRouterFallbackModels: fallbackModels.filter((fallbackModel) => fallbackModel !== modelId) };
    });
  };

  const handleOpenRouterPrimaryModelChange = (model: string) => {
    const modelId = model.trim();
    if (!modelId) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      const selectedModels = uniqueOpenRouterModels([primaryModel, ...fallbackModels, modelId]);
      return { ...current, openRouterModel: modelId, openRouterFallbackModels: selectedModels.filter((selectedModel) => selectedModel !== modelId) };
    });
  };

  const handleAddOpenRouterCustomModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const modelId = openRouterCustomModel.trim();
    if (!modelId || isForbiddenOpenRouterModel(modelId)) return;

    onLocalAiSetupChange((current) => {
      const primaryModel = normalizeOpenRouterPrimaryModel(current.openRouterModel);
      const fallbackModels = normalizeOpenRouterFallbackModels(primaryModel, current.openRouterFallbackModels);
      if (modelId === primaryModel || fallbackModels.includes(modelId)) return current;
      return { ...current, openRouterFallbackModels: [...fallbackModels, modelId] };
    });
    setOpenRouterCustomModel("");
  };

  return {
    handleAddOpenRouterCustomModel,
    handleOpenRouterModelToggle,
    handleOpenRouterPrimaryModelChange,
    openRouterCustomModel,
    openRouterFallbackModels,
    openRouterModelOptions,
    openRouterModelPickerOpen,
    openRouterPrimaryModel,
    openRouterSelectedModels,
    openRouterSelectionSummary,
    setOpenRouterCustomModel,
    setOpenRouterModelPickerOpen,
  };
}
