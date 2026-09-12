import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.mjs';
import { getScheduleKey } from '../../src/utils/scheduleUtils.js';

test('weekly keyboard move and cancel use normal save rules and native search buttons', async ({ page, app }) => {
  const patient = await app.api('POST', '/patients', { name:'鍵盤回歸模擬病人', medicalRecordNumber:'KB'+randomUUID().slice(0,8), status:'opd', gender:'M', physician:'模擬醫師', birthDate:'1970-01-01', patientCategory:'opd_regular', dialysisOrders:{mode:'HD',freq:'一三五'} });
  expect(patient.status).toBe(201);
  const saved = await app.api('PUT', `/schedules/${app.today}`, {schedule:{[getScheduleKey(1,'early')]:{patientId:patient.data.id}}});
  expect(saved.status).toBe(200);
  await app.authenticate(page);await page.goto(app.url+'/weekly');
  const source=page.getByRole('button',{name:/早班 1号床，鍵盤回歸模擬病人/});
  await expect(source).toBeVisible();await source.focus();await page.keyboard.press('Space');
  await expect(page.getByRole('button',{name:'取消床位移動',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await expect(source).toHaveAttribute('aria-pressed','false');
  await source.press('Space');
  const targetId=await page.getByRole('button',{name:/早班 2号床，空床/}).filter({visible:true}).first().getAttribute('data-slot-id');
  expect(targetId).toBeTruthy();
  const target=page.locator('.schedule-slot[data-slot-id="'+targetId+'"]');
  await target.focus();await target.press('Space');await expect(target).toHaveAccessibleName(/鍵盤回歸模擬病人/);
  await page.getByRole('button',{name:'儲存變更',exact:true}).click();
  await expect.poll(async()=> (await app.api('GET',`/schedules/${app.today}`)).data.schedule?.[getScheduleKey(2,'early')]?.patientId).toBe(patient.data.id);
  const success=page.getByRole('dialog',{name:'操作成功',exact:true});
  await expect(success).toBeVisible();await success.getByRole('button',{name:'確定',exact:true}).click();
  await expect(success).not.toBeVisible();
  const search=page.getByPlaceholder('搜尋病人姓名/病歷號...');await search.fill('鍵盤回歸模擬病人');
  await expect(search).toHaveValue('鍵盤回歸模擬病人');
  const result=page.getByRole('button',{name:/鍵盤回歸模擬病人 - KB/});await expect(result).toBeVisible();
  await search.press('Tab');await expect(result).toBeFocused();await result.press('Enter');
  await expect(page.getByTitle('清除搜尋定位的黃框標記',{exact:true})).toBeVisible();
});

test('narrow collaboration can create and complete a task with contained modal focus', async ({ page, app }) => {
  const linked=await app.api('POST','/patients',{name:'交辦選擇模擬病人',medicalRecordNumber:'TASK'+randomUUID().slice(0,8),status:'opd',gender:'M',physician:'模擬醫師',birthDate:'1970-01-01',patientCategory:'opd_regular',dialysisOrders:{mode:'HD',freq:'一三五'}});expect(linked.status).toBe(201);
  await page.setViewportSize({width:390,height:844});await app.authenticate(page,'editor');await page.goto(app.url+'/collaboration?date='+app.today);
  await page.getByRole('button',{name:/新增交辦\/留言/}).filter({visible:true}).click();
  const dialog=page.getByRole('dialog',{name:'交辦與留言',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'選擇病人',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'選擇關聯病人',exact:true});await expect(picker).toBeVisible();
  await picker.getByPlaceholder('搜尋姓名/病歷號...').fill('交辦選擇模擬病人');
  await picker.getByRole('button',{name:/交辦選擇模擬病人/}).press('Space');await picker.getByRole('button',{name:'確認',exact:true}).click();
  await expect(picker).not.toBeVisible();await expect(dialog.getByText(/交辦選擇模擬病人 \(/)).toBeVisible();
  await expect.poll(()=>dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('radio',{name:'交辦事項',exact:true}).check();await dialog.getByRole('button',{name:'護理師組長',exact:true}).click();
  const content='窄版交辦回歸 '+randomUUID();await dialog.getByLabel('交辦或留言內容').fill(content);
  await dialog.getByRole('button',{name:'取消',exact:true}).focus();await page.keyboard.press('Tab');
  await expect.poll(()=>dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button',{name:'送出',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:/交辦事項/}).filter({visible:true}).click();
  const task=page.locator('.mobile-container .inbox-tasks').getByRole('listitem').filter({hasText:content});
  await expect(task).toBeVisible();await task.getByRole('button',{name:/完成/}).click();await expect(task.getByText(/完成/)).toBeVisible();
  const tasks=await app.api('GET','/system/tasks?category=task');expect(tasks.data.find(row=>row.content===content)?.status).toBe('completed');
});

test('daily log section navigation focuses visible notes and primary actions remain reachable', async ({ page, app }) => {
  await page.setViewportSize({width:390,height:844});await app.authenticate(page);await page.goto(app.url+'/daily-log');
  const nav=page.getByRole('navigation',{name:'工作日誌段落'});await expect(nav).toBeVisible();
  await nav.getByRole('button',{name:'其他事項',exact:true}).click();
  await expect(page.getByRole('heading',{name:'其他事項',exact:true}).filter({visible:true})).toBeFocused();
  await expect(page.getByRole('button',{name:'儲存日誌',exact:true})).toBeInViewport();
  await expect(page.getByRole('button',{name:'歷史版本',exact:true})).toBeInViewport();
});
