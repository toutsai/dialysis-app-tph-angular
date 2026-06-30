import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { localApi } from '@/services/localApiClient';
import { getToday } from '@/utils/dateUtils';
import { AuthService } from '@app/core/services/auth.service';

/** 簽核欄位：點選蓋章 = 當前使用者姓名 + 日期 */
interface SignOff {
  name: string;
  date: string; // YYYY-MM-DD
}

interface EducationSession {
  index: number;
  dialysisDate: string; // 透析日期
  topic: string; // 主題
  educatorSign: SignOff | null; // 衛教者/日期
  signature: string; // 被衛教者簽名（文字）
  returnDemoSign: SignOff | null; // 回示教日期/護理師
  passSign: SignOff | null; // 回示教通過日/主護簽章
}

type SignField = 'educatorSign' | 'returnDemoSign' | 'passSign';

/** 初透衛教主題預設 12 項（可由 site_config education_topics 覆蓋） */
const DEFAULT_EDUCATION_TOPICS = [
  '環境介紹/股靜脈導管置入術護理指導',
  '血液透析治療護理指導',
  '動靜脈瘻管護理指導',
  '洗腎病人水分攝取原則護理指導/體重控制注意事項護理指導',
  '高低血鉀症護理指導',
  '磷離子飲食原則護理指導',
  '透析病人照護護理指導',
  '貧血病人日常照護護理指導',
  '透析病人蛋白質飲食護理指導',
  '洗腎病人日常保健護理指導',
  '預防跌倒護理指導',
  '透析病人常用藥物注意事項護理指導',
];

@Component({
  selector: 'app-education-record-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './education-record-dialog.component.html',
  styleUrl: './education-record-dialog.component.css',
})
export class EducationRecordDialogComponent implements OnInit {
  private readonly authService = inject(AuthService);

  @Input() patientId = '';
  @Input() patientName = '';
  @Input() medicalRecordNumber = '';
  @Input() admissionDate: string | null = null;
  @Input() firstDialysisDate: string | null = null;
  /** 是否可編輯（viewer / 鎖定時傳 false） */
  @Input() canEdit = true;
  @Output() close = new EventEmitter<void>();

  readonly sessions = signal<EducationSession[]>([]);
  readonly topics = signal<string[]>(DEFAULT_EDUCATION_TOPICS);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);

  async ngOnInit(): Promise<void> {
    if (!this.patientId) return;
    this.isLoading.set(true);
    try {
      // 主題下拉選項（site_config: education_topics），尚未設定時為空，欄位仍可自由輸入
      this.loadTopics();
      const data: any = await localApi.get(`/patients/${this.patientId}/education`);
      if (data) {
        this.patientName = data.patientName || this.patientName;
        this.medicalRecordNumber = data.medicalRecordNumber || this.medicalRecordNumber;
        this.admissionDate = data.admissionDate ?? this.admissionDate;
        this.firstDialysisDate = data.firstDialysisDate ?? this.firstDialysisDate;
        this.sessions.set(this.normalize(data.sessions));
      } else {
        this.sessions.set(this.normalize([]));
      }
    } catch (error) {
      console.error('載入衛教紀錄失敗:', error);
      this.sessions.set(this.normalize([]));
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadTopics(): Promise<void> {
    try {
      // 若 site_config 有設定 education_topics 則覆蓋預設；否則用內建 12 項
      const resp: any = await localApi.get('/system/config/education_topics');
      const list = resp?.configData?.topics;
      this.topics.set(Array.isArray(list) && list.length ? list : DEFAULT_EDUCATION_TOPICS);
    } catch {
      this.topics.set(DEFAULT_EDUCATION_TOPICS);
    }
  }

  private toSign(s: any): SignOff | null {
    if (!s || typeof s !== 'object') return null;
    const name = String(s.name || '').trim();
    const date = s.date ? String(s.date).slice(0, 10) : '';
    if (!name && !date) return null;
    return { name, date };
  }

  private normalize(input: any): EducationSession[] {
    return Array.from({ length: 12 }, (_, i) => {
      const s = Array.isArray(input) ? input[i] : null;
      // 相容舊資料：educator/educatedDate → educatorSign
      const educatorSign =
        this.toSign(s?.educatorSign) ||
        (s?.educator || s?.educatedDate ? this.toSign({ name: s?.educator, date: s?.educatedDate }) : null);
      return {
        index: i + 1,
        dialysisDate: s?.dialysisDate || '',
        topic: s?.topic || '',
        educatorSign,
        signature: s?.signature || '',
        returnDemoSign: this.toSign(s?.returnDemoSign),
        passSign: this.toSign(s?.passSign),
      };
    });
  }

  get completedCount(): number {
    return this.sessions().filter((s) => !!s.educatorSign).length;
  }

  /** 點選簽核格：空 → 蓋當前使用者姓名+今日；已簽 → 取消 */
  toggleSign(session: EducationSession, field: SignField): void {
    if (!this.canEdit) return;
    if (session[field]) {
      session[field] = null;
    } else {
      const name = this.authService.currentUser()?.name || '';
      session[field] = { name, date: getToday() };
    }
    // 觸發 signal 變更偵測
    this.sessions.set([...this.sessions()]);
  }

  /** 顯示成「姓名（06/30）」 */
  signLabel(sign: SignOff | null): string {
    if (!sign) return '';
    const mmdd = sign.date ? sign.date.slice(5).replace('-', '/') : '';
    return mmdd ? `${sign.name}（${mmdd}）` : sign.name;
  }

  async save(): Promise<void> {
    if (!this.canEdit || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      await localApi.put(`/patients/${this.patientId}/education`, {
        sessions: this.sessions(),
        admissionDate: this.admissionDate || '',
      });
      this.close.emit();
    } catch (error: any) {
      console.error('儲存衛教紀錄失敗:', error);
      alert(`儲存失敗：${error?.message || error}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  onClose(): void {
    this.close.emit();
  }

  print(): void {
    const rows = this.sessions()
      .map(
        (s) => `<tr>
          <td style="text-align:center">${s.index}</td>
          <td style="text-align:center">${this.esc(s.dialysisDate)}</td>
          <td>${this.esc(s.topic)}</td>
          <td style="text-align:center">${this.esc(this.signLabel(s.educatorSign))}</td>
          <td>${this.esc(s.signature)}</td>
          <td style="text-align:center">${this.esc(this.signLabel(s.returnDemoSign))}</td>
          <td style="text-align:center">${this.esc(this.signLabel(s.passSign))}</td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">
      <title>初透病人衛教紀錄</title>
      <style>
        body { font-family: "Microsoft JhengHei", sans-serif; padding: 24px; color: #000; }
        h2 { text-align: center; margin: 0 0 8px; }
        .meta { margin: 8px 0 16px; font-size: 14px; }
        .meta span { margin-right: 24px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #000; padding: 6px 8px; }
        th { background: #f0f0f0; }
        td { height: 28px; }
      </style></head><body>
      <h2>初透病人衛教紀錄</h2>
      <div class="meta">
        <span>姓名：${this.esc(this.patientName)}${this.medicalRecordNumber ? `（${this.esc(this.medicalRecordNumber)}）` : ''}</span>
        <span>入院日期：${this.esc(this.admissionDate || '')}</span>
        <span>首透日期：${this.esc(this.firstDialysisDate || '')}</span>
      </div>
      <table>
        <thead><tr>
          <th style="width:40px">次數</th>
          <th style="width:96px">透析日期</th>
          <th>主題</th>
          <th style="width:110px">衛教者/日期</th>
          <th style="width:120px">被衛教者簽名</th>
          <th style="width:110px">回示教日期/護理師</th>
          <th style="width:120px">回示教通過日/主護簽章</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      alert('無法開啟列印視窗，請檢查瀏覽器是否封鎖彈出視窗。');
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  private esc(v: string): string {
    return String(v || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  }
}
