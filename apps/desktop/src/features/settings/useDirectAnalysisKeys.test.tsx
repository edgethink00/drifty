// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDirectAnalysisKeys } from "./useDirectAnalysisKeys";
import { DirectProviderConnectionFields } from "./DirectProviderConnectionFields";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
const native = vi.hoisted(() => ({ locked: false, denied: false, saved: {openai:"synthetic-original",anthropic:"synthetic-original"} as Record<string,string|null>, calls: [] as {command:string,value?:string|null}[], hold: null as null|(()=>Promise<void>) }));
vi.mock("@tauri-apps/api/core", () => ({invoke:vi.fn(async(command:string,args:{provider:string,value?:string|null})=>{
 native.calls.push({command,value:args.value});
 if(command.endsWith("recover_api_key")){
  if(native.hold) await native.hold();
  if(native.denied)throw Error("synthetic denied");
  if(typeof args.value==="string")native.saved[args.provider]=args.value||null;
  return native.saved[args.provider];
 }
 if(native.locked)throw Error("synthetic locked");
 if(command.endsWith("load_api_key"))return native.saved[args.provider];
 if(command.endsWith("save_api_key")){
  if(native.hold)await native.hold();
  native.saved[args.provider]=args.value||null;
 }
})}));
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function load(view:ReturnType<typeof renderHook<ReturnType<typeof useDirectAnalysisKeys>,unknown>>,provider:"openai"|"anthropic"){
 await act(async()=>{await view.result.current.load(provider);});
 await advance(0);
}
beforeEach(()=>{vi.useFakeTimers();Object.assign(native,{locked:false,denied:false,saved:{openai:"synthetic-original",anthropic:"synthetic-original"},calls:[],hold:null});vi.spyOn(console,"warn").mockImplementation(()=>{});});
afterEach(async()=>{cleanup();await act(async()=>{await Promise.resolve();});vi.restoreAllMocks();vi.useRealTimers();});
describe.each(["openai","anthropic"] as const)("%s quiet key recovery",provider=>{
 it("does not read either unused provider",async()=>{renderHook(()=>useDirectAnalysisKeys());await advance(35_000);expect(native.calls).toEqual([]);});
 it("recovers a failed initial read on focus without writing or requesting OS UI",async()=>{
  native.locked=true;const view=renderHook(()=>useDirectAnalysisKeys());await load(view,provider);
  expect(view.result.current.states[provider]).toBe("error");
  native.locked=false;act(()=>window.dispatchEvent(new Event("focus")));await advance(0);
  expect(view.result.current.keys[provider]).toBe("synthetic-original");expect(view.result.current.states[provider]).toBe("ready");
  expect(native.calls.map(x=>x.command)).toEqual(["analysis_provider_load_api_key","analysis_provider_load_api_key"]);
 });
 it("keeps the latest failed edit pending, retries after unlock and restores it after remount",async()=>{
  const view=renderHook(()=>useDirectAnalysisKeys());await load(view,provider);native.locked=true;
  act(()=>view.result.current.change(provider,"synthetic-first"));await advance(400);
  act(()=>view.result.current.change(provider,"synthetic-latest"));await advance(400);
  expect(view.result.current.states[provider]).toBe("error");expect(view.result.current.recoveries[provider].pending).toBe(true);
  native.locked=false;await advance(2_000);
  expect(native.saved[provider]).toBe("synthetic-latest");expect(view.result.current.recoveries[provider].pending).toBe(false);
  view.unmount();const next=renderHook(()=>useDirectAnalysisKeys());await load(next,provider);expect(next.result.current.keys[provider]).toBe("synthetic-latest");
  expect(native.calls.filter(x=>x.command.includes("recover"))).toHaveLength(0);
 });
 it("does not repeat interactive recovery after denial or unlock focus events",async()=>{
  native.locked=true;native.denied=true;const view=renderHook(()=>useDirectAnalysisKeys());await load(view,provider);
  await act(async()=>view.result.current.recoveries[provider].recover());
  act(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new Event("focus"));});await advance(65_000);
  expect(native.calls.filter(x=>x.command.includes("recover"))).toEqual([{command:"analysis_provider_recover_api_key",value:null}]);
  expect(native.saved[provider]).toBe("synthetic-original");
 });
 it("cannot replace a newer edit with a slow manual recovery, and saves a later clear last",async()=>{
  native.locked=true;const view=renderHook(()=>useDirectAnalysisKeys());await load(view,provider);
  let release=()=>{};native.hold=()=>new Promise<void>(resolve=>{release=resolve;});
  let recovery:Promise<void>;act(()=>{recovery=view.result.current.recoveries[provider].recover();});await advance(0);
  act(()=>view.result.current.change(provider,"synthetic-newer"));native.hold=null;native.locked=false;release();await act(async()=>recovery!);await advance(400);
  expect(view.result.current.keys[provider]).toBe("synthetic-newer");expect(native.saved[provider]).toBe("synthetic-newer");
  act(()=>view.result.current.change(provider,""));await advance(400);expect(native.saved[provider]).toBeNull();
 });
 it("flushes the final human edit on unmount, but never clears an unreadable empty field",async()=>{
  const view=renderHook(()=>useDirectAnalysisKeys());await load(view,provider);
  act(()=>view.result.current.change(provider,"synthetic-final"));view.unmount();await advance(0);
  expect(native.saved[provider]).toBe("synthetic-final");
  native.locked=true;const next=renderHook(()=>useDirectAnalysisKeys());await load(next,provider);const before=native.calls.length;next.unmount();await advance(35_000);
  expect(native.calls).toHaveLength(before);expect(native.saved[provider]).toBe("synthetic-final");
 });
 it("shows a masked unsaved field, and removes the notice after quiet recovery",async()=>{
  function Fixture(){const keys=useDirectAnalysisKeys();const loadKey=keys.load;useEffect(()=>{void loadKey(provider);},[loadKey]);return <LocalizationTestProvider language="ko"><DirectProviderConnectionFields provider={provider} apiKey={keys.keys[provider]} model="test-model" defaultModel="test-model" suggestions={[]} datalistId="test-models" groupAriaLabel="provider" onApiKeyChange={value=>keys.change(provider,value)} onModelChange={()=>{}} credentialRecovery={keys.recoveries[provider]}/></LocalizationTestProvider>;}
  render(<Fixture/>);await advance(0);native.locked=true;
  const field=screen.getByLabelText(provider==="openai"?"OpenAI API 키":"Anthropic API 키") as HTMLInputElement;
  expect(field.type).toBe("password");fireEvent.change(field,{target:{value:"synthetic-latest"}});await advance(400);
  expect(screen.getByRole("alert").textContent).toContain("키 변경사항이 아직 저장되지 않았습니다.");
  native.locked=false;act(()=>window.dispatchEvent(new Event("focus")));await advance(0);
  expect(screen.queryByRole("alert")).toBeNull();expect(screen.queryByRole("button",{name:"키 접근 허용"})).toBeNull();
 });
});
