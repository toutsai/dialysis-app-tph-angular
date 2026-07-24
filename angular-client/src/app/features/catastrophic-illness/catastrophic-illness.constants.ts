// 重大傷病申請：官方附表欄位常數（初次/再次共用）
// 來源：全民健康保險慢性腎衰竭需定期透析治療患者重大傷病證明申請附表（D:\05初次 / D:\06再次）

/** 二、伴隨症狀（初次）＝ 四、目前之伴隨症狀（再次），勾選鍵 s1~s10 */
export const SYMPTOM_OPTIONS: { key: string; label: string }[] = [
  { key: 's1', label: '1.心臟衰竭或肺水腫' },
  { key: 's2', label: '2.心包膜炎' },
  { key: 's3', label: '3.出血傾向' },
  { key: 's4', label: '4.神經症狀：意識障礙，抽搐或末稍神經病變' },
  { key: 's5', label: '5.高血鉀（藥物難以控制）' },
  { key: 's6', label: '6.嚴重酸血症(藥物難以控制)' },
  { key: 's7', label: '7.噁心、嘔吐(藥物難以控制)' },
  { key: 's8', label: '8.惡病體質(cachexia)' },
  { key: 's9', label: '9.重度氮血症 (BUN > 100 mg/dl)' },
  { key: 's10', label: '10.其他' },
];

/** 三、相關疾病（初次）＝ 五、目前之相關疾病（再次），勾選鍵 c1~c9 */
export const COMORBIDITY_OPTIONS: { key: string; label: string }[] = [
  { key: 'c1', label: '1.糖尿病' },
  { key: 'c2', label: '2.高血壓' },
  { key: 'c3', label: '3.鬱血性心臟衰竭' },
  { key: 'c4', label: '4.缺血性心臟病' },
  { key: 'c5', label: '5.腦血管病變' },
  { key: 'c6', label: '6.慢性肝病/肝硬化' },
  { key: 'c7', label: '7.惡性腫瘤' },
  { key: 'c8', label: '8.結核' },
  { key: 'c9', label: '9.其他' },
];

/** 初次申請 五、腎臟超音波檢查異常 可複選項，鍵 u1~u7 */
export const ULTRASOUND_OPTIONS: { key: string; label: string }[] = [
  { key: 'u1', label: '左腎臟剩餘 8-10cm' },
  { key: 'u2', label: '右腎臟剩餘 8-10cm' },
  { key: 'u3', label: '左腎臟剩餘 6-8cm' },
  { key: 'u4', label: '右腎臟剩餘6-8cm' },
  { key: 'u5', label: '左側水腎' },
  { key: 'u6', label: '右側水腎' },
  { key: 'u7', label: '慢性腎實質病變' },
];

/** 再次申請 三、必須再開始透析或持續定期透析之理由，鍵 r1~r4 */
export const RESTART_REASON_OPTIONS: { key: string; label: string }[] = [
  { key: 'r1', label: '每日尿量低於400cc' },
  { key: 'r2', label: '危及生命之狀況' },
  { key: 'r3', label: '嚴重影響生活品質' },
  { key: 'r4', label: '反覆入院或急診' },
];

/** 原發病因代碼表（初次申請附表背面完整清單） */
export const PRIMARY_DISEASE_CODES: { code: string; label: string }[] = [
  { code: 'A-01A', label: '慢性腎絲球腎炎(臨床診斷，未有病理切片者)' },
  { code: 'A-01B', label: '慢性腎絲球腎炎(有病理切片診斷者)' },
  { code: 'A-01B-a', label: 'A型免疫球蛋白腎炎' },
  { code: 'A-01B-b', label: '局部腎絲球硬化症' },
  { code: 'A-01B-c', label: '膜性腎病變' },
  { code: 'A-01B-d', label: '膜性增生性腎炎' },
  { code: 'A-01B-e', label: '間質增生性腎炎' },
  { code: 'A-01B-f', label: '微小變化型腎病變' },
  { code: 'A-01B-g', label: '半月狀腎絲球腎炎' },
  { code: 'A-01B-h', label: '鏈球菌感染後腎絲球腎炎' },
  { code: 'A-01B-i', label: '腎小管組織腎炎' },
  { code: 'A-01B-j', label: '止痛劑性腎病變' },
  { code: 'A-01B-k', label: '其他型腎絲球腎炎' },
  { code: 'A-02A', label: '快速進行性腎絲球腎炎(臨床診斷，未有病理切片者)' },
  { code: 'A-02B', label: '快速進行性腎絲球腎炎(有病理切片診斷者)' },
  { code: 'A-03A', label: '慢性腎間質性腎炎(臨床診斷，未有病理切片者)' },
  { code: 'A-03A-a', label: '中藥引起之慢性腎間質性腎炎(臨床診斷，未有病理切片者)' },
  { code: 'A-03B', label: '慢性腎間質性腎炎(有病理切片診斷者)' },
  { code: 'A-03B-a', label: '中藥引起之慢性腎間質性腎炎(有病理切片診斷者)' },
  { code: 'A-04', label: '慢性腎盂腎炎' },
  { code: 'A-05', label: '急性腎衰竭(未恢復)' },
  { code: 'A-06', label: '其他腎實質疾病' },
  { code: 'B-01', label: '腎硬化症（缺血性腎病變）' },
  { code: 'B-02', label: '惡性高血壓' },
  { code: 'B-03', label: '糖尿病' },
  { code: 'B-04', label: '紅斑性狼瘡' },
  { code: 'B-05', label: '類澱粉腎病變' },
  { code: 'B-06', label: '硬皮症' },
  { code: 'B-07', label: '多發性骨髓病' },
  { code: 'B-08', label: '痛風性腎病變' },
  { code: 'B-09', label: '肝硬化' },
  { code: 'B-10', label: '心衰竭' },
  { code: 'B-11', label: '妊娠毒血症' },
  { code: 'B-12', label: '其他代謝異常引起的腎衰竭' },
  { code: 'B-13', label: '其他系統性疾病引起之腎衰竭' },
  { code: 'B-14', label: '敗血症' },
  { code: 'C-01', label: '結石' },
  { code: 'C-02', label: '腎結核' },
  { code: 'C-03', label: '腎尿路惡性腫瘤' },
  { code: 'C-04', label: '其他惡性腫瘤導致之尿路阻塞' },
  { code: 'C-05', label: '逆流性腎病變' },
  { code: 'C-06', label: '其他原因引起之阻塞性腎病變' },
  { code: 'D-01', label: '腎梗塞' },
  { code: 'D-02', label: '腎動脈栓塞' },
  { code: 'D-03', label: '腎靜脈血栓症' },
  { code: 'D-04', label: '溶血性尿毒症候群' },
  { code: 'D-05', label: '其他腎血管疾病' },
  { code: 'E-01', label: '多囊腎' },
  { code: 'E-02', label: '其他腎囊腫性疾病' },
  { code: 'E-03', label: '遺傳性腎炎' },
  { code: 'E-04', label: '腎形成不全' },
  { code: 'E-05', label: '其他遺傳性疾病導致腎衰竭' },
  { code: 'F', label: '其他已知原因腎衰竭' },
  { code: 'G', label: '不明原因之腎衰竭' },
  { code: 'H-01', label: '一般藥物中毒' },
  { code: 'H-02', label: '農藥中毒' },
  { code: 'H-03', label: '化學製劑中毒' },
  { code: 'H-04', label: '其他中毒' },
  { code: 'I', label: '其他' },
];

/** 表單資料（form_data JSON）；日期欄一律存 YYYY-MM-DD，列印時轉民國年月日 */
export interface CatastrophicFormData {
  // ---- 共同表頭 ----
  name: string;
  gender: string; // '男' | '女'
  idNumber: string;
  birthDate: string;
  firstDialysisDate: string;
  address: string;
  phone: string;
  facilityName: string;
  facilityCode: string;
  dialysisType: string; // 'hd' | 'pd' | ''
  vascularAccessDate: string; // 永久性血管通路完成日期
  pdCatheterDate: string; // 腹膜透析導管植入日期
  primaryDisease: string; // 原發病因代碼
  // ---- 勾選區（共用） ----
  symptoms: string[]; // s1~s10
  symptomsOther: string;
  comorbidities: string[]; // c1~c9
  comorbidityOther: string;
  // ---- 生化檢驗值 ----
  labDate: string;
  albumin: string;
  hct: string;
  hb: string;
  k: string;
  bun: string;
  cr: string;
  egfr: string; // 初次限定
  dailyUrine: string;
  // ---- 初次限定 ----
  indication: string; // 'absolute' | 'relative' | ''
  histKnownCkd: boolean;
  histKnownCkdDate: string;
  histAbnormal: boolean;
  histAbnBun: string;
  histAbnCr: string;
  histAbnDate: string;
  histUltrasound: boolean;
  histUltrasoundDate: string;
  ultrasoundFindings: string[]; // u1~u7
  ultrasoundOther: string;
  // ---- 再次限定 ----
  applicationNo: string; // 此次申請為第 N 次
  lastResultThreeMonth: boolean; // 上次：發給三個月效期
  lastResultRejected: boolean; // 上次：不符不同意
  lastRejectIncomplete: boolean; // 理由：資料不全
  lastRejectOther: string; // 理由：其他
  initialIndication: string; // 初次申請之適應症 'absolute' | 'relative' | ''
  weeklyHdCount: string;
  hoursPerSession: string;
  pdExchangesPerDay: string;
  longestCcr: string; // 最長不透析日之24小時CCr
  triedStop: string; // 'yes' | 'no' | ''
  triedStopDate: string;
  longestStopDays: string;
  stopBun: string;
  stopCr: string;
  restartReasons: string[]; // r1~r4
  // ---- 結尾（共用） ----
  reason6: string; // 六、其他嚴重臨床狀況理由
  physicianName: string;
  physicianLicense: string; // 中腎專醫字第 N 號
  physicianDate: string;
}

export function createEmptyFormData(): CatastrophicFormData {
  return {
    name: '',
    gender: '',
    idNumber: '',
    birthDate: '',
    firstDialysisDate: '',
    address: '',
    phone: '',
    facilityName: '衛生福利部臺北醫院',
    facilityCode: '0131060029',
    dialysisType: 'hd',
    vascularAccessDate: '',
    pdCatheterDate: '',
    primaryDisease: '',
    symptoms: [],
    symptomsOther: '',
    comorbidities: [],
    comorbidityOther: '',
    labDate: '',
    albumin: '',
    hct: '',
    hb: '',
    k: '',
    bun: '',
    cr: '',
    egfr: '',
    dailyUrine: '',
    indication: '',
    histKnownCkd: false,
    histKnownCkdDate: '',
    histAbnormal: false,
    histAbnBun: '',
    histAbnCr: '',
    histAbnDate: '',
    histUltrasound: false,
    histUltrasoundDate: '',
    ultrasoundFindings: [],
    ultrasoundOther: '',
    applicationNo: '',
    lastResultThreeMonth: false,
    lastResultRejected: false,
    lastRejectIncomplete: false,
    lastRejectOther: '',
    initialIndication: '',
    weeklyHdCount: '',
    hoursPerSession: '',
    pdExchangesPerDay: '',
    longestCcr: '',
    triedStop: '',
    triedStopDate: '',
    longestStopDays: '',
    stopBun: '',
    stopCr: '',
    restartReasons: [],
    reason6: '',
    physicianName: '',
    physicianLicense: '',
    physicianDate: '',
  };
}

/** YYYY-MM-DD → { y(民國), m, d }；無法解析回傳空字串 */
export function toRocParts(iso: string | undefined | null): { y: string; m: string; d: string } {
  if (!iso) return { y: '', m: '', d: '' };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return { y: '', m: '', d: '' };
  return { y: String(Number(m[1]) - 1911), m: String(Number(m[2])), d: String(Number(m[3])) };
}
