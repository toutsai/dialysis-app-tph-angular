// src/utils/versionConflict.ts
// 排程/護理分組存檔樂觀鎖：409 VERSION_CONFLICT 共用判讀邏輯。
//
// 存檔呼叫走兩種不同的傳輸層，錯誤物件形狀不同，這裡統一判讀：
// - fetch-based ApiRequestError（services/localApiClient.ts）：body 在 error.body
// - Angular HttpClient 的 HttpErrorResponse：body 在 error.error
// 用 duck typing 而非 instanceof，避免這個純工具檔耦合到特定 HTTP client 型別。

export interface VersionConflictInfo {
  currentVersion?: number;
  scheduleCurrentVersion?: number;
  teamsCurrentVersion?: number;
  lastModifiedBy?: { uid?: string; name?: string } | null;
  updatedAt?: string;
}

/** 從 catch 到的 error 判讀是否為後端回的 409 { error:true, code:'VERSION_CONFLICT', ... }。非此情況回 null。 */
export function extractVersionConflict(error: unknown): VersionConflictInfo | null {
  const err = error as any;
  if (!err || err.status !== 409) return null;
  const body = err.body ?? err.error;
  if (!body || body.code !== 'VERSION_CONFLICT') return null;
  return {
    currentVersion: body.currentVersion,
    scheduleCurrentVersion: body.scheduleCurrentVersion,
    teamsCurrentVersion: body.teamsCurrentVersion,
    lastModifiedBy: body.lastModifiedBy ?? null,
    updatedAt: body.updatedAt,
  };
}

/** 組版本衝突對話框內文：「此排程已被 {name} 於 {HH:mm} 更新。直接儲存會覆蓋對方的變更。」 */
export function formatVersionConflictMessage(info: VersionConflictInfo): string {
  const name = info.lastModifiedBy?.name || '系統';
  let timeSuffix = '';
  if (info.updatedAt) {
    const d = new Date(info.updatedAt);
    if (!isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      timeSuffix = ` 於 ${hh}:${mm}`;
    }
  }
  return `此排程已被 ${name}${timeSuffix} 更新。直接儲存會覆蓋對方的變更。`;
}
