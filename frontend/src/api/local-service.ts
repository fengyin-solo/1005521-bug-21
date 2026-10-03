import { MODULE_BY_KEY } from '@/data/modules'
import {
  DEVIATION_INITIAL_STATUS,
  canAdvanceStatus,
  canEditDeviation,
  ledgerOf,
  validateDeviationDraft,
} from '@/data/deviation-rules'
import type { DeviationFormField, DeviationLedgerField } from '@/data/deviation-rules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

const DEVIATION_KEY = 'deviation'
const CLEAN_VALIDATION_KEY = 'cleanvalidate'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 同一份记录重复显示时，按 id 去重，只保留最先落库的那条，列表始终与明细一致。
function dedupeById(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<number>()
  return rows.filter((row) => {
    const id = Number(row.id)
    if (seen.has(id)) {
      return false
    }
    seen.add(id)
    return true
  })
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(dedupeById(listRows(key)), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = dedupeById(listRows(key))
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)

  // 偏差模块按台账流转表：状态顺次往下推进，倒序 / 跳步挡回。
  if (key === DEVIATION_KEY) {
    if (current === target) {
      return { ok: false, message: `偏差记录已经是「${target}」，同一条偏差重复送审只算一次` }
    }
    if (!canAdvanceStatus(current, target)) {
      return {
        ok: false,
        message: `偏差记录当前「${current}」不能直接${action}到「${target}」：状态只能顺次推进，倒序与跳步已挡回`,
      }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)

  // 偏差关闭即调查结案：把结果回写到清洁验证台账，纠正措施以偏差台账为准。
  if (key === DEVIATION_KEY && target === '已关闭') {
    const warnings = writeDeviationResultBack(updated)
    return {
      ok: true,
      message: `${meta.entity}已${action}，当前状态「${target}」，结果已回写清洁验证台账`,
      warnings,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 关闭偏差时把结果回写到清洁验证台账：
 * 关联验证编号命中哪一条，就把偏差结论与纠正措施写到那条清洁验证记录上。
 */
function writeDeviationResultBack(deviation: EntryRow): string[] {
  const linkCode = String(deviation.关联验证编号 ?? '').trim()
  if (!linkCode) {
    return []
  }
  const rows = dedupeById(listRows(CLEAN_VALIDATION_KEY))
  const index = rows.findIndex((row) => String(row.验证编号).trim() === linkCode)
  if (index < 0) {
    return [`没有在清洁验证台账找到 ${linkCode}，结果未落账，请核对关联验证编号`]
  }
  const linked = rows[index]
  const deviationCode = String(deviation.偏差编号 ?? '').trim()
  const nextRows = [...rows]
  nextRows[index] = {
    ...linked,
    关联偏差编号: deviationCode,
    检测结果: `关联偏差 ${deviationCode} 已关闭；偏差类型：${deviation.偏差类型 ?? ''}；根本原因：${deviation.根本原因 ?? ''}；纠正措施：${deviation.纠正措施 ?? ''}`,
  }
  saveRows(CLEAN_VALIDATION_KEY, nextRows)
  return []
}

/**
 * 纠正措施在两处（偏差明细 / 清洁验证台账）读的是同一份：
 * 清洁验证台账不另存纠正措施，始终按关联偏差编号回偏差台账取，保证两处一致。
 */
export function linkedDeviationCorrectiveAction(linkCode: string): {
  corrective: string
  deviationStatus: string
} | null {
  const code = linkCode.trim()
  if (!code) {
    return null
  }
  const hit = listRows(DEVIATION_KEY).find((row) => String(row.偏差编号).trim() === code)
  if (!hit) {
    return null
  }
  return {
    corrective: String(hit.纠正措施 ?? ''),
    deviationStatus: String(hit.status ?? ''),
  }
}

function nextDeviationId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

type DeviationDraft = Partial<Record<DeviationFormField, string>>

export function getDeviation(id: number): EntryRow | null {
  return listRows(DEVIATION_KEY).find((row) => Number(row.id) === id) ?? null
}

export function toDeviationDraft(row: EntryRow): DeviationDraft {
  const fields: DeviationFormField[] = [
    '偏差编号',
    '偏差类型',
    '发生工序',
    '偏差描述',
    '关联验证编号',
    '根本原因',
    '纠正措施',
    '责任人',
  ]
  const draft: DeviationDraft = {}
  for (const field of fields) {
    draft[field] = String(row[field] ?? '')
  }
  return draft
}

function legacyWarnings(fields: DeviationLedgerField[]): string[] {
  return fields.map((field) => {
    const ledger = ledgerOf(field)
    return `「${field}」按${ledger.version}折算后保存，旧版写法不再当作不合规拦截`
  })
}

/** 登记偏差记录：登记与调查补录共用同一份台账校验，没按标准填的一律不允许保存。 */
export function saveDeviationDraft(input: DeviationDraft, id?: number): ActionResult {
  const rows = dedupeById(listRows(DEVIATION_KEY))
  const index = id === undefined ? -1 : rows.findIndex((row) => Number(row.id) === id)
  const self = index >= 0 ? rows[index] : undefined
  if (id !== undefined && index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  if (self && !canEditDeviation(String(self.status))) {
    return { ok: false, message: `偏差记录已是「${self.status}」，内容定版，不能再修改` }
  }

  const existingCodes = rows
    .filter((row) => Number(row.id) !== id)
    .map((row) => String(row.偏差编号 ?? '').trim())
  const result = validateDeviationDraft(input, existingCodes, self ? String(self.偏差编号) : undefined)
  if (!result.ok) {
    return { ok: false, message: result.errors.join('；') }
  }

  const normalized = result.normalized
  const next: EntryRow = {
    ...(self ?? {}),
    id: self ? Number(self.id) : nextDeviationId(rows),
    status: self ? String(self.status) : DEVIATION_INITIAL_STATUS,
    pending: self ? Boolean(self.pending) : true,
    abnormal: self ? Boolean(self.abnormal) : false,
    偏差编号: normalized.偏差编号 ?? '',
    偏差类型: normalized.偏差类型 ?? '',
    发生工序: normalized.发生工序 ?? '',
    偏差描述: normalized.偏差描述 ?? '',
    关联验证编号: normalized.关联验证编号 ?? '',
    根本原因: normalized.根本原因 ?? '',
    纠正措施: normalized.纠正措施 ?? '',
    责任人: normalized.责任人 ?? '',
  }
  const nextRows = index >= 0 ? rows.map((row, at) => (at === index ? next : row)) : [...rows, next]
  saveRows(DEVIATION_KEY, nextRows)
  return {
    ok: true,
    message: self ? `偏差记录 ${next.偏差编号} 已按标准补录保存` : `偏差记录 ${next.偏差编号} 已登记，状态「${next.status}」`,
    warnings: legacyWarnings(result.usedLegacy),
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
