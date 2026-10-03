<template>
  <section class="page" data-module="deviation">
    <header class="page-head">
      <div>
        <h2>偏差处理管理</h2>
        <p class="page-desc">规则统一按偏差台账执行：偏差类型、根本原因、纠正措施必须写全且在现行版范围内，状态只允许顺次推进。</p>
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
          <td v-for="column in columns" :key="column">
            <button v-if="column === '偏差编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] }}
            </button>
            <span v-else>{{ row[column] || '—' }}</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openEdit(row)" v-if="String(row.status) === '待处理'">编辑</button>
            <button class="link" type="button" @click="openDetail(row)">详情</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无偏差处理数据，可先登记偏差记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条偏差处理记录（按偏差编号去重）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记 / 编辑：字段全部按台账校验，不合规不允许保存 -->
    <div v-if="formVisible" class="modal-mask" @click.self="closeForm">
      <div class="modal">
        <h3 class="modal-title">{{ editingId ? '编辑偏差记录' : '登记偏差记录' }}</h3>
        <div class="form-grid">
          <label class="form-item">
            <span>偏差编号 *</span>
            <input v-model="form.偏差编号" placeholder="DEVI-0007" :disabled="Boolean(editingId)" />
          </label>
          <label class="form-item">
            <span>发生工序 *</span>
            <select v-model="form.发生工序">
              <option value="" disabled>请选择工序</option>
              <option v-for="item in processes" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>偏差类型 *（现行版台账）</span>
            <select v-model="form.偏差类型">
              <option value="" disabled>请选择偏差类型</option>
              <option v-for="item in typeOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>根本原因 *</span>
            <select v-model="form.根本原因">
              <option value="" disabled>请选择根本原因</option>
              <option v-for="item in causeOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item form-wide">
            <span>纠正措施 *（仅台账范围内有效）</span>
            <select v-model="form.纠正措施">
              <option value="" disabled>请选择纠正措施</option>
              <option v-for="item in actionOptions" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
          <label class="form-item form-wide">
            <span>偏差描述 *</span>
            <textarea v-model="form.偏差描述" rows="2" placeholder="请描述偏差现象"></textarea>
          </label>
          <label class="form-item">
            <span>责任人 *</span>
            <input v-model="form.责任人" placeholder="责任人姓名" />
          </label>
        </div>
        <p v-if="formNotice" class="error-text">{{ formNotice }}</p>
        <p v-for="notice in formNotices" :key="notice" class="hint-text">{{ notice }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">保存</button>
        </div>
      </div>
    </div>

    <!-- 详情：每次打开都从存储重新读取，返回后不会再看到旧结论 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <h3 class="modal-title">偏差详情 · {{ String(detail['偏差编号']) }}</h3>
        <dl class="detail-list">
          <div v-for="column in columns" :key="column" class="detail-row">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] || '—' }}</dd>
          </div>
          <div class="detail-row">
            <dt>当前状态</dt>
            <dd>{{ detail.status }}</dd>
          </div>
        </dl>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDetail">返回列表</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createDeviation,
  dedupeByCode,
  runDeviationAction,
  updateDeviation,
  type DeviationDraft,
} from '@/api/deviation-service'
import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  allowedCorrectiveActionValues,
  allowedRootCauseValues,
  allowedTypeValues,
  DEVIATION_ACTION_SOURCE,
  DEVIATION_PROCESSES,
} from '@/data/deviation-ledger'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('deviation')
const columns = ['偏差编号', '偏差类型', '发生工序', '偏差描述', '根本原因', '纠正措施', '责任人', '偏差状态']
const filterFields = columns.slice(0, 3)

const processes = DEVIATION_PROCESSES
const typeOptions = allowedTypeValues()
const causeOptions = allowedRootCauseValues()
const actionOptions = allowedCorrectiveActionValues()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  ['待处理', '调查中', '已关闭', '已升级'].map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待处理偏差', value: rows.value.filter((row) => String(row.status) === '待处理').length },
  { label: '调查中偏差', value: rows.value.filter((row) => String(row.status) === '调查中').length },
  { label: '本月关闭数', value: rows.value.filter((row) => String(row.status) === '已关闭').length },
])

const emptyForm = (): DeviationDraft => ({
  偏差编号: '',
  偏差类型: '',
  发生工序: '',
  偏差描述: '',
  根本原因: '',
  纠正措施: '',
  责任人: '',
})

const formVisible = ref(false)
const editingId = ref<number | null>(null)
const form = ref<DeviationDraft>(emptyForm())
const formNotice = ref('')
const formNotices = ref<string[]>([])
const detail = ref<EntryRow | null>(null)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function availableActions(row: EntryRow) {
  return Object.entries(DEVIATION_ACTION_SOURCE)
    .filter(([, source]) => source === String(row.status))
    .map(([action]) => action)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = runDeviationAction(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  formNotice.value = ''
  formNotices.value = []
  formVisible.value = true
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  form.value = {
    偏差编号: String(row['偏差编号'] ?? ''),
    偏差类型: String(row['偏差类型'] ?? ''),
    发生工序: String(row['发生工序'] ?? ''),
    偏差描述: String(row['偏差描述'] ?? ''),
    根本原因: String(row['根本原因'] ?? ''),
    纠正措施: String(row['纠正措施'] ?? ''),
    责任人: String(row['责任人'] ?? ''),
  }
  formNotice.value = ''
  formNotices.value = []
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
}

function submitForm() {
  formNotice.value = ''
  formNotices.value = []
  const result = editingId.value === null
    ? createDeviation(form.value)
    : updateDeviation(editingId.value, form.value)
  if (!result.ok) {
    formNotice.value = result.message
    return
  }
  formNotices.value = result.notices ?? []
  formVisible.value = false
  reload()
}

function openDetail(row: EntryRow) {
  // 从数据层实时取这一条：上一次打开缓存的旧结论不会再带出来。
  const fresh = listEntries(meta.key).items.find((item) => Number(item.id) === Number(row.id))
  detail.value = fresh ?? row
}

function closeDetail() {
  detail.value = null
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = dedupeByCode(payload.items)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '偏差处理列表读取失败'
  }
}

onMounted(reload)
</script>
