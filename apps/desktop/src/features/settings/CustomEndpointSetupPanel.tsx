import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import { useLocalization } from "../localization/LocalizationContext";
import {
  listOpenAiCompatibleModels,
  OpenAiCompatibleModelListError,
} from "./openAiCompatibleModels";
import { isPreviewAiMockBaseUrl } from "./previewAiContract";

type CustomEndpointSetupPanelProps = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly sharingPartner: "classification" | "intelligence";
  readonly baseUrlAriaLabel: string;
  readonly apiKeyAriaLabel: string;
  readonly modelAriaLabel: string;
  readonly onBaseUrlChange: (value: string) => void;
  readonly onApiKeyChange: (value: string) => void;
  readonly onModelChange: (value: string) => void;
};

export function CustomEndpointSetupPanel({
  baseUrl,
  apiKey,
  model,
  sharingPartner,
  baseUrlAriaLabel,
  apiKeyAriaLabel,
  modelAriaLabel,
  onBaseUrlChange,
  onApiKeyChange,
  onModelChange,
}: CustomEndpointSetupPanelProps) {
  const { t } = useLocalization();
  const modelControlId = useId();
  const modelListboxId = `${modelControlId}-listbox`;
  const modelControlRef = useRef<HTMLDivElement | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ readonly kind: "success" | "error"; readonly text: string } | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPlacement, setModelMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [activeModelIndex, setActiveModelIndex] = useState(0);
  const modelRequestIdRef = useRef(0);
  const focusModelAfterFetchRef = useRef(false);
  const currentModelRef = useRef(model);
  currentModelRef.current = model;
  const activeModel = models[activeModelIndex] ?? models[0];

  useEffect(() => {
    modelRequestIdRef.current += 1;
    setModels([]);
    setLoading(false);
    setMessage(null);
    setModelMenuOpen(false);
    setModelMenuPlacement("bottom");
    setActiveModelIndex(0);
    focusModelAfterFetchRef.current = false;
  }, [baseUrl, apiKey]);

  useEffect(() => () => {
    modelRequestIdRef.current += 1;
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return;
      if (modelControlRef.current?.contains(event.target)) return;
      setModelMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [modelMenuOpen]);

  useLayoutEffect(() => {
    if (!modelMenuOpen) return undefined;
    const updatePlacement = () => {
      const control = modelControlRef.current;
      const menu = modelMenuRef.current;
      if (!control || !menu) return;
      const controlRect = control.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const spaceBelow = window.innerHeight - controlRect.bottom;
      const spaceAbove = controlRect.top;
      setModelMenuPlacement(spaceBelow < menuHeight && spaceAbove > spaceBelow ? "top" : "bottom");
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    document.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      document.removeEventListener("scroll", updatePlacement, true);
    };
  }, [modelMenuOpen, models]);

  useEffect(() => {
    if (!modelMenuOpen || !focusModelAfterFetchRef.current) return;
    focusModelAfterFetchRef.current = false;
    modelInputRef.current?.focus();
  }, [modelMenuOpen, models]);

  useEffect(() => {
    if (!modelMenuOpen || !activeModel) return;
    document.getElementById(`${modelListboxId}-${activeModelIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeModel, activeModelIndex, modelListboxId, modelMenuOpen]);

  const previewMockActive = isPreviewAiMockBaseUrl(baseUrl);

  function openModelMenu() {
    if (models.length === 0) return;
    const selectedIndex = models.indexOf(model);
    setActiveModelIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setModelMenuOpen(true);
  }

  function chooseModel(nextModel: string) {
    if (nextModel !== model) onModelChange(nextModel);
    setModelMenuOpen(false);
  }

  function handleModelKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (models.length === 0) {
      if (event.key === "Escape") setModelMenuOpen(false);
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!modelMenuOpen) openModelMenu();
        else setActiveModelIndex((current) => (current + 1) % models.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!modelMenuOpen) openModelMenu();
        else setActiveModelIndex((current) => (current - 1 + models.length) % models.length);
        break;
      case "Enter":
        if (modelMenuOpen && activeModel) {
          event.preventDefault();
          chooseModel(activeModel);
        }
        break;
      case "Escape":
        if (!modelMenuOpen) break;
        event.preventDefault();
        event.stopPropagation();
        setModelMenuOpen(false);
        break;
      case "Home":
        if (!modelMenuOpen) break;
        event.preventDefault();
        setActiveModelIndex(0);
        break;
      case "End":
        if (!modelMenuOpen) break;
        event.preventDefault();
        setActiveModelIndex(models.length - 1);
        break;
    }
  }

  function handleModelControlBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setModelMenuOpen(false);
  }

  const fetchModels = async () => {
    const requestId = ++modelRequestIdRef.current;
    setLoading(true);
    setMessage(null);
    try {
      const result = await listOpenAiCompatibleModels(baseUrl, apiKey);
      if (requestId !== modelRequestIdRef.current) return;
      const nextModels = result.models;
      setModels(nextModels);
      setActiveModelIndex(Math.max(0, nextModels.indexOf(currentModelRef.current)));
      focusModelAfterFetchRef.current = nextModels.length > 0;
      setModelMenuOpen(nextModels.length > 0);
      setMessage(nextModels.length > 0
        ? {
            kind: "success",
            text: result.totalCount > nextModels.length
              ? t("settings.ai.modelsFoundLimited", { count: nextModels.length, total: result.totalCount })
              : t("settings.ai.modelsFound", { count: nextModels.length }),
          }
        : { kind: "error", text: t("settings.ai.noModelsFound") });
    } catch (error) {
      if (requestId !== modelRequestIdRef.current) return;
      setMessage({ kind: "error", text: modelFetchErrorMessage(error, t) });
    } finally {
      if (requestId === modelRequestIdRef.current) setLoading(false);
    }
  };

  return (
    <div
      className="ai-setup-detail ai-setup-detail--custom ai-setup-detail--custom-endpoint"
      role="group"
      aria-label={t("settings.ai.customEndpointSettingsAria")}
    >
      <div className="ai-setup-custom-endpoint__header">
        <div className="ai-setup-custom-endpoint__title">
          <strong>{t("settings.ai.customEndpoint")}</strong>
          {previewMockActive ? <span className="ai-setup-preview-mock-badge">{t("settings.ai.previewMock")}</span> : null}
        </div>
        <span>
          {t("settings.ai.customEndpointDescription", {
            partner: sharingPartner === "classification" ? t("settings.ai.classification") : t("settings.ai.intelligence"),
          })}
        </span>
      </div>
      <div className="ai-setup-custom-fields">
        <label className="ai-setup-field ai-setup-custom-field ai-setup-custom-field--base-url">
          <span>{t("settings.ai.baseUrl")}</span>
          <input
            className="settings-input"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={baseUrlAriaLabel}
            value={baseUrl}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder="http://localhost:11434/v1"
          />
        </label>
        <label className="ai-setup-field ai-setup-custom-field ai-setup-custom-field--api-key">
          <span>{t("settings.ai.apiKeyOptional")}</span>
          <input
            className="settings-input"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={apiKeyAriaLabel}
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder="sk-..."
          />
        </label>
        <div className="ai-setup-custom-field ai-setup-connection-actions">
          <button
            type="button"
            className="settings-btn ai-setup-model-fetch ai-setup-connection-actions__fetch"
            disabled={loading || !baseUrl.trim()}
            onClick={() => void fetchModels()}
          >
            {loading ? t("settings.ai.fetchingModels") : t("settings.ai.fetchModels")}
          </button>
          {message ? (
            <span className={`ai-setup-model-discovery-message is-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </span>
          ) : (
            <span className="ai-setup-connection-actions__hint">{t("settings.ai.fetchModelsHint")}</span>
          )}
        </div>
        <div className="ai-setup-field ai-setup-custom-field ai-setup-custom-field--model ai-setup-model-field">
          <label htmlFor={modelControlId}>{t("settings.ai.model")}</label>
          <div
            ref={modelControlRef}
            className="settings-select-control ai-setup-model-control"
            data-open={modelMenuOpen ? "true" : undefined}
            data-menu-placement={modelMenuOpen ? modelMenuPlacement : undefined}
            onBlur={handleModelControlBlur}
          >
            <div className="ai-setup-model-control__input-shell">
              <input
                ref={modelInputRef}
                id={modelControlId}
                className="settings-input ai-setup-model-control__input"
                role="combobox"
                aria-label={modelAriaLabel}
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                aria-controls={modelListboxId}
                aria-activedescendant={modelMenuOpen && activeModel ? `${modelListboxId}-${activeModelIndex}` : undefined}
                value={model}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => {
                  onModelChange(event.target.value);
                  setActiveModelIndex(0);
                  setModelMenuOpen(models.length > 0);
                }}
                onFocus={() => {
                  if (models.length > 0) openModelMenu();
                }}
                onKeyDown={handleModelKeyDown}
                placeholder="llama3.2"
              />
              <button
                type="button"
                className="ai-setup-model-control__toggle"
                aria-label={t("settings.ai.availableModelsAria")}
                title={t("settings.ai.availableModelsAria")}
                aria-expanded={modelMenuOpen}
                aria-controls={modelListboxId}
                disabled={models.length === 0}
                onClick={() => (modelMenuOpen ? setModelMenuOpen(false) : openModelMenu())}
              >
                <span className="settings-select-control__chevron" aria-hidden="true" />
              </button>
            </div>
            {modelMenuOpen && models.length > 0 ? (
              <div ref={modelMenuRef} className="settings-select-control__menu" id={modelListboxId} role="listbox" aria-label={t("settings.ai.availableModelsAria")}>
                {models.map((modelId, index) => {
                  const selected = modelId === model;
                  const active = index === activeModelIndex;
                  return (
                    <div key={modelId} className="settings-select-control__option-row">
                      <button
                        id={`${modelListboxId}-${index}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        tabIndex={-1}
                        className={`settings-select-control__option${selected ? " is-selected" : ""}${active ? " is-active" : ""}`}
                        onClick={() => chooseModel(modelId)}
                        onMouseEnter={() => setActiveModelIndex(index)}
                      >
                        <span className="settings-select-control__option-label">{modelId}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

type TranslationFunction = ReturnType<typeof useLocalization>["t"];

function modelFetchErrorMessage(error: unknown, t: TranslationFunction): string {
  if (!(error instanceof OpenAiCompatibleModelListError)) return t("settings.ai.modelFetchRequestFailed");
  switch (error.code) {
    case "base-url-required":
      return t("settings.ai.modelFetchBaseUrlRequired");
    case "invalid-base-url":
    case "unsupported-protocol":
      return t("settings.ai.modelFetchInvalidUrl");
    case "request-failed":
      return t("settings.ai.modelFetchRequestFailed");
    case "http":
      if (error.status === 401 || error.status === 403) {
        return t("settings.ai.modelFetchAuthFailed", { status: error.status });
      }
      return t("settings.ai.modelFetchHttpFailed", { status: error.status ?? 0 });
    case "invalid-json":
      return t("settings.ai.modelFetchInvalidJson");
    case "incompatible-response":
      return t("settings.ai.modelFetchIncompatibleResponse");
    default:
      return t("settings.ai.modelFetchRequestFailed");
  }
}
