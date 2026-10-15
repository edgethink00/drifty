// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMemorySuggestionScope } from "./useMemorySuggestionScope";
import type { MemorySuggestionProvider } from "../classification/memorySuggestionJob";

it("invalidates an earlier A generation after A → B → A and on unmount", () => {
  const {result, rerender, unmount} = renderHook(({ownerId}) => useMemorySuggestionScope(ownerId, {kind: "cloud"}), {initialProps: {ownerId: "a"}});
  const old = result.current;
  expect(old()).toBe(true);
  rerender({ownerId: "b"});
  expect(old()).toBe(false);
  rerender({ownerId: "a"});
  expect(old()).toBe(false);
  const current = result.current;
  expect(current()).toBe(true);
  unmount();
  expect(current()).toBe(false);
});

it("keeps equivalent config active but cancels a changed endpoint or disabled route", () => {
  const provider: MemorySuggestionProvider = {kind: "local", provider: {provider: "self_hosted", model: "m", baseUrl: "http://127.0.0.1:1"}};
  const {result, rerender} = renderHook(({provider, enabled}) => useMemorySuggestionScope("a", provider, enabled), {initialProps: {provider, enabled: true}});
  const old = result.current;
  rerender({provider: {...provider}, enabled: true});
  expect(old()).toBe(true);
  rerender({provider: {kind: "local", provider: {provider: "self_hosted", model: "m", baseUrl: "http://127.0.0.1:2"}}, enabled: true});
  expect(old()).toBe(false);
  const changed = result.current;
  rerender({provider, enabled: false});
  expect(changed()).toBe(false);
  expect(result.current()).toBe(false);
});
