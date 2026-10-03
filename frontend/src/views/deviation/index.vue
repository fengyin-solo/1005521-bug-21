<template>
  <section class="page" data-module="deviation">
    <header class="page-head">
      <div>
        <h2>偏差处理管理</h2>
        <p class="page-desc">按统一偏差台账登记：偏差类型、根本原因、纠正措施必须写全并取自标准台账；状态顺次推进，关闭后结果回写清洁验证台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记偏差记录</button>
        <button class="btn" type="button" @click="exportRows">导出偏差处理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看详情</button>
            <button
              v-if="editable(row.status)"
              class="link"
              type="button"
              @click="openEdit(row)"
            >
              调查补录
            </button>
            <button
              v-for="action in availableActions(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无偏差处理数据，可先登记偏差记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条偏差处理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="warningMessage" class="warning-text">{{ warningMessage }}</span>
    </footer>

    <div v-if="editorOpen" class="modal-mask" @click.self="closeEditor">
      <div class="modal-card">
        <h3 class="modal-title">{{ editingId === null ? '登记偏差记录' : '调查补录' }}</h3>
        <p class="modal-tip">
          标准取自{{ ledgerVersion('偏差类型') }}、{{ ledgerVersion('根本原因') }}、{{ ledgerVersion('纠正措施') }}；
          偏差类型、根本原因与纠正措施须写全，纠正措施超出范围按无效值，不允许保存。
        </p>
        <div class="form-grid">
          <label class="form-cell">
            <span>偏差编号 <em>*</em></span>
            <input
              v-model="form.偏差编号"
              placeholder="DEVI-0001"
              :disabled="editingId !== null"
            />
          </label>
          <label class="form-cell">
            <span>发生工序 <em>*</em></span>
            <input v-model="form.发生工序" placeholder="如：灌装机清洁后取样" />
          </label>
          <label class="form-cell">
            <span>偏差类型 <em>*</em></span>
            <select v-model="form.偏差类型">
              <option value="" disabled>请选择（旧版写法会自动折算）</option>
              <optgroup label="现行标准值">
                <option v-for="value in typeOptions" :key="value" :value="value">{{ value }}</option>
              </optgroup>
              <optgroup label="旧版写法（保存时折算）">
                <option v-for="item in legacyTypeOptions" :key="item.legacy" :value="item.legacy">
                  {{ item.legacy }} → {{ item.canonical }}
                </option>
              </optgroup>
            </select>
          </label>
          <label class="form-cell">
            <span>关联验证编号</span>
            <input v-model="form.关联验证编号" placeholder="选填，如 CLEA-0001；关闭时回写清洁验证台账" />
          </label>
          <label class="form-cell form-wide">
            <span>偏差描述 <em>*</em></span>
            <textarea v-model="form.偏差描述" rows="2" placeholder="描述偏差经过"></textarea>
          </label>
          <label class="form-cell">
            <span>根本原因 <em>*</em></span>
            <select v-model="form.根本原因">
              <option value="" disabled>请选择根本原因</option>
              <option v-for="value in reasonOptions" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
          <label class="form-cell">
            <span>纠正措施 <em>*</em></span>
            <select v-model="form.纠正措施">
              <option value="" disabled>请选择纠正措施</option>
              <option v-for="value in actionOptions" :key="value" :value="value">{{ value }}</option>
            </select>
          </label>
          <label class="form-cell">
            <span>责任人 <em>*</em></span>
            <input v-model="form.责任人" placeholder="责任人姓名" />
          </label>
        </div>
        <p v-if="editorError" class="error-text form-error">{{ editorError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeEditor">取消</button>
          <button class="btn primary" type="button" @click="submitForm">保存</button>
        </div>
      </div>
    </div>

    <div v-if="detailRow" class="modal-mask" @click.self="closeDetail">
      <div class="modal-card">
        <h3 class="modal-title">偏差详情 · {{ detailRow.偏差编号 }}</h3>
        <dl class="detail-grid">
          <template v-for="column in detailFields" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ displayCell(detailRow, column) }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <div class="modal-actions">
          <button
            v-if="editable(detailRow.status)"
            class="btn primary"
            type="button"
            @click="openEdit(detailRow)"
          >
            调查补录
          </button>
          <button class="btn" type="button" @click="closeDetail">返回列表</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  getDeviation,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveDeviationDraft,
  toDeviationDraft,
} from '@/api/local-service'
import {
  canAdvanceStatus,
  canEditDeviation,
  legacyAliases,
  ledgerOf,
  standardValues,
} from '@/data/deviation-rules'
import type { DeviationFormField } from '@/data/deviation-rules'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('deviation')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
const detailFields = columns

const typeOptions = standardValues('偏差类型')
const reasonOptions = standardValues('根本原因')
const actionOptions = standardValues('纠正措施')
const legacyTypeOptions = legacyAliases('偏差类型')

function ledgerVersion(field: '偏差类型' | '根本原因' | '纠正措施'): string {
  return ledgerOf(field).version
}
function editable(status: string): boolean {
  return canEditDeviation(status)
}

// 列表只给当前状态真正能推进的动作，倒序 / 跳步的不渲染，点了也会被服务层挡回。
function availableActions(status: string): string[] {
  return actions.filter((action) => canAdvanceStatus(status, meta.actionTargets[action]))
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const warningMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['偏差编号', '偏差类型', '发生工序']

const stats = computed(() => [
  { label: '待处理偏差', value: rows.value.filter((row) => row.status === '待处理').length },
  { label: '调查中偏差', value: rows.value.filter((row) => row.status === '调查中').length },
  { label: '本月关闭数', value: rows.value.filter((row) => row.status === '已关闭').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 「偏差状态」是业务字段，台账统一以记录的实际状态为准，避免落库那条与明细对不上。
function displayCell(row: EntryRow, column: string): string {
  if (column === '偏差状态') {
    return String(row.status ?? '—')
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  warningMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  warningMessage.value = result.warnings?.length ? result.warnings.join('；') : ''
  reload()
  if (detailRow.value && Number(detailRow.value.id) === Number(row.id)) {
    detailRow.value = getDeviation(Number(row.id))
  }
}

function reload() {
  errorMessage.value = ''
  warningMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '偏差处理列表读取失败'
  }
}

function emptyForm(): Record<DeviationFormField, string> {
  return {
    偏差编号: '',
    偏差类型: '',
    发生工序: '',
    偏差描述: '',
    关联验证编号: '',
    根本原因: '',
    纠正措施: '',
    责任人: '',
  }
}

const editorOpen = ref(false)
const editingId = ref<number | null>(null)
const editorError = ref('')
const form = reactive<Record<DeviationFormField, string>>(emptyForm())

function openCreate() {
  errorMessage.value = ''
  warningMessage.value = ''
  Object.assign(form, emptyForm())
  editingId.value = null
  editorError.value = ''
  editorOpen.value = true
}

function openEdit(row: EntryRow) {
  errorMessage.value = ''
  warningMessage.value = ''
  Object.assign(form, emptyForm(), toDeviationDraft(row))
  editingId.value = Number(row.id)
  editorError.value = ''
  editorOpen.value = true
  detailRow.value = null
}

function closeEditor() {
  editorOpen.value = false
}

function submitForm() {
  editorError.value = ''
  const result = saveDeviationDraft({ ...form }, editingId.value ?? undefined)
  if (!result.ok) {
    editorError.value = result.message
    return
  }
  editorOpen.value = false
  warningMessage.value = result.warnings?.length ? result.warnings.join('；') : ''
  reload()
}

// 详情每次都按 id 现取，关闭弹窗返回列表时 reload，始终显示最新结论，不会停在旧版结论上。
const detailRow = ref<EntryRow | null>(null)

function openDetail(row: EntryRow) {
  errorMessage.value = ''
  warningMessage.value = ''
  detailRow.value = getDeviation(Number(row.id)) ?? row
}

function closeDetail() {
  detailRow.value = null
  reload()
}

onMounted(reload)
</script>
