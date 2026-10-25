// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEAM_BOARD_GRIDS, createTeamBoard, deleteTeamBoard, updateTeamBoard, type TeamBoardItem } from "./teamBoardModel";
import type { TeamServerBoard } from "./teamSharingService";
import { useTeamBoardsStore, type TeamBoardsRemote } from "./useTeamBoardsStore";

const grid = TEAM_BOARD_GRIDS.calibrated;
const KEY = "drifty.teamBoards.v1:calibrated:org-1";
const item: TeamBoardItem = { key: "rank-1", widget: "projectRank", size: "2x2" };

function serverRow(overrides: Partial<TeamServerBoard>): TeamServerBoard {
  return { dashboard_id: "srv-1", name: null, seq: 1, visibility: "me", grid: "calibrated", items: [], is_own: true, owner_member_key: "k-me", updated_at: null, ...overrides };
}

function fakeRemote(rows: TeamServerBoard[]) {
  let next = 10;
  const remote = {
    load: vi.fn(async () => ({ success: true as const, error: null, data: rows })),
    save: vi.fn(async (board: { readonly dashboard_id: string | null }) => ({ success: true as const, error: null, data: { dashboard_id: board.dashboard_id ?? "srv-" + String(next++) } })),
    remove: vi.fn(async () => ({ success: true as const, error: null, data: { deleted_count: 1 } })),
  };
  return remote;
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe("useTeamBoardsStore", () => {
  it("opens with the leader's boards from the server and keeps other leaders' shared boards apart", async () => {
    const remote = fakeRemote([
      serverRow({ dashboard_id: "srv-1", name: "Weekly" }),
      serverRow({ dashboard_id: "srv-2", is_own: false, visibility: "leaders", owner_member_key: "k-mina" }),
    ]);
    const { result } = renderHook(() => useTeamBoardsStore(KEY, grid, remote as TeamBoardsRemote));
    await waitFor(() => expect(result.current.sync).toBe("idle"));
    expect(result.current.state.boards.map((board) => [board.id, board.name])).toEqual([["srv-1", "Weekly"]]);
    expect(result.current.shared.map((board) => [board.id, board.ownerMemberKey])).toEqual([["srv-2", "k-mina"]]);
    expect(remote.save).not.toHaveBeenCalled();
  });

  it("saves a new board once, keeps the id the screen gave it, and updates and deletes it by the server's id", async () => {
    const remote = fakeRemote([]);
    const { result } = renderHook(() => useTeamBoardsStore(KEY, grid, remote as TeamBoardsRemote));
    await waitFor(() => expect(result.current.sync).toBe("idle"));

    const created = createTeamBoard(result.current.state, [item], 1000);
    const localId = created.active!;
    act(() => result.current.save(created));
    await settle();
    await waitFor(() => expect(result.current.sync).toBe("idle"));
    expect(remote.save).toHaveBeenCalledTimes(1);
    expect(remote.save.mock.calls[0]![0]).toMatchObject({ dashboard_id: null, seq: 1, visibility: "me", grid: "calibrated" });
    expect(result.current.state.active).toBe(localId);

    act(() => result.current.save(updateTeamBoard(result.current.state, localId, (board) => ({ ...board, name: "Mine", visibility: "leaders" }))));
    await settle();
    await waitFor(() => expect(remote.save).toHaveBeenCalledTimes(2));
    expect(remote.save.mock.calls[1]![0]).toMatchObject({ dashboard_id: "srv-10", name: "Mine", visibility: "leaders" });

    // Opening another board changes nothing on the server.
    act(() => result.current.save({ ...result.current.state, active: null }));
    await settle();
    expect(remote.save).toHaveBeenCalledTimes(2);

    act(() => result.current.save(deleteTeamBoard(result.current.state, localId)));
    await settle();
    await waitFor(() => expect(remote.remove).toHaveBeenCalledWith("srv-10"));
  });

  it("keeps a change that failed to save and sends it again on retry", async () => {
    const remote = fakeRemote([]);
    remote.save.mockResolvedValueOnce({ success: false, error: "offline", reason: "network" } as never);
    const { result } = renderHook(() => useTeamBoardsStore(KEY, grid, remote as TeamBoardsRemote));
    await waitFor(() => expect(result.current.sync).toBe("idle"));
    act(() => result.current.save(createTeamBoard(result.current.state, [item], 2000)));
    await settle();
    await waitFor(() => expect(result.current.sync).toBe("error"));
    expect(result.current.state.boards).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).boards).toHaveLength(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.sync).toBe("idle"));
    expect(remote.save).toHaveBeenCalledTimes(2);
    expect(remote.save.mock.calls[1]![0]).toMatchObject({ dashboard_id: null });
  });

  it("saves, on the next opening, a board made here that never reached the server", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ boards: [{ id: "board-5", seq: 1, name: null, visibility: "me", items: [] }], active: "board-5" }));
    const remote = fakeRemote([]);
    const { result } = renderHook(() => useTeamBoardsStore(KEY, grid, remote as TeamBoardsRemote));
    await waitFor(() => expect(remote.save).toHaveBeenCalledTimes(1));
    expect(result.current.state.active).toBe("board-5");
  });

  it("keeps the preview's boards on this device without a server", () => {
    const key = "drifty.dev.teamBoards.v4:calibrated:org-1";
    const { result } = renderHook(() => useTeamBoardsStore(key, grid, null));
    act(() => result.current.save(createTeamBoard(result.current.state, [item], 3000)));
    expect(result.current.sync).toBe("idle");
    expect(JSON.parse(window.localStorage.getItem(key)!).boards).toHaveLength(1);
  });
});

