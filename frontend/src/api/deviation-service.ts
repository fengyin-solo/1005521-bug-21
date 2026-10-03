import { listRows, saveRows } from '@/data/local-store'
import {
  DEVIATION_ACTION_SOURCE,
  DEVIATION_PROCESSES,
  DEVIATION_STATUSES,
  resolveRule,
  type DeviationStatus,
} from '@/data/deviation-ledger'
import type { ActionResult, EntryRow } from '@/data/types'

// 偏差模块的所有读写都收口在这里：规则走偏差台账，落库值与表单提交值保持一致。

const MODULE_KEY = 'deviation'
const CLEAN_VALIDATE_KEY = 'cleanvalidate'
const CODE_PATTERN = /^DEVI-\d{4}$/

export type DeviationDraft = {
  偏差编号: string
  偏差类型: string
  发生工序: string
  偏差描述: string
  根本原因: string
  纠正措施: string
  责任人: string
}

export type SaveResult = ActionResult & { row?: EntryRow; notices?: string[] }

function cleanDraft(input: Partial<DeviationDraft>): DeviationDraft {
  return {
    偏差编号: String(input.偏差编号 ?? '').trim(),
    偏差类型: String(input.偏差类型 ?? '').trim(),
    发生工序: String(input.发生工序 ?? '').trim(),
    偏差描述: String(input.偏差描述 ?? '').trim(),
    根本原因: String(input.根本原因 ?? '').trim(),
    纠正措施: String(input.纠正措施 ?? '').trim(),
    责任人: String(input.责任人 ?? '').trim(),
  }
}

/** 按台账规则校验并归一化整份记录：缺项、旧版类型、超范围纠正措施一律不允许保存。 */
export function validateDeviation(input: Partial<DeviationDraft>, ignoreId?: number): SaveResult {
  const draft = cleanDraft(input)
  const notices: string[] = []

  if (!CODE_PATTERN.test(draft.偏差编号)) {
    return { ok: false, message: '偏差编号必须是 DEVI- 开头加 4 位数字（如 DEVI-0007）' }
  }
  const duplicated = listRows(MODULE_KEY).some(
    (row) => String(row['偏差编号']) === draft.偏差编号 && Number(row.id) !== ignoreId,
  )
  if (duplicated) {
    return { ok: false, message: `偏差编号 ${draft.偏差编号} 已登记，同一条偏差不允许重复保存` }
  }

  if (!DEVIATION_PROCESSES.includes(draft.发生工序)) {
    return { ok: false, message: `发生工序「${draft.发生工序}」不在已登记工序列表内` }
  }
  if (!draft.偏差描述) {
    return { ok: false, message: '偏差描述不能为空' }
  }
  if (!draft.责任人) {
    return { ok: false, message: '责任人不能为空' }
  }

  // 偏差类型、根本原因、纠正措施必须写全且按台账裁决。
  const typeVerdict = resolveRule('偏差类型', draft.偏差类型)
  if (!typeVerdict.ok) {
    return { ok: false, message: typeVerdict.message ?? '偏差类型不合规' }
  }
  if (typeVerdict.message) {
    notices.push(typeVerdict.message)
  }
  const causeVerdict = resolveRule('根本原因', draft.根本原因)
  if (!causeVerdict.ok) {
    return { ok: false, message: causeVerdict.message ?? '根本原因不合规' }
  }
  const actionVerdict = resolveRule('纠正措施', draft.纠正措施)
  if (!actionVerdict.ok) {
    return { ok: false, message: actionVerdict.message ?? '纠正措施不合规' }
  }

  const row: EntryRow = {
    id: ignoreId ?? 0,
    status: '待处理',
    pending: true,
    abnormal: false,
    偏差编号: draft.偏差编号,
    偏差类型: typeVerdict.canonical,
    发生工序: draft.发生工序,
    偏差描述: draft.偏差描述,
    根本原因: causeVerdict.canonical,
    纠正措施: actionVerdict.canonical,
    责任人: draft.责任人,
    偏差状态: '待处理',
  }
  return { ok: true, message: '', row, notices }
}

/** 登记新偏差：编号唯一 + 台账校验，全部通过才落库，并把纠正措施同步到清洁验证台账。 */
export function createDeviation(input: Partial<DeviationDraft>): SaveResult {
  const result = validateDeviation(input)
  if (!result.ok || !result.row) {
    return result
  }
  const rows = listRows(MODULE_KEY)
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = { ...result.row, id: nextId }
  saveRows(MODULE_KEY, [...rows, row])
  syncCorrectiveAction(row)
  return { ok: true, message: `偏差 ${String(row['偏差编号'])} 已登记`, row, notices: result.notices }
}

/** 修改待处理偏差：落库字段与明细严格一致，不允许把关键字段改空。 */
export function updateDeviation(id: number, input: Partial<DeviationDraft>): SaveResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  const current = rows[index]
  if (String(current.status) !== '待处理') {
    return { ok: false, message: `偏差已进入「${String(current.status)}」，关键字段不允许再修改` }
  }
  const result = validateDeviation(input, id)
  if (!result.ok || !result.row) {
    return result
  }
  const row: EntryRow = { ...result.row, id, status: current.status, pending: current.pending, abnormal: current.abnormal }
  const next = [...rows]
  next[index] = row
  saveRows(MODULE_KEY, next)
  syncCorrectiveAction(row)
  return { ok: true, message: `偏差 ${String(row['偏差编号'])} 已更新`, row, notices: result.notices }
}

/**
 * 偏差动作：状态只能顺次往下推进，倒序、跨格、重复送审都挡回。
 * 关闭/升级后把处理结果回写到清洁验证台账。
 */
export function runDeviationAction(id: number, action: string): ActionResult {
  const requiredSource = DEVIATION_ACTION_SOURCE[action]
  if (!requiredSource) {
    return { ok: false, message: `偏差处理没有登记「${action}」这个动作` }
  }
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的偏差记录` }
  }
  const current = rows[index]
  const currentStatus = String(current.status) as DeviationStatus
  if (currentStatus !== requiredSource) {
    if (action === '提交调查' && DEVIATION_STATUSES.indexOf(currentStatus) > DEVIATION_STATUSES.indexOf('调查中')) {
      return { ok: false, message: `偏差已是「${currentStatus}」，状态不能倒序，重复送审只算一次` }
    }
    if (action === '提交调查' && currentStatus === '调查中') {
      return { ok: false, message: `偏差 ${String(current['偏差编号'])} 已送审，同一条偏差编号重复送审只算一次` }
    }
    return { ok: false, message: `偏差当前为「${currentStatus}」，只能从「${requiredSource}」执行「${action}」，不允许倒序或跨格推进` }
  }

  const target = action === '关闭偏差' ? '已关闭' : action === '升级偏差' ? '已升级' : '调查中'
  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target === '调查中',
    abnormal: false,
    偏差状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(MODULE_KEY, next)
  syncCorrectiveAction(updated, target)
  return { ok: true, message: `偏差 ${String(updated['偏差编号'])} 已${action}，当前状态「${target}」` }
}

/**
 * 把偏差纠正措施（及关闭结果）回写到清洁验证台账中关联同一偏差编号的记录。
 * 纠正措施只有偏差台账这一个出处，两处读出来的值始终是同一份。
 */
function syncCorrectiveAction(deviation: EntryRow, result?: string): void {
  const code = String(deviation['偏差编号'] ?? '')
  const correctiveAction = String(deviation['纠正措施'] ?? '')
  const cleanRows = listRows(CLEAN_VALIDATE_KEY)
  let touched = false
  const next = cleanRows.map((row) => {
    if (String(row['关联偏差编号'] ?? '') !== code) {
      return row
    }
    touched = true
    return {
      ...row,
      偏差纠正措施: correctiveAction,
      ...(result ? { 偏差处理结果: result === '已关闭' ? `偏差${code}已关闭` : `偏差${code}已升级` } : {}),
    }
  })
  if (touched) {
    saveRows(CLEAN_VALIDATE_KEY, next)
  }
}

/** 列表按偏差编号去重：同一编号只保留一条，避免同一份记录重复显示。 */
export function dedupeByCode(rows: EntryRow[]): EntryRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const code = String(row['偏差编号'] ?? '')
    if (seen.has(code)) {
      return false
    }
    seen.add(code)
    return true
  })
}
