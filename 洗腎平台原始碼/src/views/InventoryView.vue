<!-- 檔案路徑: src/views/InventoryView.vue -->
<!-- ✨ Standalone 版本 -->
<template>
  <div class="page-container">
    <header class="page-header">
      <div class="header-main-content">
        <h1>庫存管理</h1>
        <p class="page-description">管理耗材進貨、消耗紀錄、每月盤點與每週訂單。</p>
      </div>
    </header>

    <div class="tabs-navigation">
      <button :class="{ active: activeTab === 'items' }" @click="activeTab = 'items'">
        品項設定
      </button>
      <button :class="{ active: activeTab === 'purchase' }" @click="activeTab = 'purchase'">
        進貨紀錄
      </button>
      <button :class="{ active: activeTab === 'consumption' }" @click="activeTab = 'consumption'">
        消耗紀錄
      </button>
      <button :class="{ active: activeTab === 'monthly' }" @click="activeTab = 'monthly'">
        每月盤點
      </button>
      <button :class="{ active: activeTab === 'weekly' }" @click="activeTab = 'weekly'">
        每週訂單
      </button>
    </div>

    <main class="page-main-content">
      <!-- ========== Tab 0: 品項設定 ========== -->
      <div v-show="activeTab === 'items'" class="tab-panel">
        <div class="panel-header">
          <h3>庫存品項設定</h3>
          <button class="btn-primary" @click="openItemModal()">+ 新增品項</button>
        </div>

        <div class="category-filter-bar">
          <button
            :class="['category-btn', { active: itemFilter.category === '' }]"
            @click="
              itemFilter.category = '';
              fetchInventoryItems()
            "
          >
            全部
          </button>
          <button
            :class="['category-btn', { active: itemFilter.category === 'artificialKidney' }]"
            @click="
              itemFilter.category = 'artificialKidney';
              fetchInventoryItems()
            "
          >
            人工腎臟
          </button>
          <button
            :class="['category-btn', { active: itemFilter.category === 'dialysateCa' }]"
            @click="
              itemFilter.category = 'dialysateCa';
              fetchInventoryItems()
            "
          >
            透析藥水CA
          </button>
          <button
            :class="['category-btn', { active: itemFilter.category === 'bicarbonateType' }]"
            @click="
              itemFilter.category = 'bicarbonateType';
              fetchInventoryItems()
            "
          >
            B液種類
          </button>
        </div>

        <div class="table-container">
          <div v-if="itemsLoading" class="loading-state">載入中...</div>
          <div v-else-if="filteredInventoryItems.length === 0" class="empty-state">
            尚無品項資料
          </div>
          <table v-else>
            <thead>
              <tr>
                <th>品項類別</th>
                <th>品項名稱</th>
                <th>院內代碼</th>
                <th>每箱個數</th>
                <th>廠牌</th>
                <th>廠商聯絡電話</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredInventoryItems" :key="item.id">
                <td>{{ CATEGORY_NAMES[item.category] }}</td>
                <td>{{ item.name }}</td>
                <td>{{ item.hospitalCode || '-' }}</td>
                <td>{{ item.unitsPerBox || '-' }}</td>
                <td>{{ item.brand || '-' }}</td>
                <td>{{ item.vendorPhone || '-' }}</td>
                <td>
                  <button class="btn-sm btn-edit" @click="openItemModal(item)">編輯</button>
                  <button class="btn-sm btn-delete" @click="deleteInventoryItem(item.id)">
                    刪除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ========== Tab 1: 進貨紀錄 ========== -->
      <div v-show="activeTab === 'purchase'" class="tab-panel">
        <div class="panel-header">
          <h3>進貨紀錄管理</h3>
          <button class="btn-primary" @click="openPurchaseModal()">+ 新增進貨</button>
        </div>

        <div class="filter-bar">
          <div class="filter-field">
            <label>月份</label>
            <input type="month" v-model="purchaseFilter.month" @change="fetchPurchases" />
          </div>
          <div class="filter-field">
            <label>類別</label>
            <select v-model="purchaseFilter.category" @change="fetchPurchases">
              <option value="">全部</option>
              <option value="artificialKidney">人工腎臟</option>
              <option value="dialysateCa">透析藥水CA</option>
              <option value="bicarbonateType">B液種類</option>
            </select>
          </div>
        </div>

        <div class="table-container">
          <div v-if="purchaseLoading" class="loading-state">載入中...</div>
          <div v-else-if="purchases.length === 0" class="empty-state">尚無進貨紀錄</div>
          <table v-else>
            <thead>
              <tr>
                <th>日期</th>
                <th>類別</th>
                <th>品項</th>
                <th>箱數</th>
                <th>個數</th>
                <th>輸入者</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in purchases" :key="item.id">
                <td>{{ formatDate(item.date) }}</td>
                <td>{{ CATEGORY_NAMES[item.category] }}</td>
                <td>{{ item.item }}</td>
                <td>{{ item.boxQuantity || '-' }}</td>
                <td>{{ item.quantity }}</td>
                <td>{{ item.createdBy }}</td>
                <td>
                  <button class="btn-sm btn-edit" @click="openPurchaseModal(item)">編輯</button>
                  <button class="btn-sm btn-delete" @click="deletePurchase(item.id)">刪除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ========== Tab 2: 消耗紀錄 (保留原有功能) ========== -->
      <div v-show="activeTab === 'consumption'" class="tab-panel">
        <div class="sub-tabs">
          <button
            :class="{ active: consumptionSubTab === 'query' }"
            @click="consumptionSubTab = 'query'"
          >
            耗材查詢
          </button>
          <button
            :class="{ active: consumptionSubTab === 'summary' }"
            @click="consumptionSubTab = 'summary'"
          >
            當月總量
          </button>
          <button
            :class="{ active: consumptionSubTab === 'upload' }"
            @click="consumptionSubTab = 'upload'"
          >
            資料上傳
          </button>
        </div>

        <!-- 耗材查詢 -->
        <div v-show="consumptionSubTab === 'query'" class="sub-panel">
          <div class="search-controls">
            <div class="group-filters">
              <div class="search-field">
                <label>頻率</label>
                <select v-model="groupSearchParams.freq">
                  <option value="一三五">一三五</option>
                  <option value="二四六">二四六</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div class="search-field">
                <label>班別</label>
                <select v-model="groupSearchParams.shift">
                  <option value="early">早班</option>
                  <option value="noon">午班</option>
                  <option value="late">晚班</option>
                </select>
              </div>
              <div class="search-field">
                <label>盤點月份</label>
                <input type="month" v-model="groupSearchParams.month" />
              </div>
            </div>
            <button
              @click="handleConsumptionSearch"
              :disabled="consumptionLoading"
              class="btn-primary"
            >
              {{ consumptionLoading ? '查詢中...' : '查詢耗材' }}
            </button>
            <button
              @click="exportConsumablesToExcel"
              :disabled="consumptionLoading || processedConsumptionData.length === 0"
              class="btn-success"
            >
              匯出 Excel
            </button>
          </div>

          <div class="report-display">
            <div v-if="consumptionLoading" class="loading-state">正在查詢耗材資料...</div>
            <div v-else-if="!consumptionSearchPerformed" class="placeholder-text">
              請選擇條件並點擊查詢。
            </div>
            <div v-else-if="processedConsumptionData.length === 0" class="empty-state">
              查無符合條件的病人或耗材資料。
            </div>
            <div v-else class="table-container consumption-table">
              <table>
                <thead>
                  <tr>
                    <th rowspan="2" class="sticky-col col-freq">頻率</th>
                    <th rowspan="2" class="sticky-col col-shift">班別</th>
                    <th rowspan="2" class="sticky-col col-bed">床號</th>
                    <th rowspan="2" class="sticky-col col-mrn">病歷號</th>
                    <th rowspan="2" class="sticky-col col-name">姓名</th>
                    <th
                      v-if="dynamicHeaders.artificialKidney.length > 0"
                      :colspan="dynamicHeaders.artificialKidney.length"
                    >
                      人工腎臟
                    </th>
                    <th
                      v-if="dynamicHeaders.dialysateCa.length > 0"
                      :colspan="dynamicHeaders.dialysateCa.length"
                    >
                      透析藥水CA
                    </th>
                    <th
                      v-if="dynamicHeaders.bicarbonateType.length > 0"
                      :colspan="dynamicHeaders.bicarbonateType.length"
                    >
                      B液種類
                    </th>
                  </tr>
                  <tr>
                    <th v-for="header in flattenedHeaders" :key="header">{{ header }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in processedConsumptionData" :key="row.patientId">
                    <td class="sticky-col col-freq">{{ row.freq || '-' }}</td>
                    <td class="sticky-col col-shift">{{ formatShift(row.shiftIndex) }}</td>
                    <td class="sticky-col col-bed">{{ row.bedNum || '-' }}</td>
                    <td class="sticky-col col-mrn">{{ row.medicalRecordNumber || '-' }}</td>
                    <td class="sticky-col col-name">{{ row.patientName }}</td>
                    <td v-for="header in flattenedHeaders" :key="header">
                      {{ row.consumableCounts[header] || '' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 當月總量 -->
        <div v-show="consumptionSubTab === 'summary'" class="sub-panel">
          <div class="search-controls">
            <div class="search-field">
              <label>選擇月份</label>
              <input type="month" v-model="summaryMonth" />
            </div>
            <button @click="loadMonthlySummary" :disabled="summaryLoading" class="btn-primary">
              {{ summaryLoading ? '載入中...' : '查詢總量' }}
            </button>
            <button
              @click="exportMonthlySummary"
              :disabled="summaryLoading || !summaryLoaded"
              class="btn-success"
            >
              匯出 Excel
            </button>
          </div>

          <div class="report-display">
            <div v-if="summaryLoading" class="loading-state">正在計算當月消耗總量...</div>
            <div v-else-if="!summaryLoaded" class="placeholder-text">請選擇月份並點擊查詢。</div>
            <div v-else class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>類別</th>
                    <th>品項</th>
                    <th>每箱數量</th>
                    <th>當月消耗(個)</th>
                    <th>當月消耗(箱)</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="category in Object.keys(CATEGORY_NAMES)" :key="category">
                    <tr
                      v-for="item in Object.keys(monthlySummaryData[category] || {})"
                      :key="`summary-${category}-${item}`"
                    >
                      <td>{{ CATEGORY_NAMES[category] }}</td>
                      <td>{{ item }}</td>
                      <td>{{ getUnitsPerBox(category, item) }}</td>
                      <td>{{ monthlySummaryData[category][item] }}</td>
                      <td class="box-cell">
                        {{ calculateBoxes(category, item, monthlySummaryData[category][item]) }}
                      </td>
                    </tr>
                  </template>
                </tbody>
                <tfoot>
                  <tr class="summary-total-row">
                    <td colspan="3"><strong>各類別小計</strong></td>
                    <td colspan="2"></td>
                  </tr>
                  <tr
                    v-for="category in Object.keys(CATEGORY_NAMES)"
                    :key="`total-${category}`"
                    class="category-total"
                  >
                    <td>{{ CATEGORY_NAMES[category] }}</td>
                    <td colspan="2">合計</td>
                    <td>
                      <strong>{{ getCategoryTotal(category) }}</strong>
                    </td>
                    <td class="box-cell">-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        <!-- 資料上傳 -->
        <div v-show="consumptionSubTab === 'upload'" class="sub-panel upload-panel">
          <div class="upload-core-panel">
            <h4>批次上傳每月耗材 Excel</h4>
            <div
              class="upload-drop-zone"
              :class="{ 'is-dragover': isDragOver }"
              @dragover.prevent="isDragOver = true"
              @dragleave.prevent="isDragOver = false"
              @drop.prevent="handleFileDrop"
            >
              <div class="upload-icon">📤</div>
              <h3 v-if="!selectedFile">拖曳 Excel 檔案至此，或點擊按鈕選擇</h3>
              <h3 v-else>
                已選擇檔案：<strong>{{ selectedFile.name }}</strong>
              </h3>
              <p class="upload-hint">
                支援 .xlsx, .xls 格式。請確保標題行包含 '人工腎臟', '透析藥水CA', 或 'B液種類'。
              </p>
              <input
                id="file-input"
                type="file"
                @change="handleFileSelect"
                accept=".xlsx, .xls"
                :disabled="isUploading"
              />
              <label for="file-input" class="file-input-label">
                {{ selectedFile ? '重新選擇檔案' : '選擇檔案' }}
              </label>
            </div>
            <button
              class="btn-primary upload-btn-main"
              @click="handleUpload"
              :disabled="!selectedFile || isUploading"
            >
              {{ isUploading ? '處理中...' : '開始上傳' }}
            </button>
            <div
              v-if="uploadResult"
              class="upload-result-toast"
              :class="uploadResult.errorCount > 0 ? 'has-error' : 'is-success'"
            >
              {{ uploadResult.message }}
            </div>
          </div>
        </div>
      </div>

      <!-- ========== Tab 3: 每月盤點 ========== -->
      <div v-show="activeTab === 'monthly'" class="tab-panel">
        <div class="panel-header">
          <h3>每月盤點</h3>
        </div>

        <div class="filter-bar">
          <div class="filter-field">
            <label>盤點日</label>
            <input type="date" v-model="monthlyFilter.countDate" />
          </div>
          <div class="filter-field">
            <label>盤點區間（起）</label>
            <input type="date" v-model="monthlyFilter.startDate" />
          </div>
          <div class="filter-field">
            <label>盤點區間（迄）</label>
            <input type="date" v-model="monthlyFilter.endDate" />
          </div>
          <button class="btn-primary" @click="calculateMonthlyInventory" :disabled="monthlyLoading">
            {{ monthlyLoading ? '計算中...' : '計算庫存' }}
          </button>
          <button
            class="btn-success"
            @click="saveMonthlyCount"
            :disabled="!monthlyCalculated || monthlyLoading"
          >
            儲存盤點結果
          </button>
        </div>

        <div class="monthly-summary" v-if="monthlyCalculated">
          <div class="summary-card">
            <h4>期初結存</h4>
            <p>{{ monthlyFilter.startDate }} 之前</p>
          </div>
          <div class="summary-card">
            <span class="operator">+</span>
            <h4>區間進貨</h4>
            <p>{{ monthlyFilter.startDate }} ~ {{ monthlyFilter.endDate }}</p>
          </div>
          <div class="summary-card">
            <span class="operator">-</span>
            <h4>區間消耗</h4>
            <p>{{ monthlyFilter.startDate }} ~ {{ monthlyFilter.endDate }}</p>
          </div>
          <div class="summary-card result">
            <span class="operator">=</span>
            <h4>期末結存</h4>
            <p>盤點日：{{ monthlyFilter.countDate }}</p>
          </div>
        </div>

        <div class="table-container" v-if="monthlyCalculated">
          <table>
            <thead>
              <tr>
                <th rowspan="2">類別</th>
                <th rowspan="2">品項</th>
                <th colspan="2">期初結存</th>
                <th colspan="2">區間進貨</th>
                <th colspan="2">區間消耗</th>
                <th colspan="2">期末結存</th>
                <th rowspan="2">調整(個)</th>
              </tr>
              <tr>
                <th>個數</th>
                <th>箱數</th>
                <th>個數</th>
                <th>箱數</th>
                <th>個數</th>
                <th>箱數</th>
                <th>個數</th>
                <th>箱數</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="category in Object.keys(CATEGORY_NAMES)" :key="category">
                <tr v-for="(data, item) in monthlyInventory[category]" :key="`${category}-${item}`">
                  <td>{{ CATEGORY_NAMES[category] }}</td>
                  <td>{{ item }}</td>
                  <td>{{ data.previousStock }}</td>
                  <td class="box-cell">{{ calculateBoxes(category, item, data.previousStock) }}</td>
                  <td class="positive">+{{ data.purchased }}</td>
                  <td class="box-cell positive">
                    +{{ calculateBoxes(category, item, data.purchased) }}
                  </td>
                  <td class="negative">-{{ data.consumed }}</td>
                  <td class="box-cell negative">
                    -{{ calculateBoxes(category, item, data.consumed) }}
                  </td>
                  <td class="result-cell">{{ data.currentStock }}</td>
                  <td class="result-cell box-cell">
                    {{ calculateBoxes(category, item, data.currentStock) }}
                  </td>
                  <td>
                    <input
                      type="number"
                      v-model.number="data.adjustment"
                      class="adjustment-input"
                      placeholder="調整值"
                    />
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div v-else class="placeholder-text">請選擇月份並點擊「計算庫存」。</div>
      </div>

      <!-- ========== Tab 4: 每週訂單 ========== -->
      <div v-show="activeTab === 'weekly'" class="tab-panel">
        <div class="panel-header">
          <h3>每週訂單計算</h3>
          <p class="panel-description">訂購量 = 安全庫存(9天) - 週二盤點 + 預估一週消耗</p>
        </div>

        <div class="filter-bar">
          <div class="filter-field">
            <label>盤點日（週二）</label>
            <input type="date" v-model="weeklyFilter.countDate" />
          </div>
          <div class="filter-field">
            <label>選擇週次</label>
            <input type="week" v-model="weeklyFilter.week" />
          </div>
          <button class="btn-primary" @click="loadWeeklyData" :disabled="weeklyLoading">
            {{ weeklyLoading ? '載入中...' : '載入資料' }}
          </button>
        </div>

        <div v-if="weeklyDataLoaded" class="weekly-content">
          <!-- 週二盤點輸入區 -->
          <div class="weekly-section">
            <div class="section-header">
              <h4>週二盤點輸入 ({{ weeklyFilter.countDate }})</h4>
              <button class="btn-sm btn-primary" @click="saveWeeklyCount" :disabled="weeklyLoading">
                儲存盤點
              </button>
            </div>
            <div class="inventory-grid">
              <template v-for="category in Object.keys(CATEGORY_NAMES)" :key="category">
                <div class="category-section">
                  <h5>{{ CATEGORY_NAMES[category] }}</h5>
                  <div class="item-inputs">
                    <div v-for="item in getItemsForCategory(category)" :key="item" class="item-row">
                      <label>{{ item }}</label>
                      <div class="box-input-group">
                        <input
                          type="number"
                          v-model.number="weeklyCountBoxes[category][item]"
                          placeholder="箱數"
                          min="0"
                          class="box-input"
                        />
                        <span class="box-unit">箱</span>
                        <span class="unit-hint" v-if="weeklyCountBoxes[category]?.[item]">
                          = {{ calculateWeeklyUnits(category, item) }} 個
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- 訂購建議表 -->
          <div class="weekly-section">
            <div class="section-header">
              <h4>訂購建議</h4>
              <button class="btn-success" @click="exportWeeklyOrder" :disabled="!hasOrderData">
                匯出訂單 (以箱為單位)
              </button>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th rowspan="2">類別</th>
                    <th rowspan="2">品項</th>
                    <th rowspan="2">每箱數量</th>
                    <th colspan="2">週二盤點</th>
                    <th colspan="2">預估週消耗</th>
                    <th colspan="2">安全庫存(9天)</th>
                    <th colspan="2">建議訂購量</th>
                  </tr>
                  <tr>
                    <th>個數</th>
                    <th>箱數</th>
                    <th>個數</th>
                    <th>箱數</th>
                    <th>個數</th>
                    <th>箱數</th>
                    <th>個數</th>
                    <th>箱數</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="category in Object.keys(CATEGORY_NAMES)" :key="category">
                    <tr
                      v-for="item in getItemsForCategory(category)"
                      :key="`order-${category}-${item}`"
                    >
                      <td>{{ CATEGORY_NAMES[category] }}</td>
                      <td>{{ item }}</td>
                      <td>{{ getUnitsPerBox(category, item) }}</td>
                      <td>{{ weeklyCount[category]?.[item] || 0 }}</td>
                      <td class="box-cell">
                        {{ calculateBoxes(category, item, weeklyCount[category]?.[item] || 0) }}
                      </td>
                      <td>{{ getWeeklyConsumption(category, item) }}</td>
                      <td class="box-cell">
                        {{ calculateBoxes(category, item, getWeeklyConsumption(category, item)) }}
                      </td>
                      <td>{{ getSafetyStock(category, item) }}</td>
                      <td class="box-cell">
                        {{ calculateBoxes(category, item, getSafetyStock(category, item)) }}
                      </td>
                      <td :class="{ 'need-order': getOrderQuantity(category, item) > 0 }">
                        {{ getOrderQuantity(category, item) }}
                      </td>
                      <td
                        :class="{
                          'need-order': getOrderQuantity(category, item) > 0,
                          'box-cell': true,
                        }"
                      >
                        {{
                          calculateBoxesRounded(category, item, getOrderQuantity(category, item))
                        }}
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div v-else class="placeholder-text">請選擇週次並點擊「載入資料」。</div>
      </div>
    </main>

    <!-- 進貨紀錄 Modal -->
    <div v-if="showPurchaseModal" class="modal-overlay" @click.self="closePurchaseModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ editingPurchase ? '編輯進貨紀錄' : '新增進貨紀錄' }}</h3>
          <button class="modal-close" @click="closePurchaseModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>日期 *</label>
            <input type="date" v-model="purchaseForm.date" required />
          </div>
          <div class="form-field">
            <label>類別 *</label>
            <select v-model="purchaseForm.category" required>
              <option value="">請選擇</option>
              <option value="artificialKidney">人工腎臟</option>
              <option value="dialysateCa">透析藥水CA</option>
              <option value="bicarbonateType">B液種類</option>
            </select>
          </div>
          <div class="form-field">
            <label>品項 *</label>
            <select v-model="purchaseForm.item" required>
              <option value="">請選擇品項</option>
              <option
                v-for="item in getItemSuggestions(purchaseForm.category)"
                :key="item"
                :value="item"
              >
                {{ item }}
              </option>
            </select>
          </div>
          <div class="form-field">
            <label>箱數 *</label>
            <input type="number" v-model.number="purchaseForm.boxQuantity" min="1" required />
            <small class="field-hint" v-if="purchaseForm.item && purchaseForm.boxQuantity">
              =
              {{
                calculateUnits(purchaseForm.category, purchaseForm.item, purchaseForm.boxQuantity)
              }}
              個 (每箱 {{ getUnitsPerBox(purchaseForm.category, purchaseForm.item) }} 個)
            </small>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="closePurchaseModal">取消</button>
          <button class="btn-primary" @click="savePurchase" :disabled="!isPurchaseFormValid">
            {{ editingPurchase ? '更新' : '新增' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 品項設定 Modal -->
    <div v-if="showItemModal" class="modal-overlay" @click.self="closeItemModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>{{ editingItem ? '編輯品項' : '新增品項' }}</h3>
          <button class="modal-close" @click="closeItemModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>類別 *</label>
            <select v-model="itemForm.category" required>
              <option value="">請選擇</option>
              <option value="artificialKidney">人工腎臟</option>
              <option value="dialysateCa">透析藥水CA</option>
              <option value="bicarbonateType">B液種類</option>
            </select>
          </div>
          <div class="form-field">
            <label>品項名稱 *</label>
            <input type="text" v-model="itemForm.name" placeholder="例如：FX80" required />
          </div>
          <div class="form-field">
            <label>院內代碼</label>
            <input type="text" v-model="itemForm.hospitalCode" placeholder="例如：AK-001" />
          </div>
          <div class="form-field">
            <label>每箱個數</label>
            <input
              type="number"
              v-model.number="itemForm.unitsPerBox"
              placeholder="例如：20"
              min="1"
            />
          </div>
          <div class="form-field">
            <label>廠牌</label>
            <input type="text" v-model="itemForm.brand" placeholder="例如：Fresenius" />
          </div>
          <div class="form-field">
            <label>廠商聯絡電話</label>
            <input type="tel" v-model="itemForm.vendorPhone" placeholder="例如：02-12345678" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" @click="closeItemModal">取消</button>
          <button class="btn-primary" @click="saveInventoryItem" :disabled="!isItemFormValid">
            {{ editingItem ? '更新' : '新增' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { systemApi } from '@/services/localApiClient'
import { useAuth } from '@/composables/useAuth'
import { usePatientStore } from '@/stores/patientStore'
import { storeToRefs } from 'pinia'
import * as XLSX from 'xlsx'

// --- 常數 ---
const CATEGORY_NAMES = {
  artificialKidney: '人工腎臟',
  dialysateCa: '透析藥水CA',
  bicarbonateType: 'B液種類',
}
const SHIFT_MAP = { early: 0, noon: 1, late: 2 }
const SHIFT_INDEX_MAP = { 0: '早班', 1: '午班', 2: '晚班' }

// --- Auth & Store ---
const { currentUser } = useAuth()
const patientStore = usePatientStore()
const { opdPatients, patientMap } = storeToRefs(patientStore)

// --- 全局狀態 ---
const activeTab = ref('items')

// ==================== Tab 0: 品項設定 ====================
const inventoryItems = ref([])
const filteredInventoryItems = ref([])
const itemsLoading = ref(false)
const itemFilter = reactive({
  category: '',
  search: '',
})
const showItemModal = ref(false)
const editingItem = ref(null)
const itemForm = reactive({
  category: '',
  name: '',
  unitsPerBox: null,
  hospitalCode: '',
  brand: '',
  vendorPhone: '',
})

const isItemFormValid = computed(() => {
  return itemForm.category && itemForm.name
})

async function fetchInventoryItems() {
  itemsLoading.value = true
  try {
    let results = await systemApi.fetchInventory()

    if (itemFilter.category) {
      results = results.filter((item) => item.category === itemFilter.category)
    }

    inventoryItems.value = results
    filteredInventoryItems.value = results

    // 同步更新 knownItems
    results.forEach((item) => {
      if (!knownItems[item.category].includes(item.name)) {
        knownItems[item.category].push(item.name)
      }
    })
  } catch (error) {
    console.error('載入品項設定失敗:', error)
    // 如果資料庫存取失敗，使用預設品項
    useDefaultItemsAsFallback()
  } finally {
    itemsLoading.value = false
  }
}

// 使用預設品項作為備援
function useDefaultItemsAsFallback() {
  const fallbackItems = []
  let id = 1
  for (const [category, items] of Object.entries(DEFAULT_ITEMS)) {
    for (const itemName of items) {
      fallbackItems.push({
        id: `default-${id++}`,
        category,
        name: itemName,
        unitsPerBox: null,
        hospitalCode: null,
        vendorPhone: null,
        createdBy: '系統預設',
      })
      // 同步更新 knownItems
      if (!knownItems[category].includes(itemName)) {
        knownItems[category].push(itemName)
      }
    }
  }
  inventoryItems.value = fallbackItems
  filteredInventoryItems.value = fallbackItems
}

function filterItems() {
  const search = itemFilter.search.toLowerCase()
  if (!search) {
    filteredInventoryItems.value = inventoryItems.value
  } else {
    filteredInventoryItems.value = inventoryItems.value.filter(
      (item) =>
        item.name.toLowerCase().includes(search) ||
        (item.hospitalCode && item.hospitalCode.toLowerCase().includes(search)),
    )
  }
}

function openItemModal(item = null) {
  if (item) {
    editingItem.value = item
    itemForm.category = item.category
    itemForm.name = item.name
    itemForm.unitsPerBox = item.unitsPerBox || null
    itemForm.hospitalCode = item.hospitalCode || ''
    itemForm.brand = item.brand || ''
    itemForm.vendorPhone = item.vendorPhone || ''
  } else {
    editingItem.value = null
    itemForm.category = ''
    itemForm.name = ''
    itemForm.unitsPerBox = null
    itemForm.hospitalCode = ''
    itemForm.brand = ''
    itemForm.vendorPhone = ''
  }
  showItemModal.value = true
}

function closeItemModal() {
  showItemModal.value = false
  editingItem.value = null
}

async function saveInventoryItem() {
  if (!isItemFormValid.value) return

  try {
    const data = {
      category: itemForm.category,
      name: itemForm.name,
      unitsPerBox: itemForm.unitsPerBox || null,
      hospitalCode: itemForm.hospitalCode || null,
      brand: itemForm.brand || null,
      vendorPhone: itemForm.vendorPhone || null,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser.value?.name || '未知',
    }

    if (editingItem.value) {
      await systemApi.updateInventoryItem(editingItem.value.id, data)
    } else {
      data.createdAt = new Date().toISOString()
      data.createdBy = currentUser.value?.name || '未知'
      await systemApi.createInventoryItem(data)
    }

    // 更新 knownItems
    if (!knownItems[itemForm.category].includes(itemForm.name)) {
      knownItems[itemForm.category].push(itemForm.name)
    }

    closeItemModal()
    await fetchInventoryItems()
    alert(editingItem.value ? '更新成功' : '新增成功')
  } catch (error) {
    console.error('儲存品項失敗:', error)
    alert('儲存失敗: ' + error.message)
  }
}

async function deleteInventoryItem(id) {
  if (!confirm('確定要刪除此品項嗎？此操作不會影響已有的進貨和消耗紀錄。')) return

  try {
    await systemApi.deleteInventoryItem(id)
    await fetchInventoryItems()
    alert('品項已刪除')
  } catch (error) {
    console.error('刪除品項失敗:', error)
    alert('刪除失敗: ' + error.message)
  }
}

// --- 已知品項列表 (從資料庫動態載入) ---
const knownItems = reactive({
  artificialKidney: [],
  dialysateCa: [],
  bicarbonateType: [],
})

// --- 預設品項列表 ---
const DEFAULT_ITEMS = {
  artificialKidney: ['15S', '17UX', '25H', '34', 'APS21S', 'BG1.8', 'CAT/2000', 'FX80', 'HI:23'],
  dialysateCa: ['2.5', '3.0', '3.5'],
  bicarbonateType: ['0_袋裝Bicarbonate 500mg', '1_瓶裝Bicarbonate 500mg', '2_Hemodialysis 5L B液'],
}

// 初始化預設品項（如果資料庫是空的）
async function initializeDefaultItems() {
  try {
    // 使用預設品項填充 knownItems
    for (const [category, items] of Object.entries(DEFAULT_ITEMS)) {
      items.forEach((itemName) => {
        if (!knownItems[category].includes(itemName)) {
          knownItems[category].push(itemName)
        }
      })
    }
    console.log('預設品項已載入')
  } catch (error) {
    console.error('初始化預設品項失敗:', error)
  }
}

// ==================== Tab 1: 進貨紀錄 ====================
const purchases = ref([])
const purchaseLoading = ref(false)
const purchaseFilter = reactive({
  month: new Date().toISOString().slice(0, 7),
  category: '',
})
const showPurchaseModal = ref(false)
const editingPurchase = ref(null)
const purchaseForm = reactive({
  date: new Date().toISOString().slice(0, 10),
  category: '',
  item: '',
  boxQuantity: 1,
})

const isPurchaseFormValid = computed(() => {
  return (
    purchaseForm.date && purchaseForm.category && purchaseForm.item && purchaseForm.boxQuantity > 0
  )
})

// 取得品項的每箱數量
function getUnitsPerBox(category, itemName) {
  const item = inventoryItems.value.find((i) => i.category === category && i.name === itemName)
  return item?.unitsPerBox || 1 // 預設為 1
}

// 計算箱數換算成個數
function calculateUnits(category, itemName, boxQty) {
  const unitsPerBox = getUnitsPerBox(category, itemName)
  return boxQty * unitsPerBox
}

// 計算個數換算成箱數（帶小數）
function calculateBoxes(category, itemName, units) {
  const unitsPerBox = getUnitsPerBox(category, itemName)
  if (unitsPerBox <= 1) return units
  return (units / unitsPerBox).toFixed(1)
}

// 計算個數換算成箱數（四捨五入）
function calculateBoxesRounded(category, itemName, units) {
  const unitsPerBox = getUnitsPerBox(category, itemName)
  if (unitsPerBox <= 1) return units
  return Math.round(units / unitsPerBox)
}

async function fetchPurchases() {
  purchaseLoading.value = true
  try {
    const results = await systemApi.fetchPurchases(purchaseFilter)
    purchases.value = results
  } catch (error) {
    console.error('載入進貨紀錄失敗:', error)
    alert('載入進貨紀錄失敗')
  } finally {
    purchaseLoading.value = false
  }
}

function openPurchaseModal(item = null) {
  if (item) {
    editingPurchase.value = item
    purchaseForm.date = formatDateForInput(item.date)
    purchaseForm.category = item.category
    purchaseForm.item = item.item
    purchaseForm.boxQuantity = item.boxQuantity || 1
  } else {
    editingPurchase.value = null
    purchaseForm.date = new Date().toISOString().slice(0, 10)
    purchaseForm.category = ''
    purchaseForm.item = ''
    purchaseForm.boxQuantity = 1
  }
  showPurchaseModal.value = true
}

function closePurchaseModal() {
  showPurchaseModal.value = false
  editingPurchase.value = null
}

async function savePurchase() {
  if (!isPurchaseFormValid.value) return

  try {
    // 尋找 Item ID
    const targetItem = inventoryItems.value.find(
      (i) => i.category === purchaseForm.category && i.name === purchaseForm.item,
    )

    if (!targetItem) {
      alert('找不到選取的品項資料，請確認品項是否存在。')
      return
    }

    // 計算總個數
    const quantity = calculateUnits(
      purchaseForm.category,
      purchaseForm.item,
      purchaseForm.boxQuantity,
    )

    const data = {
      itemId: targetItem.id,
      quantity: quantity,
      boxQuantity: purchaseForm.boxQuantity, // 傳送箱數供後端參考（若後端有儲存）
      unitPrice: 0, // 目前前端沒輸入，預設 0
      supplier: '', // 目前前端沒輸入
      date: purchaseForm.date,
      notes: '',
    }

    if (editingPurchase.value) {
      await systemApi.updatePurchase(editingPurchase.value.id, data)
    } else {
      await systemApi.createPurchase(data)
    }

    closePurchaseModal()
    await fetchPurchases()
    alert(editingPurchase.value ? '更新成功' : '新增成功')
  } catch (error) {
    console.error('儲存進貨紀錄失敗:', error)
    alert('儲存失敗: ' + error.message)
  }
}

async function deletePurchase(id) {
  if (!confirm('確定要刪除此筆進貨紀錄嗎？')) return

  try {
    await systemApi.deletePurchase(id)
    await fetchPurchases()
    alert('進貨紀錄已刪除')
  } catch (error) {
    console.error('刪除進貨紀錄失敗:', error)
    alert('刪除失敗: ' + error.message)
  }
}

function getItemSuggestions(category) {
  return category ? knownItems[category] : []
}

// ==================== Tab 2: 消耗紀錄 ====================
const consumptionSubTab = ref('query')
const consumptionLoading = ref(false)
const consumptionSearchPerformed = ref(false)
const rawConsumptionData = ref([])
const processedConsumptionData = ref([])
const groupSearchParams = reactive({
  freq: 'other',
  shift: 'early',
  month: new Date().toISOString().slice(0, 7),
})
const dynamicHeaders = ref({
  artificialKidney: [],
  dialysateCa: [],
  bicarbonateType: [],
})

// 上傳相關
const selectedFile = ref(null)
const isUploading = ref(false)
const uploadResult = ref(null)
const isDragOver = ref(false)

// 當月總量相關
const summaryMonth = ref(new Date().toISOString().slice(0, 7))
const summaryLoading = ref(false)
const summaryLoaded = ref(false)
const monthlySummaryData = reactive({
  artificialKidney: {},
  dialysateCa: {},
  bicarbonateType: {},
})

const flattenedHeaders = computed(() => {
  return [
    ...dynamicHeaders.value.artificialKidney,
    ...dynamicHeaders.value.dialysateCa,
    ...dynamicHeaders.value.bicarbonateType,
  ]
})

function formatShift(shiftIndex) {
  return SHIFT_INDEX_MAP[shiftIndex] ?? '-'
}

async function handleConsumptionSearch() {
  consumptionLoading.value = true
  consumptionSearchPerformed.value = true
  rawConsumptionData.value = []
  processedConsumptionData.value = []
  dynamicHeaders.value = { artificialKidney: [], dialysateCa: [], bicarbonateType: [] }

  try {
    const results = await systemApi.fetchConsumablesQuery(groupSearchParams)
    if (results && results.length > 0) {
      processedConsumptionData.value = results
      rawConsumptionData.value = results

      // 重建動態標題
      // 假設每筆資料都有 consumableCounts，且我們需要收集所有的 keys
      const allHeaders = {
        artificialKidney: new Set(),
        dialysateCa: new Set(),
        bicarbonateType: new Set(),
      }

      // 從後端獲取 mapping
      // 這裡暫時用 knownItems 來反查，因為 knownItems 是 category -> items array
      // 建立反向 map
      const itemToCategory = {}
      for (const cat in knownItems) {
        knownItems[cat].forEach((item) => (itemToCategory[item] = cat))
      }

      results.forEach((row) => {
        if (row.consumableCounts) {
          Object.keys(row.consumableCounts).forEach((item) => {
            const cat = itemToCategory[item]
            if (cat && allHeaders[cat]) {
              allHeaders[cat].add(item)
            }
          })
        }
      })

      dynamicHeaders.value = {
        artificialKidney: Array.from(allHeaders.artificialKidney).sort(),
        dialysateCa: Array.from(allHeaders.dialysateCa).sort(),
        bicarbonateType: Array.from(allHeaders.bicarbonateType).sort(),
      }
    }
  } catch (error) {
    console.error('查詢耗材資料失敗:', error)
    alert('查詢耗材資料失敗: ' + error.message)
  } finally {
    consumptionLoading.value = false
  }
}

// ... existing exportConsumablesToExcel ...

async function handleUpload() {
  if (!selectedFile.value) {
    alert('請先選擇一個檔案！')
    return
  }
  
  isUploading.value = true
  uploadResult.value = null

  try {
    const fileData = await selectedFile.value.arrayBuffer()
    const workbook = XLSX.read(fileData)
    const firstSheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[firstSheetName]
    const rows = XLSX.utils.sheet_to_json(worksheet)

    // 解析資料結構
    // 假設 Excel 格式: 頻率, 班別, 床號, 病歷號, 姓名, ...品項
    // 我們需要將它轉換為: { freq, shift, bedNum, ..., consumableCounts: { 'FX80': 1, ... } }
    
    // 簡單實作: 將所有不是基本欄位的當作耗材
    const baseFields = ['頻率', '班別', '床號', '病歷號', '姓名']
    const parsedData = rows.map(row => {
      const consumableCounts = {}
      const mappedRow = {
        freq: row['頻率'],
        shift: row['班別'], // 這裡可能是中文 '早班'
        // 需要轉換為 internal shift code 嗎? 後端 query 篩選是用中文比對
        bedNum: row['床號'],
        medicalRecordNumber: row['病歷號'],
        patientName: row['姓名'],
        consumableCounts
      }
      
      // 處理耗材欄位
      Object.keys(row).forEach(key => {
        if (!baseFields.includes(key)) {
          // 嘗試判斷是否為耗材 (這裡可以加上更嚴謹的 check)
          consumableCounts[key] = row[key]
        }
      })
      
      return mappedRow
    })

    const payload = {
      reportDate: new Date().toISOString(), // 可以在 UI 增加日期選擇，這裡暫時用當下
      reportData: parsedData
    }

    await systemApi.uploadConsumablesReport(payload)
    
    uploadResult.value = { message: '上傳成功！', errorCount: 0 }
    selectedFile.value = null
  } catch (error) {
    console.error('上傳失敗:', error)
    uploadResult.value = { message: '上傳失敗: ' + error.message, errorCount: 1 }
  } finally {
    isUploading.value = false
  }
}

// 當月總量查詢
async function loadMonthlySummary() {
  summaryLoading.value = true
  summaryLoaded.value = false

  // 重置
  for (const category of Object.keys(monthlySummaryData)) {
    monthlySummaryData[category] = {}
  }

  try {
    const consumption = await systemApi.fetchMonthlyConsumptionSummary(summaryMonth.value)

    for (const category of Object.keys(monthlySummaryData)) {
      monthlySummaryData[category] = consumption[category] || {}
    }

    summaryLoaded.value = true
  } catch (error) {
    console.error('載入當月總量失敗:', error)
    alert('載入失敗: ' + error.message)
  } finally {
    summaryLoading.value = false
  }
}

function getCategoryTotal(category) {
  const data = monthlySummaryData[category] || {}
  return Object.values(data).reduce((sum, count) => sum + (count || 0), 0)
}

function exportMonthlySummary() {
  const rows = [['類別', '品項', '每箱數量', '當月消耗(個)', '當月消耗(箱)']]

  for (const category of Object.keys(CATEGORY_NAMES)) {
    const items = monthlySummaryData[category] || {}
    for (const [item, count] of Object.entries(items)) {
      rows.push([
        CATEGORY_NAMES[category],
        item,
        getUnitsPerBox(category, item),
        count,
        calculateBoxes(category, item, count),
      ])
    }
  }

  // 加入小計
  rows.push([])
  rows.push(['類別小計', '', '', '', ''])
  for (const category of Object.keys(CATEGORY_NAMES)) {
    rows.push([CATEGORY_NAMES[category], '合計', '', getCategoryTotal(category), ''])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '當月消耗總量')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `當月消耗總量_${summaryMonth.value}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

// ==================== Tab 3: 每月盤點 ====================
const monthlyLoading = ref(false)
const monthlyCalculated = ref(false)

// 計算本月第一天和最後一天作為預設區間
function getDefaultMonthlyDates() {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstDay = new Date(year, month, 1).toISOString().slice(0, 10)
  const lastDay = new Date(year, month + 1, 0).toISOString().slice(0, 10)
  const countDate = today.toISOString().slice(0, 10)
  return { firstDay, lastDay, countDate }
}

const defaultDates = getDefaultMonthlyDates()
const monthlyFilter = reactive({
  countDate: defaultDates.countDate,
  startDate: defaultDates.firstDay,
  endDate: defaultDates.lastDay,
})
const monthlyInventory = reactive({
  artificialKidney: {},
  dialysateCa: {},
  bicarbonateType: {},
})

async function calculateMonthlyInventory() {
  monthlyLoading.value = true
  monthlyCalculated.value = false

  // 重置
  for (const category of Object.keys(monthlyInventory)) {
    monthlyInventory[category] = {}
  }

  try {
    const start = monthlyFilter.startDate
    const end = monthlyFilter.endDate
    const result = await systemApi.fetchMonthlyCalculation(start, end)
    
    // Fill data
    for (const category of Object.keys(result)) {
      if (monthlyInventory[category]) {
        monthlyInventory[category] = result[category]
      }
    }

    monthlyCalculated.value = true
  } catch (error) {
    console.error('計算庫存失敗:', error)
    alert('計算庫存失敗: ' + error.message)
  } finally {
    monthlyLoading.value = false
  }
}

async function getMonthlyConsumption(month) {
  // 這是給 "當月總量查詢" 用的，其實可以複用 API
  // 但目前 loadMonthlySummary 已經切換到 fetchMonthlyConsumptionSummary
  // 此函數似乎只剩舊引用? Check usage.
  // 搜尋 `loadMonthlySummary` 已經改用 `systemApi.fetchMonthlyConsumptionSummary`
  // 搜尋 `loadWeeklyData` -> 本來呼叫 `getMonthlyConsumption`?
  // 待會 loadWeeklyData 會重寫。
  // 所以這個函數可能不再需要，或保留供相容。
  return systemApi.fetchMonthlyConsumptionSummary(month)
}

// 取得日期區間內的消耗資料 (保留介面，暫無實作需求，API 處理了)
async function getConsumptionByDateRange(startDate, endDate) {
  return {}
}

async function saveMonthlyCount() {
  if (!monthlyCalculated.value) return

  try {
    const payload = {
      countDate: monthlyFilter.countDate,
      counts: monthlyInventory
    }
    
    await systemApi.saveMonthlyCount(payload)
    alert('盤點結果已儲存', payload)
    
  } catch (error) {
    console.error('儲存盤點失敗:', error)
    alert('儲存失敗: ' + error.message)
  }
}

// ==================== Tab 4: 每週訂單 ====================
const weeklyLoading = ref(false)
const weeklyDataLoaded = ref(false)

// 取得本週二的日期
function getThisTuesday() {
  const today = new Date()
  const day = today.getDay()
  const diff = day <= 2 ? 2 - day : 9 - day // 計算到最近的週二
  const tuesday = new Date(today)
  tuesday.setDate(today.getDate() + diff - 7) // 預設取上週二，如果今天是週二則取今天
  if (day === 2) {
    return today.toISOString().slice(0, 10)
  }
  // 如果今天在週二之後，取本週二；否則取上週二
  if (day > 2) {
    tuesday.setDate(today.getDate() - (day - 2))
  } else {
    tuesday.setDate(today.getDate() + (2 - day))
  }
  return tuesday.toISOString().slice(0, 10)
}

const weeklyFilter = reactive({
  countDate: getThisTuesday(),
  week: getISOWeek(new Date()),
})
// 週盤點 - 個數（用於計算）
const weeklyCount = reactive({
  artificialKidney: {},
  dialysateCa: {},
  bicarbonateType: {},
})
// 週盤點 - 箱數（用於輸入）
const weeklyCountBoxes = reactive({
  artificialKidney: {},
  dialysateCa: {},
  bicarbonateType: {},
})
const monthlyConsumptionForWeekly = reactive({
  artificialKidney: {},
  dialysateCa: {},
  bicarbonateType: {},
})

// 計算週盤點的個數（從箱數換算）
function calculateWeeklyUnits(category, item) {
  const boxes = weeklyCountBoxes[category]?.[item] || 0
  const unitsPerBox = getUnitsPerBox(category, item)
  return boxes * unitsPerBox
}

// 同步更新 weeklyCount（個數）
function syncWeeklyCount() {
  for (const category of Object.keys(weeklyCountBoxes)) {
    for (const [item, boxes] of Object.entries(weeklyCountBoxes[category])) {
      const unitsPerBox = getUnitsPerBox(category, item)
      weeklyCount[category][item] = (boxes || 0) * unitsPerBox
    }
  }
}

// 監聽箱數變化，自動同步個數
watch(
  weeklyCountBoxes,
  () => {
    syncWeeklyCount()
  },
  { deep: true },
)

function getISOWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function getItemsForCategory(category) {
  return knownItems[category] || []
}

async function loadWeeklyData() {
  weeklyLoading.value = true
  weeklyDataLoaded.value = false

  // 重置
  for (const category of Object.keys(weeklyCount)) {
    weeklyCount[category] = {}
    weeklyCountBoxes[category] = {}
    monthlyConsumptionForWeekly[category] = {}
  }

  try {
    const date = weeklyFilter.countDate
    // 取得當月月份 (基於 date?)
    const month = date.slice(0, 7)
    
    const { weeklyCounts, monthlyConsumption } = await systemApi.fetchWeeklyData(date, month)
    
    // Fill Monthly Consumption
    if (monthlyConsumption) {
      for (const cat of Object.keys(monthlyConsumptionForWeekly)) {
        if (monthlyConsumption[cat]) {
          monthlyConsumptionForWeekly[cat] = monthlyConsumption[cat]
        }
      }
    }
    
    // Fill Weekly Counts (Convert units to boxes for display)
    if (weeklyCounts) {
       for (const cat of Object.keys(weeklyCountBoxes)) {
         if (weeklyCounts[cat]) {
           for (const [item, units] of Object.entries(weeklyCounts[cat])) {
             weeklyCount[cat][item] = units
             weeklyCountBoxes[cat][item] = calculateBoxesRounded(cat, item, units)
           }
         }
       }
    }

    weeklyDataLoaded.value = true
  } catch (error) {
    console.error('載入週資料失敗:', error)
    alert('載入週資料失敗: ' + error.message)
  } finally {
    weeklyLoading.value = false
  }
}

async function saveWeeklyCount() {
  try {
    // Payload: counts: { category: { item: quantity } }
    // weeklyCount 已經包含 (sync from boxes)
    const payload = {
      countDate: weeklyFilter.countDate,
      counts: weeklyCount
    }
    
    await systemApi.saveWeeklyCount(payload)
    alert('週盤點已儲存')
    
  } catch (error) {
    console.error('儲存週盤點失敗:', error)
    alert('儲存失敗: ' + error.message)
  }
}

function getWeeklyConsumption(category, item) {
  // 預估週消耗 = 月消耗 ÷ 4
  const monthlyTotal = monthlyConsumptionForWeekly[category]?.[item] || 0
  return Math.ceil(monthlyTotal / 4)
}

function getSafetyStock(category, item) {
  // 安全庫存 = 週消耗 × (9/7) ≈ 1.29
  const weeklyConsumption = getWeeklyConsumption(category, item)
  return Math.ceil(weeklyConsumption * (9 / 7))
}

function getOrderQuantity(category, item) {
  // 訂購量 = 安全庫存 - 週二盤點 + 預估週消耗
  const safetyStock = getSafetyStock(category, item)
  const currentStock = weeklyCount[category]?.[item] || 0
  const weeklyConsumption = getWeeklyConsumption(category, item)

  const orderQty = safetyStock - currentStock + weeklyConsumption
  return Math.max(0, orderQty) // 不能為負數
}

const hasOrderData = computed(() => {
  return Object.keys(weeklyCount).some((category) => Object.keys(weeklyCount[category]).length > 0)
})

function exportWeeklyOrder() {
  const rows = [
    [
      '類別',
      '品項',
      '每箱數量',
      '週二盤點(個)',
      '週二盤點(箱)',
      '預估週消耗(個)',
      '安全庫存(個)',
      '建議訂購(個)',
      '建議訂購(箱)',
    ],
  ]

  for (const category of Object.keys(CATEGORY_NAMES)) {
    for (const item of getItemsForCategory(category)) {
      const orderQty = getOrderQuantity(category, item)
      const orderBoxes = calculateBoxesRounded(category, item, orderQty)
      if (orderQty > 0) {
        rows.push([
          CATEGORY_NAMES[category],
          item,
          getUnitsPerBox(category, item),
          weeklyCount[category]?.[item] || 0,
          calculateBoxes(category, item, weeklyCount[category]?.[item] || 0),
          getWeeklyConsumption(category, item),
          getSafetyStock(category, item),
          orderQty,
          orderBoxes,
        ])
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '訂單')

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `每週訂單_${weeklyFilter.week}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

// ==================== 工具函式 ====================
function formatDate(timestamp) {
  if (!timestamp) return '-'
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleDateString('zh-TW')
}

function formatDateForInput(timestamp) {
  if (!timestamp) return ''
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toISOString().slice(0, 10)
}

// ==================== 初始化 ====================
onMounted(async () => {
  await patientStore.fetchPatientsIfNeeded()
  await initializeDefaultItems() // 先初始化預設品項（如果資料庫是空的）
  await fetchInventoryItems() // 載入品項設定
  await fetchPurchases()
  await loadKnownItems()
})

async function loadKnownItems() {
  try {
    // Offline mode: use default items
    // Items will be populated from DEFAULT_ITEMS via initializeDefaultItems
  } catch (error) {
    console.error('載入已知品項失敗:', error)
  }
}
</script>

<style scoped>
/* === 基礎佈局 === */
.page-container {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 2rem);
  padding: 0.5rem;
  background-color: #f8f9fa;
}

.page-header {
  flex-shrink: 0;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid #dee2e6;
}

h1 {
  font-size: 2rem;
  margin: 0;
}

.page-description {
  font-size: 1rem;
  color: #6c757d;
  margin: 0.5rem 0 0 0;
}

/* === Tabs 導航 === */
.tabs-navigation {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
  margin-bottom: -1px;
}

.tabs-navigation button {
  padding: 0.75rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 500;
  border: 1px solid transparent;
  border-bottom: none;
  background-color: transparent;
  color: #6c757d;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
}

.tabs-navigation button.active {
  background-color: #fff;
  color: #007bff;
  border-color: #dee2e6;
}

.tabs-navigation button:hover:not(.active) {
  background-color: #e9ecef;
}

/* === 主內容區 === */
.page-main-content {
  flex-grow: 1;
  background-color: #fff;
  border: 1px solid #dee2e6;
  border-radius: 0 8px 8px 8px;
  display: flex;
  overflow: hidden;
}

.tab-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  overflow: auto;
}

/* === 面板標頭 === */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.panel-header h3 {
  margin: 0;
  font-size: 1.25rem;
}

.panel-description {
  font-size: 0.9rem;
  color: #6c757d;
  margin: 0.25rem 0 0 0;
}

/* === 篩選列 === */
.filter-bar {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.filter-field label {
  font-weight: 500;
  font-size: 0.9rem;
  color: #495057;
}

.filter-field input,
.filter-field select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  min-width: 150px;
  height: 38px;
}

/* === 類別篩選按鈕列 === */
.category-filter-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.category-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid #dee2e6;
  background-color: #f8f9fa;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
}

.category-btn:hover {
  background-color: #e9ecef;
}

.category-btn.active {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}

/* === 按鈕樣式 === */
.btn-primary {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: none;
  background-color: #007bff;
  color: white;
  cursor: pointer;
  height: 38px;
  font-weight: 500;
  transition: background-color 0.2s;
}

.btn-primary:hover {
  background-color: #0056b3;
}

.btn-primary:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.btn-success {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: none;
  background-color: #198754;
  color: white;
  cursor: pointer;
  height: 38px;
  font-weight: 500;
}

.btn-success:hover {
  background-color: #157347;
}

.btn-success:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.5rem 1.5rem;
  border-radius: 4px;
  border: 1px solid #6c757d;
  background-color: #fff;
  color: #6c757d;
  cursor: pointer;
  height: 38px;
}

.btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
}

.btn-edit {
  background-color: #ffc107;
  color: #212529;
  margin-right: 0.5rem;
}

.btn-delete {
  background-color: #dc3545;
  color: white;
}

/* === 表格樣式 === */
.table-container {
  flex-grow: 1;
  overflow: auto;
  border: 1px solid #dee2e6;
  border-radius: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.75rem;
  border: 1px solid #e9ecef;
  text-align: center;
  white-space: nowrap;
}

th {
  background-color: #f8f9fa;
  font-weight: 600;
  position: sticky;
  top: 0;
  z-index: 10;
}

tbody tr:nth-child(even) {
  background-color: #f8f9fa;
}

tbody tr:hover {
  background-color: #e9ecef;
}

/* === 狀態顯示 === */
.loading-state,
.placeholder-text,
.empty-state {
  text-align: center;
  color: #6c757d;
  padding: 3rem;
  font-size: 1.1rem;
}

/* === 消耗紀錄子頁籤 === */
.sub-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.sub-tabs button {
  padding: 0.5rem 1rem;
  border: 1px solid #dee2e6;
  background-color: #f8f9fa;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.sub-tabs button.active {
  background-color: #007bff;
  color: white;
  border-color: #007bff;
}

.sub-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-controls {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e9ecef;
}

.group-filters {
  display: flex;
  gap: 1rem;
}

.search-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.search-field label {
  font-weight: 500;
  font-size: 0.9rem;
  color: #495057;
}

.search-field input,
.search-field select {
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid #ccc;
  min-width: 120px;
  height: 38px;
}

.report-display {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.consumption-table {
  flex: 1;
  overflow: auto;
}

/* === 消耗表格 Sticky 欄位 === */
.sticky-col {
  position: sticky;
  background-color: #f8f9fa;
  z-index: 5;
}

.sticky-col.col-freq {
  left: 0;
  min-width: 70px;
}

.sticky-col.col-shift {
  left: 70px;
  min-width: 70px;
}

.sticky-col.col-bed {
  left: 140px;
  min-width: 70px;
}

.sticky-col.col-mrn {
  left: 210px;
  min-width: 100px;
}

.sticky-col.col-name {
  left: 310px;
  min-width: 100px;
}

tbody .sticky-col {
  background-color: #fff;
}

tbody tr:nth-child(even) .sticky-col {
  background-color: #f8f9fa;
}

/* === 上傳區域 === */
.upload-panel {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 2rem;
}

.upload-core-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  padding: 2rem;
  width: 100%;
  max-width: 600px;
}

.upload-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem;
  border: 2px dashed #adb5bd;
  border-radius: 12px;
  background-color: #f8f9fa;
  width: 100%;
  text-align: center;
  transition: all 0.2s ease-in-out;
}

.upload-drop-zone.is-dragover {
  border-color: #007bff;
  background-color: #e7f1ff;
}

.upload-icon {
  font-size: 3rem;
  color: #007bff;
  margin-bottom: 1rem;
}

.upload-drop-zone h3 {
  margin: 0 0 0.5rem 0;
  color: #495057;
}

.upload-hint {
  color: #6c757d;
  margin: 0 0 1.5rem 0;
}

input[type='file'] {
  display: none;
}

.file-input-label {
  display: inline-block;
  padding: 0.6rem 1.2rem;
  background-color: #fff;
  border: 1px solid #6c757d;
  color: #495057;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.file-input-label:hover {
  background-color: #e9ecef;
}

.upload-btn-main {
  padding: 0.75rem 2rem;
  font-size: 1.1rem;
}

.upload-result-toast {
  width: 100%;
  padding: 1rem;
  border-radius: 6px;
  font-weight: 500;
  text-align: center;
}

.upload-result-toast.is-success {
  color: #155724;
  background-color: #d4edda;
  border: 1px solid #c3e6cb;
}

.upload-result-toast.has-error {
  color: #721c24;
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
}

/* === 每月盤點 === */
.monthly-summary {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.summary-card {
  flex: 1;
  min-width: 150px;
  padding: 1rem;
  background-color: #f8f9fa;
  border-radius: 8px;
  text-align: center;
  position: relative;
}

.summary-card h4 {
  margin: 0 0 0.5rem 0;
  color: #495057;
}

.summary-card p {
  margin: 0;
  font-size: 0.9rem;
  color: #6c757d;
}

.summary-card .operator {
  position: absolute;
  left: -1rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1.5rem;
  font-weight: bold;
  color: #6c757d;
}

.summary-card.result {
  background-color: #d4edda;
}

.summary-card.result h4 {
  color: #155724;
}

.positive {
  color: #198754;
}

.negative {
  color: #dc3545;
}

.result-cell {
  font-weight: bold;
  background-color: #fff3cd;
}

.adjustment-input {
  width: 80px;
  padding: 0.25rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: center;
}

/* === 每週訂單 === */
.weekly-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.weekly-section {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e9ecef;
}

.section-header h4 {
  margin: 0;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}

.category-section {
  background-color: #f8f9fa;
  padding: 1rem;
  border-radius: 8px;
}

.category-section h5 {
  margin: 0 0 1rem 0;
  color: #495057;
  border-bottom: 1px solid #dee2e6;
  padding-bottom: 0.5rem;
}

.item-inputs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.item-row label {
  flex: 1;
  font-size: 0.9rem;
}

.item-row input {
  width: 100px;
  padding: 0.375rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: center;
}

/* === 箱數輸入群組 === */
.box-input-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.box-input {
  width: 70px !important;
}

.box-unit {
  font-size: 0.9rem;
  color: #495057;
}

.unit-hint {
  font-size: 0.85rem;
  color: #6c757d;
}

.need-order {
  background-color: #fff3cd;
  font-weight: bold;
  color: #856404;
}

.box-cell {
  color: #6c757d;
  font-size: 0.9rem;
}

.field-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.85rem;
  color: #6c757d;
}

/* === 當月總量表格 === */
.summary-total-row {
  background-color: #e9ecef;
}

.category-total {
  background-color: #f8f9fa;
}

.category-total td {
  font-weight: 500;
}

tfoot tr:first-child td {
  border-top: 2px solid #dee2e6;
}

/* === Modal === */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: #fff;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
}

.modal-header h3 {
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6c757d;
}

.modal-body {
  padding: 1.5rem;
}

.form-field {
  margin-bottom: 1rem;
}

.form-field label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #495057;
}

.form-field input,
.form-field select {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #dee2e6;
}
</style>
