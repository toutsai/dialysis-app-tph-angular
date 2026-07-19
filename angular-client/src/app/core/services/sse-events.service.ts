// src/app/core/services/sse-events.service.ts
// 全域 SSE 事件服務：單一 EventSource 供全 app 消費（取代各頁面各自開連線）。
//
// 端點不變：GET /api/events/exceptions?token=<jwt>
// 具名事件：
//   - hello            {userId}                                          連線確認
//   - exception        {action, exception, ts}                           調班/例外異動（格式不變）
//   - schedule-saved   {kind:'schedule'|'teams'|'both', date, savedBy, scheduleVersion, teamsVersion, ts}
//
// 連線生命週期跟隨 AuthService.currentUser()：登入(含 session 恢復)建立連線、登出/被踢關閉連線。
// 重連策略：
//   - 瀏覽器原生 EventSource 對「網路型」錯誤會自動重試；onopen 視為恢復。
//   - 若連線被瀏覽器判定為徹底關閉（readyState === CLOSED，例如 token 失效的 4xx），
//     原生不會再重試，改由此服務用遞增退避（1s -> 2s -> 4s ... 上限 60s）手動重建。
// 對外只提供訂閱介面（RxJS Subject），不外洩 EventSource 實例。
import { Injectable, inject, effect, untracked, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { ApiConfigService } from './api-config.service';
import { AuthService } from './auth.service';

export interface ScheduleSavedPayload {
  kind: 'schedule' | 'teams' | 'both';
  date: string;
  savedBy: { uid: string; name: string } | null;
  scheduleVersion?: number;
  teamsVersion?: number;
  ts?: string;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;

@Injectable({ providedIn: 'root' })
export class SseEventsService implements OnDestroy {
  private readonly apiConfig = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  private readonly exceptionSubject = new Subject<any>();
  private readonly scheduleSavedSubject = new Subject<ScheduleSavedPayload>();
  private readonly connectionRestoredSubject = new Subject<void>();

  /** 例外/調班事件（payload 格式與舊版逐字相同：JSON.parse(event.data) 失敗則為 null） */
  readonly exception$: Observable<any> = this.exceptionSubject.asObservable();
  /** 排程/護理分組存檔推播 */
  readonly scheduleSaved$: Observable<ScheduleSavedPayload> = this.scheduleSavedSubject.asObservable();
  /** 斷線後重新恢復連線時觸發一次（供消費端決定是否要防呆重新整理一次） */
  readonly connectionRestored$: Observable<void> = this.connectionRestoredSubject.asObservable();

  private es: EventSource | null = null;
  private currentToken: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private wasDisconnected = false;

  constructor() {
    // 跟隨登入狀態：登入/恢復 session 建立連線；登出/被踢關閉連線並清退避狀態。
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        if (user) {
          this.connect();
        } else {
          this.disconnect();
        }
      });
    });
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private connect(): void {
    const token = this.apiConfig.getToken();
    if (!token || typeof EventSource === 'undefined') {
      this.disconnect();
      return;
    }
    if (this.es && this.currentToken === token) return; // 已是相同 token 的連線

    this.teardownSocket();
    this.currentToken = token;

    try {
      const es = new EventSource(`/api/events/exceptions?token=${encodeURIComponent(token)}`);
      this.es = es;

      es.addEventListener('hello', () => {
        this.onConnected();
      });

      es.addEventListener('exception', (event: MessageEvent) => {
        this.onConnected();
        let payload: any = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          payload = null;
        }
        this.exceptionSubject.next(payload);
      });

      es.addEventListener('schedule-saved', (event: MessageEvent) => {
        this.onConnected();
        try {
          const payload = JSON.parse(event.data);
          if (payload) this.scheduleSavedSubject.next(payload);
        } catch {
          // 忽略無法解析的推播
        }
      });

      es.onopen = () => this.onConnected();

      es.onerror = () => {
        this.wasDisconnected = true;
        if (es.readyState === EventSource.CLOSED) {
          // 原生不會再重試（例如 token 失效），改手動退避重建
          this.teardownSocket();
          this.scheduleReconnect();
        }
        // 否則交給瀏覽器原生重連，之後 onopen 會再觸發 onConnected()
      };
    } catch (error) {
      console.warn('[SSE] init failed:', error);
      this.scheduleReconnect();
    }
  }

  private onConnected(): void {
    this.reconnectDelay = RECONNECT_BASE_MS;
    if (this.wasDisconnected) {
      this.wasDisconnected = false;
      this.connectionRestoredSubject.next();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  private teardownSocket(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.currentToken = null;
    this.reconnectDelay = RECONNECT_BASE_MS;
    this.wasDisconnected = false;
  }
}
