type Priority = "classification" | "analysis";
type Pending = { priority: Priority; run: () => Promise<void>; expire: () => void };

/** One runtime slot. Priorities apply at admission, never to an active generation. */
export class ManagedLocalAiQueue {
  private active = false;
  private pending: Pending[] = [];

  run<T>(priority: Priority, current: () => boolean, task: () => Promise<T>, waitMs = 120_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = {
        priority,
        expire: () => {
          this.pending = this.pending.filter(item => item !== entry);
          reject(new Error("Local AI is busy. Try again in a moment."));
        },
        run: async () => {
          clearTimeout(timer);
          try {
            if (!current()) throw new Error("AI request cancelled before sending.");
            const result = await task();
            if (!current()) throw new Error("AI settings changed during the request.");
            resolve(result);
          } catch (error) { reject(error); }
        },
      };
      const timer = setTimeout(entry.expire, waitMs);
      this.pending.push(entry);
      this.drain();
    });
  }

  private drain(): void {
    if (this.active) return;
    const urgent = this.pending.findIndex(item => item.priority === "classification");
    const [next] = this.pending.splice(urgent < 0 ? 0 : urgent, 1);
    if (!next) return;
    this.active = true;
    void next.run().finally(() => { this.active = false; this.drain(); });
  }
}

export const managedLocalAiQueue = new ManagedLocalAiQueue();
