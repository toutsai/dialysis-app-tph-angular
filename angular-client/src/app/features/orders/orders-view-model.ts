/** Pure display projection: preserves every source record and the historical Excel cell text. */
export interface MedicationMetadata { code: string; tradeName: string; unit: string }
export interface MedicationOrder {
  orderCode: string; dose?: string | number; orderType?: string; note?: string;
  frequency?: string; startDate?: string; changeDate?: string; endDate?: string; uploadMonth?: string;
}
export interface MedicationCell {
  code: string; text: string; hasRecords: boolean;
  entries: { text: string; startDate: string; endDate: string; frequency: string; note: string }[];
}

export function medicationMetadataMap(medications: readonly MedicationMetadata[]): Map<string, MedicationMetadata> {
  const map = new Map<string, MedicationMetadata>();
  // Array.find used the first matching code, including when master metadata has duplicates.
  for (const medication of medications) if (!map.has(medication.code)) map.set(medication.code, medication);
  return map;
}

export function formatMedicationOrder(order: MedicationOrder, metadata: ReadonlyMap<string, MedicationMetadata>, monthKey?: string): string {
  const dose = order.dose || '';
  if (!dose) return '-';
  const masterMed = metadata.get(order.orderCode);
  const unit = masterMed?.unit ? ` ${masterMed.unit}` : '';
  const detailParts: string[] = [];
  if (order.orderCode === 'XX88') {
    if (order.note) detailParts.push(order.note);
    if (order.frequency) detailParts.push(order.frequency);
  } else if (order.orderType === 'injection') {
    if (order.note) detailParts.push(order.note);
  } else if (order.frequency) detailParts.push(order.frequency);
  if (order.endDate && monthKey && order.endDate <= `${monthKey}-31`) {
    const [, m, d] = order.endDate.split('-');
    detailParts.push(`至${Number(m)}/${Number(d)}止`);
  }
  return detailParts.length ? `${dose}${unit} (${detailParts.join('，')})` : `${dose}${unit}`;
}

export function medicationCell(code: string, orders: readonly MedicationOrder[] | undefined, metadata: ReadonlyMap<string, MedicationMetadata>, month?: string): MedicationCell {
  const entries = [...(orders || [])].sort((a, b) =>
    new Date(a.startDate || a.changeDate || 0).getTime() - new Date(b.startDate || b.changeDate || 0).getTime()
  ).map(order => ({ text: formatMedicationOrder(order, metadata, month), startDate: order.startDate || order.changeDate || '', endDate: order.endDate || '', frequency: order.frequency || '', note: order.note || '' }));
  const text = entries.map(entry => entry.text).filter(text => text !== '-').join('；') || '-';
  return { code, text, hasRecords: entries.length > 0, entries };
}

export function individualOrderMonths<T extends MedicationOrder>(orders: readonly T[], year: number): { month: string; orders: Record<string, T[]> }[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(12 - index).padStart(2, '0')}`;
    const grouped: Record<string, T[]> = Object.create(null);
    for (const order of orders) {
      const active = order.startDate
        ? order.startDate <= `${month}-31` && (!order.endDate || order.endDate >= `${month}-01`)
        : order.uploadMonth === month;
      if (active) (grouped[order.orderCode] ||= []).push(order);
    }
    return { month, orders: grouped };
  });
}

export interface PatientChoice { id?: string; name?: string; medicalRecordNumber?: string }
export function matchingOrderPatients<T extends PatientChoice>(patients: readonly T[], search: string): T[] {
  const term = search.trim().toLowerCase();
  if (!term) return [];
  return patients.filter(patient => (patient.name || '').toLowerCase().includes(term) ||
    String(patient.medicalRecordNumber || '').toLowerCase().includes(term));
}
