# 後端 3 檔精確 diff（2026-05）

> 格式為 unified diff。`-` 原始 / `+` 修改後。行號為參考，請以內容比對為準。
> 所有 `LAB_ITEM_MAPPING` 新增均為**附加別名**，未刪除任何原有 key。

---

## src/routes/auth.js — Part B（4 處，放寬「主治醫師」含「專科護理師」）

### 1) `/auth/users/directory` 合併 physician 資料（約 line 538）
```diff
         }
 
-        if (u.title === '主治醫師' && physicianMap[u.id]) {
+        if (['主治醫師', '專科護理師'].includes(u.title) && physicianMap[u.id]) {
           const p = physicianMap[u.id]
           result.staffId = p.staff_id
           result.phone = p.phone
```

### 2) `GET /auth/users`（admin）合併 physician 資料（約 line 594）
```diff
       // 如果是主治醫師，合併 physician 資料
-      if (u.title === '主治醫師' && physicianMap[u.id]) {
+      if (['主治醫師', '專科護理師'].includes(u.title) && physicianMap[u.id]) {
         const p = physicianMap[u.id]
         result.staffId = p.staff_id
```

### 3) POST 建立使用者 upsert physicians（約 line 665）
```diff
     ).run(id, username, passwordHash, name, title || '', role, email || null)
 
-    // 如果是主治醫師，同步到 physicians 表
-    if (title === '主治醫師') {
+    // 主治醫師 / 專科護理師 同步員編電話到 physicians 表
+    if (['主治醫師', '專科護理師'].includes(title)) {
       db.prepare(
         `
```

### 4) PUT 更新使用者 upsert physicians（約 line 814）
```diff
     })
 
-    if (finalTitle === '主治醫師') {
+    if (['主治醫師', '專科護理師'].includes(finalTitle)) {
       // 先讀取現有的 physician 資料
       const existingPhysician = db.prepare(`SELECT * FROM physicians WHERE id = ?`).get(id)
```

---

## src/routes/orders.js（3 處）

### 1) `LAB_ITEM_MAPPING` 附加別名（結尾 `丙胺酸轉胺酶: 'ALT',` 之後、`}` 之前）
```diff
   副甲狀腺素: 'iPTH',
   '血中尿素氮(洗後專用)': 'PostBUN',
   鐵蛋白: 'Ferritin',
   丙胺酸轉胺酶: 'ALT',
+  // 病毒標記（質性結果，以字串存；僅供手動補登，無 HIS 中文名）
+  HBsAg: 'HBsAg',
+  'Anti-HBs': 'AntiHBs',
+  'Anti-HCV': 'AntiHCV',
+  // 真實 HIS Excel 細項名稱別名（與上方舊 key 並存；修正缺漏比對對不到的問題）
+  '尿酸(血)': 'UricAcid',
+  '肌酐(血)(洗腎專用)': 'Creatinine',
+  平均血球容積: 'MCV',
+  紅血球分佈寬度: 'RDW',
+  腎絲球過濾率: 'eGFR',
+  // 季/半年/年套真實 HIS 名（與舊 key 並存）
+  三酸甘油脂: 'Triglyceride',
+  膽固醇: 'Cholesterol',
+  高密度脂蛋白膽固醇: 'HDL',
+  低密度脂蛋白膽固醇: 'LDL',
+  完整型副甲狀腺素: 'iPTH',
+  總鐵結合能: 'TIBC',
+  總蛋白: 'TotalProtein',
+  'B型肝炎表面抗原': 'HBsAg',
+  'B型肝炎表面抗體': 'AntiHBs',
+  'C型肝炎抗體': 'AntiHCV',
 }
```

### 2) `GET /lab-alert-analyses` patientId 支援逗號多筆
```diff
     if (patientId) {
-      query += ' AND patient_id = ?'
-      params.push(patientId)
+      const ids = String(patientId)
+        .split(',')
+        .map((s) => s.trim())
+        .filter(Boolean)
+      if (ids.length > 0) {
+        query += ` AND patient_id IN (${ids.map(() => '?').join(',')})`
+        params.push(...ids)
+      }
     }
 
     if (monthRange) {
```

### 3) 新增 `POST /lab-alert-analyses/query`（純新增，置於 `GET /lab-alert-analyses` handler 的 `})` 之後、`PUT /lab-alert-analyses/:id` 的註解區塊之前）
```diff
   } catch (error) {
     console.error('取得檢驗警示分析錯誤:', error)
     res.status(500).json({ error: true, message: '取得檢驗警示分析失敗' })
   }
 })
 
+/**
+ * POST /api/orders/lab-alert-analyses/query
+ * 批次查詢檢驗警示分析 (field IN values)，供 queryWithInChunks 使用
+ */
+router.post('/lab-alert-analyses/query', authenticate, (req, res) => {
+  try {
+    const { field, values } = req.body || {}
+    if (!Array.isArray(values) || values.length === 0) {
+      return res.json([])
+    }
+
+    const FIELD_MAP = { patientId: 'patient_id', monthRange: 'month_range' }
+    const column = FIELD_MAP[field]
+    if (!column) {
+      return res.status(400).json({
+        error: true,
+        message: `不支援的查詢欄位: ${field}`,
+      })
+    }
+
+    const db = getDatabase()
+    const placeholders = values.map(() => '?').join(',')
+    const analyses = db
+      .prepare(
+        `SELECT * FROM lab_alert_analyses WHERE ${column} IN (${placeholders}) ORDER BY updated_at DESC`,
+      )
+      .all(...values)
+
+    res.json(
+      analyses.map((a) => ({
+        id: a.id,
+        patientId: a.patient_id,
+        monthRange: a.month_range,
+        abnormalityKey: a.abnormality_key,
+        analysis: a.analysis,
+        suggestion: a.suggestion,
+        updatedAt: a.updated_at,
+        createdAt: a.created_at,
+      })),
+    )
+  } catch (error) {
+    console.error('批次查詢檢驗警示分析錯誤:', error)
+    res.status(500).json({ error: true, message: '查詢檢驗警示分析失敗' })
+  }
+})
+
 /**
  * PUT /api/orders/lab-alert-analyses/:id
```

---

## src/routes/system.js（1 處）

### 新增 `GET /api/system/physician-schedules`（list；純新增，置於 `GET /physician-schedules/:date` 的註解區塊之前）
```diff
+/**
+ * GET /api/system/physician-schedules
+ * 取得所有醫師班表（供年度累計統計；id 為 YYYY-MM，攤平 year/month + schedule_data）
+ */
+router.get('/physician-schedules', authenticate, (req, res) => {
+  try {
+    const db = getDatabase()
+    const rows = db.prepare(`SELECT * FROM physician_schedules ORDER BY id`).all()
+    const list = rows.map((row) => {
+      let data = {}
+      try {
+        data = JSON.parse(row.schedule_data || '{}')
+      } catch {
+        data = {}
+      }
+      const m = /^(\d{4})-(\d{2})$/.exec(row.id || '')
+      return {
+        id: row.id,
+        year: m ? Number(m[1]) : undefined,
+        month: m ? Number(m[2]) : undefined,
+        ...data,
+        createdAt: row.created_at,
+        updatedAt: row.updated_at,
+      }
+    })
+    res.json(list)
+  } catch (error) {
+    console.error('取得醫師班表清單錯誤:', error)
+    res.status(500).json({ error: true, message: '取得醫師班表清單失敗' })
+  }
+})
+
 /**
  * GET /api/system/physician-schedules/:date
  * 取得特定日期的醫師班表
  */
 router.get('/physician-schedules/:date', authenticate, (req, res) => {
```

---

## 影響/注意

- `auth.js`：行為變更 —— 專科護理師現也會寫入/回傳 `physicians.staff_id/phone`。`/api/system/physicians` 會多回專師列；已確認消費端（stats/schedule）僅當 id→記錄查表用、physician-schedule 用 `userDirectory` 篩主治醫師，無污染。上線後需管理員逐一替專師補填員編/電話。
- `orders.js` LAB_ITEM_MAPPING：純附加；`parseFloat` 失敗 fallback `String()` 故病毒標記質性結果可存。
- `system.js`：純新增 list 端點，與既有 `/:date`、`PUT` 不衝突（路徑樣式不同）。
