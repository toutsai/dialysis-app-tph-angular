// 通用品項目錄（品項設定 inventory_items 任一類別），GET /orders/item-catalog?category=，登入即可讀。
// 交辦補帳視窗的 A液 / 其他耗材 下拉從這裡拿（2026-09-15：耗材選項改讀品項設定，不再寫死）。
// AK 有自己的 AkCatalogService（多了別名對照與「未設定品項」判定），這裡不重複那些功能。
import { Injectable, inject, signal } from '@angular/core';
import { ApiConfigService } from './api-config.service';

export interface InventoryCatalogItem {
  id: string;
  name: string;
  unitsPerBox: number | null;
}

interface CategoryCache {
  items: InventoryCatalogItem[];
  loadedAt: number;
  inflight: Promise<void> | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryCatalogService {
  private readonly api = inject(ApiConfigService);
  private readonly cache = new Map<string, CategoryCache>();
  /** 書記在品項設定新增品項後，5 分鐘內重開視窗也拿得到 */
  private readonly TTL_MS = 5 * 60 * 1000;
  /** 任一類別載入完成就 +1，讓模板/欄位有訊號可重算 */
  readonly revision = signal(0);

  /** 載入（或沿用快取）；失敗不丟錯，下拉至少不會卡住 */
  async ensureLoaded(category: string, force = false): Promise<void> {
    const entry = this.cache.get(category);
    if (entry && !force && Date.now() - entry.loadedAt < this.TTL_MS) return;
    if (entry?.inflight) return entry.inflight;
    const next: CategoryCache = entry ?? { items: [], loadedAt: 0, inflight: null };
    this.cache.set(category, next);
    next.inflight = (async () => {
      try {
        const res = await fetch(
          `${this.api.apiBaseUrl}/orders/item-catalog?category=${encodeURIComponent(category)}`,
          { headers: this.api.getHeaders() },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        next.items = Array.isArray(data?.items) ? data.items : [];
        next.loadedAt = Date.now();
        this.revision.update((v) => v + 1);
      } catch (error) {
        console.warn(`[InventoryCatalog] 載入品項目錄失敗 (${category}):`, error);
      } finally {
        next.inflight = null;
      }
    })();
    return next.inflight;
  }

  /** 品項設定的品名（品項設定順序）；未載入回空陣列 */
  names(category: string): string[] {
    return (this.cache.get(category)?.items ?? []).map((i) => i.name);
  }

  invalidate(category?: string): void {
    if (category) {
      const entry = this.cache.get(category);
      if (entry) entry.loadedAt = 0;
    } else {
      for (const entry of this.cache.values()) entry.loadedAt = 0;
    }
  }
}
