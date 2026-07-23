/**
 * 調班申請的交班留言（type='調班'）：內容組版與任務 payload。
 * 調班管理頁與護理分組的調班彈窗共用——兩邊送出申請後都要建立同一格式的交班留言，
 * 顯示規則（申請日起至關聯日止，過期退場）依賴這裡的 type 與 targetDate。
 */

const SHIFT_NAMES: Record<string, string> = { early: '早班', noon: '午班', late: '晚班' };

function formatBedAndShift(targetData: any): string {
  if (!targetData) return 'N/A';
  const bedNum = targetData.fromBedNum || targetData.bedNum;
  const shiftCode = targetData.fromShiftCode || targetData.shiftCode;
  if (!bedNum || !shiftCode) return 'N/A';
  const shiftName = SHIFT_NAMES[shiftCode] || shiftCode;
  const bedDisplay = String(bedNum).startsWith('peripheral-')
    ? `外圍 ${String(bedNum).split('-')[1]}`
    : `${bedNum}床`;
  return `${bedDisplay} / ${shiftName}`;
}

/** 調班留言的關聯日：MOVE/ADD_SESSION 的日期在 to.goalDate；SUSPEND 顯示到暫停區間結束 */
export function getExceptionMessageDate(ex: any): string {
  if (ex.type === 'SUSPEND') return ex.endDate || ex.startDate || '';
  return ex.date || ex.startDate || ex.to?.goalDate || '';
}

/** 組出調班申請對應的交班留言 payload（SWAP 兩位病人各一筆；無法組內容時回空陣列） */
export function buildExceptionMessageTasks(
  formData: any,
  user: { uid: string; name: string; title?: string },
  isUpdating = false,
): any[] {
  let messageContent = '';
  const reasonText = `\n原因: ${formData.reason}`;
  switch (formData.type) {
    case 'MOVE':
      messageContent =
        `【${isUpdating ? '更新-臨時調班' : '臨時調班'}】\n原排班: ${formData.from.sourceDate} (${formatBedAndShift(formData.from)})\n新排班: ${formData.to.goalDate} (${formatBedAndShift(formData.to)})` +
        reasonText;
      break;
    case 'SUSPEND':
      messageContent = `【區間暫停】\n從 ${formData.startDate} 至 ${formData.endDate}` + reasonText;
      break;
    case 'ADD_SESSION': {
      const modeText = formData.mode && formData.mode !== 'HD' ? ` [${formData.mode}]` : '';
      messageContent =
        `【臨時加洗${modeText}】\n日期: ${formData.to.goalDate} (${formatBedAndShift(formData.to)})` +
        reasonText;
      break;
    }
    case 'SWAP':
      messageContent =
        `【同日互調】\n日期: ${formData.date}\n${formData.patient1.patientName} (${formatBedAndShift(formData.patient1)}) <=> ${formData.patient2.patientName} (${formatBedAndShift(formData.patient2)})` +
        reasonText;
      break;
  }
  if (!messageContent) return [];

  const createMessageTask = (patientInfo: { id: string; name: string }) => ({
    category: 'message',
    type: '調班',
    content: messageContent,
    patientId: patientInfo.id,
    patientName: patientInfo.name,
    targetDate: getExceptionMessageDate(formData),
    status: 'pending',
    creator: {
      uid: user.uid,
      name: user.name,
      title: user.title,
    },
    createdAt: new Date().toISOString(),
    expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    assignee: null,
  });

  if (formData.type === 'SWAP') {
    return [
      createMessageTask({ id: formData.patient1.patientId, name: formData.patient1.patientName }),
      createMessageTask({ id: formData.patient2.patientId, name: formData.patient2.patientName }),
    ];
  }
  return [createMessageTask({ id: formData.patientId, name: formData.patientName })];
}
