import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild, inject, signal } from '@angular/core';
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

/** 主護（來源：使用者管理的護理師分配病人照護清單） */
interface PrimaryNurse {
  nurseId: string;
  nurseName: string;
}

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
  /** 主護（照護清單反查；null = 尚未分配） */
  readonly primaryNurse = signal<PrimaryNurse | null>(null);
  /** 紙本衛教（病人層級）：已紙本衛教者不列入電子未衛教判定；紙本完成視為全數通過 */
  readonly paperEducation = signal(false);
  readonly paperCompleted = signal(false);
  readonly topics = signal<string[]>(DEFAULT_EDUCATION_TOPICS);
  // 此病人的主題輪序佇列：跳過的主題移到最後；隨紀錄儲存
  readonly topicQueue = signal<string[]>([]);
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);

  // 被衛教者手寫簽名板（平板觸控）
  readonly signPadVisible = signal(false);
  @ViewChild('sigCanvas') private sigCanvasRef?: ElementRef<HTMLCanvasElement>;
  private signTarget: EducationSession | null = null;
  private sigCtx: CanvasRenderingContext2D | null = null;
  private sigDrawing = false;
  private sigLastX = 0;
  private sigLastY = 0;
  private sigHasInk = false;

  async ngOnInit(): Promise<void> {
    if (!this.patientId) return;
    this.isLoading.set(true);
    try {
      // 主題下拉選項（site_config: education_topics），尚未設定時用內建 12 項
      await this.loadTopics();
      const data: any = await localApi.get(`/patients/${this.patientId}/education`);
      if (data) {
        this.patientName = data.patientName || this.patientName;
        this.medicalRecordNumber = data.medicalRecordNumber || this.medicalRecordNumber;
        this.admissionDate = data.admissionDate ?? this.admissionDate;
        this.firstDialysisDate = data.firstDialysisDate ?? this.firstDialysisDate;
        this.primaryNurse.set(data.primaryNurse?.nurseName ? data.primaryNurse : null);
        this.paperEducation.set(!!data.paperEducation);
        this.paperCompleted.set(!!data.paperCompleted);
        this.sessions.set(this.normalize(data.sessions));
        this.initTopicQueue(data.topicQueue);
      } else {
        this.sessions.set(this.normalize([]));
        this.initTopicQueue(null);
      }
      this.autoAssignTopics();
    } catch (error) {
      console.error('載入衛教紀錄失敗:', error);
      this.sessions.set(this.normalize([]));
      this.initTopicQueue(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  /** 初始化此病人的主題輪序佇列：已存的優先，補上清單後來新增的主題；未存過則用主題清單順序 */
  private initTopicQueue(saved: unknown): void {
    const master = this.topics();
    const base = Array.isArray(saved) && saved.length ? saved.map((t) => String(t)) : [...master];
    for (const t of master) {
      if (!base.includes(t)) base.push(t);
    }
    this.topicQueue.set(base);
  }

  /** 已被任何一列使用的主題（自動帶入、手動選、已簽核都算，避免重複衛教） */
  private usedTopics(): Set<string> {
    return new Set(this.sessions().map((s) => s.topic.trim()).filter(Boolean));
  }

  /**
   * 自動帶入：有透析日期、主題空白的列，依佇列順序帶入尚未用過的主題。
   * 已填/已簽的列不動；欄位仍可手動改選。
   */
  private autoAssignTopics(): void {
    if (!this.canEdit) return;
    const used = this.usedTopics();
    const queue = this.topicQueue();
    let changed = false;
    for (const s of this.sessions()) {
      if (!s.dialysisDate || s.topic) continue;
      const next = queue.find((t) => !used.has(t));
      if (!next) break;
      s.topic = next;
      used.add(next);
      changed = true;
    }
    if (changed) this.sessions.set([...this.sessions()]);
  }

  /** 可跳過：可編輯、有帶入主題、衛教者尚未簽章 */
  canSkip(s: EducationSession): boolean {
    return this.canEdit && !!s.topic && !s.educatorSign;
  }

  /** 跳過（主題不合適）：該主題移到佇列最後，這一列帶入下一個未用過的主題 */
  skipTopic(s: EducationSession): void {
    if (!this.canSkip(s)) return;
    const skipped = s.topic;
    const queue = this.topicQueue().filter((t) => t !== skipped);
    queue.push(skipped);
    this.topicQueue.set(queue);
    s.topic = '';
    const used = this.usedTopics();
    const next = queue.find((t) => !used.has(t) && t !== skipped);
    if (next) s.topic = next;
    this.sessions.set([...this.sessions()]);
  }

  /** 待衛教主題（依佇列順序、排除已使用），顯示於表格下方 */
  get pendingTopics(): string[] {
    const used = this.usedTopics();
    return this.topicQueue().filter((t) => !used.has(t));
  }

  /** 此列下拉可選主題：排除其他列已衛教/已指派的主題（避免重複衛教），保留自己目前選的值 */
  topicOptions(current: EducationSession): string[] {
    const usedByOthers = new Set(
      this.sessions()
        .filter((s) => s !== current)
        .map((s) => s.topic.trim())
        .filter(Boolean),
    );
    return this.topics().filter((t) => t === current.topic || !usedByOthers.has(t));
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

  /** 勾/取消「已紙本衛教」；取消時連動清掉「紙本衛教已完成」 */
  onPaperEducationChange(checked: boolean): void {
    this.paperEducation.set(checked);
    if (!checked) this.paperCompleted.set(false);
  }

  /** 主護簽章欄提示：標明這位病人的主護（來源：照護清單） */
  passSignTitle(s: EducationSession): string {
    if (s.passSign) return '點選取消簽核';
    const nurse = this.primaryNurse()?.nurseName;
    const base = '點選簽核（蓋章＝您的姓名＋今日）';
    return nurse ? `主護：${nurse}。${base}` : `尚未在照護清單分配主護。${base}`;
  }

  /** 顯示成「姓名（06/30）」 */
  signLabel(sign: SignOff | null): string {
    if (!sign) return '';
    const mmdd = sign.date ? sign.date.slice(5).replace('-', '/') : '';
    return mmdd ? `${sign.name}（${mmdd}）` : sign.name;
  }

  /** 簽名是否為手寫圖檔（data URL）；否則視為舊的文字簽名 */
  isImageSig(v: string): boolean {
    return typeof v === 'string' && v.startsWith('data:image');
  }

  /** 有透析日期但主題或被衛教者簽名尚未填 → 需提醒補齊（整列警示底色） */
  needsAttention(s: EducationSession): boolean {
    return !!(s.dialysisDate && (!s.topic || !s.signature));
  }

  /** 開啟手寫簽名板（平板讓病人簽名） */
  openSignPad(session: EducationSession): void {
    if (!this.canEdit) return;
    this.signTarget = session;
    this.sigHasInk = false;
    this.signPadVisible.set(true);
    // 等 canvas 渲染後再初始化
    setTimeout(() => this.initSigCanvas(), 0);
  }

  private initSigCanvas(): void {
    const canvas = this.sigCanvasRef?.nativeElement;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    this.sigCtx = ctx;
    // 若已有手寫簽名，載入既有圖以供修改（視為已有筆跡，確認時保留）
    const existing = this.signTarget?.signature;
    if (existing && this.isImageSig(existing)) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = existing;
      this.sigHasInk = true;
    }
  }

  private sigPos(e: PointerEvent): { x: number; y: number } {
    const canvas = this.sigCanvasRef!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  onSigDown(e: PointerEvent): void {
    if (!this.sigCtx) return;
    e.preventDefault();
    this.sigDrawing = true;
    const { x, y } = this.sigPos(e);
    this.sigLastX = x;
    this.sigLastY = y;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // 點一下也留下墨點
    this.sigCtx.beginPath();
    this.sigCtx.arc(x, y, 1.2, 0, Math.PI * 2);
    this.sigCtx.fillStyle = '#111827';
    this.sigCtx.fill();
    this.sigHasInk = true;
  }

  onSigMove(e: PointerEvent): void {
    if (!this.sigDrawing || !this.sigCtx) return;
    e.preventDefault();
    const { x, y } = this.sigPos(e);
    this.sigCtx.beginPath();
    this.sigCtx.moveTo(this.sigLastX, this.sigLastY);
    this.sigCtx.lineTo(x, y);
    this.sigCtx.stroke();
    this.sigLastX = x;
    this.sigLastY = y;
    this.sigHasInk = true;
  }

  onSigUp(): void {
    this.sigDrawing = false;
  }

  clearSig(): void {
    const canvas = this.sigCanvasRef?.nativeElement;
    if (canvas && this.sigCtx) {
      this.sigCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.sigHasInk = false;
  }

  confirmSig(): void {
    const canvas = this.sigCanvasRef?.nativeElement;
    if (this.signTarget) {
      this.signTarget.signature = this.sigHasInk && canvas ? canvas.toDataURL('image/png') : '';
      this.sessions.set([...this.sessions()]);
    }
    this.closeSignPad();
  }

  closeSignPad(): void {
    this.signPadVisible.set(false);
    this.signTarget = null;
    this.sigCtx = null;
    this.sigDrawing = false;
  }

  async save(): Promise<void> {
    if (!this.canEdit || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      await localApi.put(`/patients/${this.patientId}/education`, {
        sessions: this.sessions(),
        admissionDate: this.admissionDate || '',
        topicQueue: this.topicQueue(),
        paperEducation: this.paperEducation(),
        paperCompleted: this.paperCompleted(),
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
          <td style="text-align:center">${
            this.isImageSig(s.signature)
              ? `<img src="${s.signature}" style="max-height:40px;max-width:110px" alt="簽名" />`
              : this.esc(s.signature)
          }</td>
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
        <span>主護：${this.esc(this.primaryNurse()?.nurseName || '未分配')}</span>
        ${this.paperEducation() ? `<span>紙本衛教：${this.paperCompleted() ? '已完成' : '進行中'}</span>` : ''}
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
