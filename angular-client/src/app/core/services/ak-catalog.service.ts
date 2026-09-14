// AK（人工腎臟）品項目錄：品項設定（inventory_items / artificialKidney）+ 別名表，品項設定為唯一權威。
// 透析醫囑視窗 / 藥物調整 / 交辦的 AK 下拉、排程推估引擎的品名對照都從這裡拿，
// 不再各自寫死清單（2026-09-15 統合）。
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from './api-config.service';
import { buildItemNameResolver, type ItemNameResolver } from '@/utils/inventoryItemName';

export interface AkCatalogItem {
  id: string;
  name: string;
  unitsPerBox: number | null;
}

@Injectable({ providedIn: 'root' })
export class AkCatalogService {
  private readonly api = inject(ApiConfigService);

  /** 品項設定的正式 AK 品名（品項設定順序） */
  readonly names = signal<string[]>([]);
  readonly items = signal<AkCatalogItem[]>([]);
  readonly loaded = signal(false);

  private resolver: ItemNameResolver = buildItemNameResolver([]);
  private inflight: Promise<void> | null = null;
  private loadedAt = 0;
  /** 書記在品項設定新增品項後，別的頁面 5 分鐘內重開視窗也拿得到新品項 */
  private readonly TTL_MS = 5 * 60 * 1000;

  /** 載入（或沿用快取）；失敗不丟錯，讓下拉至少能顯示現值 */
  async ensureLoaded(force = false): Promise<void> {
    if (!force && this.loaded() && Date.now() - this.loadedAt < this.TTL_MS) return;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const res = await fetch(`${this.api.apiBaseUrl}/orders/ak-catalog`, { headers: this.api.getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items: AkCatalogItem[] = Array.isArray(data?.items) ? data.items : [];
        const aliases: Record<string, string> = data?.aliases && typeof data.aliases === 'object' ? data.aliases : {};
        this.items.set(items);
        this.names.set(items.map((i) => i.name));
        this.resolver = buildItemNameResolver(this.names(), aliases);
        this.loaded.set(true);
        this.loadedAt = Date.now();
      } catch (error) {
        console.warn('[AkCatalog] 載入 AK 品項目錄失敗:', error);
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  invalidate(): void {
    this.loadedAt = 0;
  }

  /** 上傳/醫囑品名 → 品項設定正式名；對不上回 null */
  resolve(raw: string | null | undefined): string | null {
    return this.resolver.resolve(raw);
  }

  /** 是否為品項設定裡的正式名（完全相同） */
  isCanonical(name: string | null | undefined): boolean {
    return this.resolver.isCanonical(name);
  }

  /**
   * 下拉選項：品項設定全部 + 現值裡不在清單的（舊拼法，標示未設定品項），避免下拉顯示空白。
   * 回傳 [{ value, label, unregistered }]
   */
  optionsWithCurrent(current: readonly string[]): { value: string; label: string; unregistered: boolean }[] {
    const options = this.names().map((name) => ({ value: name, label: name, unregistered: false }));
    const seen = new Set(this.names());
    for (const v of current) {
      const value = String(v ?? '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: `${value}（未設定品項）`, unregistered: true });
    }
    return options;
  }
}
