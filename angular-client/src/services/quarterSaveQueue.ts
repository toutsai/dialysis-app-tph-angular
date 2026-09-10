import { saveQuarterRecord } from './kiditQuarterInputService';

type Payload = Parameters<typeof saveQuarterRecord>[2] & { hdrx?: unknown; hosp?: unknown };
type Draft = { quarter: string; patientId: string; data: Payload; revision: number };
type State = '' | 'saving' | 'saved' | 'error';

/** One serial writer per form, shared across tab destruction/recreation. Drafts live
 * only in this browser session and are cleared with the normal logout cleanup. */
export class QuarterSaveQueue {
  private drafts = new Map<string, Draft>();
  private revision = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: State = '';
  private listener: ((state: State) => void) | null = null;
  private readonly token = sessionStorage.getItem('auth_token');
  private readonly storageKey: string;

  constructor(scope: string, private readonly write = saveQuarterRecord) {
    const user = JSON.parse(sessionStorage.getItem('auth_user') || '{}');
    this.storageKey = `kidit-drafts:${encodeURIComponent(String(user.id || user.uid || 'session'))}:${scope}`;
    try {
      for (const draft of JSON.parse(sessionStorage.getItem(this.storageKey) || '[]') as Draft[]) {
        this.drafts.set(this.key(draft.quarter, draft.patientId), draft);
        this.revision = Math.max(this.revision, draft.revision);
      }
      if (this.drafts.size) this.state = 'error';
    } catch { this.state = 'error'; }
  }

  hasPending(): boolean { return this.drafts.size > 0; }
  isCurrentSession(): boolean { return this.token === sessionStorage.getItem('auth_token'); }
  listen(listener: ((state: State) => void) | null): void {
    this.listener = listener;
    listener?.(this.state);
  }
  private key(quarter: string, patientId: string): string { return `${quarter}:${patientId}`; }
  private publish(state: State): void { this.state = state; this.listener?.(state); }
  private persist(): void {
    if (!this.isCurrentSession()) return;
    sessionStorage.setItem(this.storageKey, JSON.stringify([...this.drafts.values()]));
  }
  get(quarter: string, patientId: string): Payload | undefined {
    const data = this.drafts.get(this.key(quarter, patientId))?.data;
    return data ? structuredClone(data) : undefined;
  }
  enqueue(quarter: string, patientId: string, data: Payload): void {
    if (!this.isCurrentSession()) return;
    this.drafts.set(this.key(quarter, patientId), {
      quarter, patientId, data: structuredClone(data), revision: ++this.revision,
    });
    try { this.persist(); } catch { this.publish('error'); }
    this.publish('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 800);
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.running;
  }
  private async drain(): Promise<void> {
    if (!this.drafts.size) return;
    this.publish('saving');
    try {
      while (this.drafts.size && this.isCurrentSession()) {
        const [key, draft] = this.drafts.entries().next().value!;
        await this.write(draft.quarter, draft.patientId, structuredClone(draft.data));
        if (!this.isCurrentSession()) return;
        // An acknowledgement applies only to the revision that was sent.
        if (this.drafts.get(key)?.revision === draft.revision) this.drafts.delete(key);
        this.persist();
      }
      if (this.isCurrentSession()) this.publish('saved');
    } catch (error) {
      console.error('季度資料儲存失敗，草稿已保留供重試:', error);
      this.publish('error');
    }
  }
}

const queues = new Map<string, QuarterSaveQueue>();
export function quarterSaveQueue(scope: string): QuarterSaveQueue {
  let queue = queues.get(scope);
  if (!queue || !queue.isCurrentSession()) {
    queue = new QuarterSaveQueue(scope);
    queues.set(scope, queue);
  }
  return queue;
}
