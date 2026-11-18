// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAiSetupController } from './useAiSetupController';
import { useAnalysisModelSetup } from './useAnalysisModelSetup';
const native = vi.hoisted(() => ({ locked: true, reads: 0, writes: 0, recoveries: 0, saved: 'synthetic-existing-key' as string | null, holdWrite: null as null | (() => Promise<void>) }));
const probe = vi.hoisted(() => ({ paused: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async (command: string) => {
  if (command.endsWith('recover_api_key')) {
    native.recoveries++;
    return native.saved;
  }
  if (command.endsWith('load_api_key')) {
    native.reads++;
    if (native.locked) throw new Error('synthetic locked store');
    return native.saved;
  }
  if (command.endsWith('save_api_key') || command.endsWith('clear_api_key')) {
    native.writes++;
    if (native.holdWrite) await native.holdWrite();
    if (native.locked) throw new Error('synthetic locked store');
    if (command.endsWith('clear_api_key')) native.saved = null;
  }
  return null;
}) }));
vi.mock('./useAiConnectionTestRunner', () => ({useAiConnectionTestRunner: (options: { autoTestPaused: boolean }) => { probe.paused = options.autoTestPaused; return ({result: null, running: false, runningFingerprint: null, clearResult: () => {}, run: async () => {}, runAuto: async () => {}}); }}));
vi.mock('./managedLocalAiClient', () => ({getManagedLocalAiStatus: async () => {throw new Error('not used');}}));
beforeEach(() => {
  Object.assign(native, {locked: true, reads: 0, writes: 0, recoveries: 0, saved: 'synthetic-existing-key', holdWrite: null});
  window.localStorage.clear();
  window.localStorage.setItem('drifty.aiSetup.v1', JSON.stringify({provider:'openrouter_byok'}));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});
function mount() {
  return renderHook(() => {
    const connection = useAiSetupController();
    const analysis = useAnalysisModelSetup(false, connection.localAiSetup.provider, undefined, {
      ownerKey: 'synthetic-owner',
      cloudFallbackAllowed: false,
      cloudReady: false,
      liveSetup: connection.localAiSetup,
      openRouterCredentialState: connection.openRouterCredentialState,
      retryOpenRouterKeyRead: connection.retryOpenRouterKeyRead,
    });
    return { connection, analysis };
  });
}
async function unlock(view: ReturnType<typeof mount>) {
  await waitFor(() => expect(view.result.current.connection.providerCredentials.openrouter_byok.state).toBe('error'));
  await act(async () => { await Promise.resolve(); });
  native.locked = false;
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(view.result.current.connection.providerCredentials.openrouter_byok.state).toBe('ready'));
  await act(async () => {await new Promise(resolve => setTimeout(resolve,450));});
}
it('automatically restores Intelligence when the shared OpenRouter key recovers', async () => {
  const view = mount();
  await unlock(view);
  expect(view.result.current.analysis.analysisConnected).toBe(true);
});
it('keeps card reopening and analysis use free of extra native reads after recovery', async () => {
  const view = mount();
  await unlock(view);
  expect(view.result.current.analysis.analysisConnected).toBe(true);
  const reads = native.reads;
  act(() => view.result.current.analysis.onProviderVisible('openrouter'));
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  expect(await view.result.current.analysis.resolveOpenRouterKey()).toBe(native.saved);
  expect(native.reads).toBe(reads);
  expect(native.recoveries).toBe(0);
  expect(native.writes).toBe(0);
});

it('shares a successful explicit recovery without another denied quiet read', async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.connection.openRouterCredentialState).toBe('error'));
  const reads = native.reads;
  await act(async () => view.result.current.connection.providerCredentials.openrouter_byok.recover());
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  expect(await view.result.current.analysis.resolveOpenRouterKey()).toBe(native.saved);
  expect(native.reads).toBe(reads);
  expect(native.recoveries).toBe(1);
  expect(native.writes).toBe(0);
});
it('restores an explicit Intelligence OpenRouter override while Classification stays local', async () => {
  native.locked = false;
  window.localStorage.setItem('drifty.aiSetup.v1',JSON.stringify({provider:'managed_local',driftyRoute:'local'}));
  window.localStorage.setItem('drifty.analysisAiSetup.v1',JSON.stringify({provider:'openrouter',selectionSource:'manual'}));
  const view = mount();
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  expect(view.result.current.connection.localAiSetup.provider).toBe('managed_local');
  expect(view.result.current.analysis.analysisSetup.provider).toBe('openrouter');
  expect(native.reads).toBe(1);
  expect(native.writes).toBe(0);
});
it('propagates a clear to Intelligence without reusing the previously restored key', async () => {
  native.locked = false;
  const view = mount();
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  act(() => view.result.current.connection.setLocalAiSetup(current=>({...current,openRouterApiKey:''})));
  await waitFor(() => expect(native.saved).toBeNull());
  expect(view.result.current.analysis.analysisConnected).toBe(false);
  expect(await view.result.current.analysis.resolveOpenRouterKey()).toBeNull();
  expect(view.result.current.analysis.openRouterConnected).toBe(false);
  expect(native.reads).toBe(1);
});

it('leaves the Keychain untouched when both consumers use local models', async () => {
  window.localStorage.setItem('drifty.aiSetup.v1', JSON.stringify({ provider: 'managed_local', driftyRoute: 'local' }));
  const view = mount();
  await act(async () => { await Promise.resolve(); });
  expect(view.result.current.analysis.analysisSetup.provider).toBe('managed_local');
  expect(native.reads).toBe(0);
  expect(native.writes).toBe(0);
  expect(native.recoveries).toBe(0);
});

function mountDirect(provider: "openai" | "anthropic") {
  window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({ provider }));
  return renderHook(() => {
    const connection = useAiSetupController();
    const analysis = useAnalysisModelSetup(false, provider, undefined, {
      ownerKey: "synthetic-owner", cloudFallbackAllowed: false, cloudReady: false,
      liveSetup: connection.localAiSetup,
    }, connection.directKeys);
    return { connection, analysis };
  });
}
it.each(["openai", "anthropic"] as const)("shares %s quiet recovery with Intelligence", async provider => {
  const view = mountDirect(provider);
  await waitFor(() => expect(view.result.current.connection.directKeys.states[provider]).toBe("error"));
  expect(view.result.current.analysis.analysisConnected).toBe(false);
  native.locked = false;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  expect(view.result.current.connection.directKeys.keys[provider]).toBe(native.saved);
  expect(native.reads).toBe(2);
  expect(native.writes).toBe(0);
  expect(native.recoveries).toBe(0);
});
it.each(["openai", "anthropic"] as const)("shares %s explicit read recovery without another quiet read", async provider => {
  const view = mountDirect(provider);
  await waitFor(() => expect(view.result.current.connection.directKeys.states[provider]).toBe("error"));
  expect(view.result.current.analysis.analysisConnected).toBe(false);
  const reads = native.reads;
  await act(async () => view.result.current.connection.directKeys.recoveries[provider].recover());
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  expect(native.reads).toBe(reads);
  expect(native.writes).toBe(0);
  expect(native.recoveries).toBe(1);
});

it.each(["openai", "anthropic"] as const)("keeps the in-memory %s route usable while a human edit is unsaved", async provider => {
  native.locked = false;
  const view = mountDirect(provider);
  await waitFor(() => expect(view.result.current.analysis.analysisConnected).toBe(true));
  let finishWrite!: () => void;
  native.holdWrite = () => new Promise<void>(resolve => { finishWrite = resolve; });
  act(() => view.result.current.connection.directKeys.change(provider, "synthetic-unsaved-key"));
  await waitFor(() => expect(native.writes).toBe(1));
  const pausedDuringWrite = probe.paused;
  const connectedDuringWrite = view.result.current.analysis.analysisConnected;
  native.locked = true;
  native.holdWrite = null;
  await act(async () => finishWrite());
  await waitFor(() => expect(view.result.current.connection.directKeys.recoveries[provider].state).toBe("error"));
  expect(pausedDuringWrite).toBe(false);
  expect(connectedDuringWrite).toBe(true);
  expect(view.result.current.connection.directKeys.recoveries[provider].pending).toBe(true);
  expect(view.result.current.analysis.analysisConnected).toBe(true);
  expect(view.result.current.analysis.effectiveAnalysisSetup.provider).toBe(provider);
});
