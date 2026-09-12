import {randomUUID} from 'node:crypto';
import {test,expect} from './fixtures.mjs';
async function seed(app, name, extra={}) {
 const response=await app.api('POST','/patients',{name,medicalRecordNumber:'CU'+randomUUID().slice(0,8),status:'opd',patientCategory:'opd_regular',gender:'男',birthDate:'1970-01-01',dialysisOrders:{mode:'HD',freq:'一三五'},...extra});
 expect(response.status).toBe(201);return response.data;
}
async function search(page,text){const panel=page.getByRole('region',{name:'查詢病人'});await panel.getByRole('searchbox',{name:'搜尋病人'}).fill(text);await panel.getByRole('searchbox',{name:'搜尋病人'}).press('Enter');return panel;}
async function assertFocusInside(page,dialog){for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}await page.keyboard.press('Shift+Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}

test('search offers restore for a deleted patient whose original status matches the current tab', async ({page,app}) => {
 const p = await seed(app, '同狀態復原' + randomUUID().slice(0,4));
 const removed = await app.api('DELETE', '/patients/' + p.id, {reason:'隔離回歸測試'});
 expect(removed.status).toBe(200);
 await app.authenticate(page); await page.goto(app.url + '/patients');
 const writes=[]; page.on('request', r => {if(r.url().includes('/api/patients') && !['GET','OPTIONS'].includes(r.method())) writes.push(r.url())});
 const panel = await search(page, p.medicalRecordNumber);
 await panel.getByRole('button', {name:`復原至門診：${p.name}（${p.medicalRecordNumber}）`}).click();
 const confirm = page.getByRole('dialog', {name:'復原病人'});
 await expect(confirm).toContainText(p.medicalRecordNumber);
 await confirm.getByRole('button', {name:'取消', exact:true}).click();
 expect(writes).toEqual([]);
 await expect(panel).toContainText('已刪除');
});

test('patient search shows exact matches without implicit writes; transfer cancellation and profile preserve MRN',async({page,app})=>{
 const name='同名合成'+randomUUID().slice(0,4),a=await seed(app,name),b=await seed(app,name,{status:'ipd'});
 await app.authenticate(page);await page.goto(app.url+'/patients');
 const writes=[];page.on('request',request=>{if(request.url().includes('/api/patients')&&!['GET','OPTIONS'].includes(request.method()))writes.push(request.url())});
 const panel=await search(page,name);await expect(panel.getByRole('button',{name:/查看履歷：/})).toHaveCount(2);expect(writes).toEqual([]);
 await panel.getByRole('button',{name:`移至門診：${b.name}（${b.medicalRecordNumber}）`}).click();
 const confirm=page.getByRole('dialog',{name:'轉移病人'});await expect(confirm).toContainText(b.medicalRecordNumber);await confirm.getByRole('button',{name:'取消',exact:true}).click();expect(writes).toEqual([]);
 await panel.getByRole('button',{name:`查看履歷：${a.name}（${a.medicalRecordNumber}）`}).click();
 await expect(page.locator('.summary-card .ch-mrn')).toContainText(a.medicalRecordNumber);
 await page.getByRole('button',{name:'基本資料',exact:true}).click();await expect(page.locator('app-patient-basic-profile')).toBeVisible();expect(writes).toEqual([]);
});

test('new patient form traps keyboard and preserves dirty content when close is cancelled',async({page,app})=>{
 await app.authenticate(page);await page.goto(app.url+'/patients');const panel=await search(page,'新合成'+randomUUID().slice(0,5));await panel.getByRole('button',{name:'新增病人',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新增病人',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('textbox',{name:'姓名',exact:true}).fill('未存草稿');await assertFocusInside(page,dialog);
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect(dialog.getByRole('textbox',{name:'姓名',exact:true})).toHaveValue('未存草稿');
 page.once('dialog',d=>d.accept());await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(panel.getByRole('button',{name:'新增病人',exact:true})).toBeFocused();
});

test('patient save locks fields and duplicate submit and keeps failure draft editable',async({page,app})=>{
 await app.authenticate(page);await page.goto(app.url+'/patients');const panel=await search(page,'新合成'+randomUUID().slice(0,5));await panel.getByRole('button',{name:'新增病人',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'新增病人',exact:true});await dialog.getByRole('textbox',{name:'病歷號',exact:true}).fill('CUPENDING'+randomUUID().slice(0,5));
 for(const label of ['HBsAg（B 肝）','Anti-HCV（C 肝）','HIV','RPR（梅毒）']) await dialog.locator('.hep-row').filter({hasText:label}).getByRole('button',{name:'未做',exact:true}).click();
 let release,started;const held=new Promise(r=>release=r),received=new Promise(r=>started=r);let count=0;
 await page.route('**/api/patients',async route=>{if(route.request().method()!=='POST')return route.continue();count++;started();await held;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:true,message:'合成保存失敗'})});});
 try {await dialog.getByRole('button',{name:'儲存',exact:true}).click();await expect.poll(()=>count).toBe(1);await received;await expect(dialog.getByRole('textbox',{name:'姓名',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'儲存',exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(count).toBe(1);release();
 const error=page.getByRole('dialog',{name:'操作失敗',exact:true});await expect(error).toBeVisible();await error.getByRole('button',{name:/確定|關閉/}).click();await expect(dialog.getByRole('textbox',{name:'病歷號',exact:true})).toHaveValue(/^CUPENDING/);await expect(dialog.getByRole('button',{name:'儲存',exact:true})).toBeEnabled();
 }finally{release();}
});

test('compact patient list keeps full identifiers and expands notes with usable desktop and mobile bounds',async({page,app})=>{
 const p=await seed(app,'完整姓名十個中文字測試',{remarks:'長備註'.repeat(120)});await page.setViewportSize({width:1280,height:800});await app.authenticate(page);await page.goto(app.url+'/patients');
 const row=page.locator('.flex-table-row').filter({hasText:p.medicalRecordNumber});await expect(row).toHaveCount(1);await expect(row.locator('.patient-name-text')).toHaveText(p.name);await expect(row.locator('.col-mrn')).toHaveText(p.medicalRecordNumber);
 const collapsed=await row.locator('.remarks-text').boundingBox();expect(collapsed.height).toBeLessThan(70);await row.getByRole('button',{name:'展開備註：'+p.name}).click();await expect.poll(async()=> (await row.locator('.remarks-text').boundingBox()).height).toBeGreaterThan(collapsed.height);await row.getByRole('button',{name:'收合備註：'+p.name}).click();
 const widths=await row.evaluate(el=>({row:el.getBoundingClientRect().width,remarks:el.querySelector('.col-remarks').getBoundingClientRect().width,name:el.querySelector('.patient-name-text').scrollWidth,visibleName:el.querySelector('.patient-name-text').clientWidth}));expect(widths.remarks).toBeGreaterThanOrEqual(150);expect(widths.row).toBeLessThan(1300);expect(widths.name).toBeLessThanOrEqual(widths.visibleName+1);
 await page.getByRole('checkbox',{name:'顯示詳細欄位'}).check();await expect(row.locator('.col-physician')).toBeVisible();await page.setViewportSize({width:390,height:844});const panel=page.getByRole('region',{name:'查詢病人'});await expect(panel).toBeVisible();const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(391);await expect(page.locator('.mobile-only').getByText(p.medicalRecordNumber,{exact:true})).toBeVisible();
});

test('KiDit workstation cards support Enter and Space and render the chosen workflow',async({page,app})=>{
 await app.authenticate(page);await page.goto(app.url+'/kidit-report');const hdrx=page.getByRole('button',{name:/HD處方/});await hdrx.focus();await page.keyboard.press('Enter');await expect(page.locator('app-kidit-hdrx-quarterly')).toBeVisible();
 const initial=page.getByRole('button',{name:/初次建檔/});await initial.focus();await page.keyboard.press('Space');await expect(page.locator('app-kidit-hdrx-quarterly')).toBeHidden();await expect(page.getByText('需建檔名單',{exact:false}).first()).toBeVisible();
});

test('CI section navigation reaches visible fields and preserves typed content at mobile width',async({page,app})=>{
 const p=await seed(app,'申請導航合成');await app.authenticate(page);await page.goto(app.url+'/catastrophic-illness');await page.locator('.patient-picker .picker-input').fill(p.medicalRecordNumber);await page.getByText(p.medicalRecordNumber,{exact:true}).filter({visible:true}).last().click();await page.getByRole('button',{name:'＋ 新增初次申請（自動帶入）',exact:true}).filter({visible:true}).click();
 await page.setViewportSize({width:390,height:844});const nav=page.getByRole('navigation',{name:'申請表區塊'});await nav.getByRole('link',{name:'生化檢驗值',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#ci-labs')).toBeInViewport();const input=page.locator('#ci-labs .lab-grid input').first();await input.fill('7.5');await nav.getByRole('link',{name:'負責醫師',exact:true}).click();await nav.getByRole('link',{name:'生化檢驗值',exact:true}).click();await expect(input).toHaveValue('7.5');
});

test('existing education completion filters remain keyboard operable',async({page,app})=>{
 await app.authenticate(page);await page.goto(app.url+'/education-dashboard');const pending=page.getByRole('button',{name:'未完成',exact:true});await expect(pending).toHaveClass(/active/);const confirmed=page.getByRole('button',{name:'主護確認完成',exact:true});await confirmed.focus();await page.keyboard.press('Enter');await expect(confirmed).toHaveClass(/active/);await pending.focus();await page.keyboard.press('Space');await expect(pending).toHaveClass(/active/);
});

test('lab failed save remains visible and display filter clears after retry without discarding the full report',async({page,app})=>{
 const p=await seed(app,'檢驗篩選合成');for(const month of ['07','08','09']){const response=await app.api('POST','/orders/lab-reports',{patientId:p.id,reportDate:`2026-${month}-05`,reportType:'monthly',results:{Hb:7}});expect(response.status).toBe(201);}
 await app.authenticate(page);await page.goto(app.url+'/lab-reports');await page.getByRole('button',{name:'警示報告',exact:true}).click();
 const group=page.locator('.alert-group').filter({hasText:p.name});await expect(group).toHaveCount(1);await group.getByText(p.name,{exact:true}).click();
 const dialog=page.getByRole('dialog',{name:p.name+' - 警示報告分析',exact:true});await expect(dialog).toBeVisible();await dialog.getByPlaceholder('請在此輸入其他病因').fill('合成原因');await assertFocusInside(page,dialog);
 const fail=route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:true,message:'合成失敗'})}):route.continue();
 await page.route('**/api/orders/lab-alert-analyses/**',fail);await dialog.getByRole('button',{name:'確認並存檔',exact:true}).click();await expect(dialog.getByRole('button',{name:'重試存檔',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'關閉分析視窗',exact:true}).click();await page.getByRole('combobox',{name:'檢驗處理狀態'}).selectOption('failed');await expect(group).toHaveCount(1);
 await page.unroute('**/api/orders/lab-alert-analyses/**',fail);await page.getByRole('button',{name:/重試失敗項目/}).click();await expect(page.getByText('目前篩選沒有符合項目。',{exact:true})).toBeVisible();await page.getByRole('combobox',{name:'檢驗處理狀態'}).selectOption('all');await expect(group).toHaveCount(1);await expect(group).toContainText('合成原因');
});
