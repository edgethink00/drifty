import { useState } from "react";

/**
 * The user's thumbs on a read, kept on this device by read id. Nothing is
 * sent anywhere; when weekly reads are generated, the next read's input can
 * say whether the last one was marked useful.
 */
export type ReadVote = "up" | "down";

const STORAGE_KEY = "drifty.read.votes.v1";

function storedVotes(): Record<string, ReadVote> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ReadVote] => entry[1] === "up" || entry[1] === "down"));
  } catch {
    return {};
  }
}

export function useReadVote(readId: string): readonly [ReadVote | null, (vote: ReadVote | null) => void] {
  const [vote, setVote] = useState<ReadVote | null>(() => storedVotes()[readId] ?? null);
  const update = (next: ReadVote | null) => {
    const all = storedVotes();
    if (next) all[readId] = next;
    else delete all[readId];
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Storage can be full or unavailable; the vote still shows for this visit.
    }
    setVote(next);
  };
  return [vote, update];
}
