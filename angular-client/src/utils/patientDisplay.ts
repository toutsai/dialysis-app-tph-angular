/**
 * 排程檢視（排班檢查報告）用：病人名稱後掛透析模式與頻率標籤
 * 例：王大明 [HD·一三五]
 * mode 來源為後端正規化後的 patient.mode（HD/SLED/CVVHDF/PP/DFPP/Lipid）
 * freq 來源為 patientStore 併入的 patient.freq（優先 scheduleRule.freq）
 */
export function nameWithModeFreq(p: unknown): string {
  const patient = p as Record<string, unknown> | null | undefined;
  const name = (patient?.['name'] as string) || '未知病人';
  const mode = (patient?.['mode'] as string) || '—';
  const scheduleRule = patient?.['scheduleRule'] as Record<string, unknown> | null | undefined;
  const freq = (scheduleRule?.['freq'] as string) || (patient?.['freq'] as string) || '無頻率';
  return `${name} [${mode}·${freq}]`;
}
