/**
 * 偏差台账规则（收成一份）
 *
 * 偏差类型、根本原因、纠正措施三本台账的判定口径全部集中在这里：
 *  - 哪些值是现行标准值、哪些旧版写法可以折算、版本优先级谁高；
 *  - 登记 / 调查补录时哪些字段必须写全、编号格式与去重；
 *  - 偏差状态只许顺次推进的流转表。
 * 页面与本地服务只准从这份规则取值，不再各写一套判定。
 */

export type DeviationLedgerField = '偏差类型' | '根本原因' | '纠正措施'

export type DeviationFormField =
  | '偏差编号'
  | '偏差类型'
  | '发生工序'
  | '偏差描述'
  | '关联验证编号'
  | '根本原因'
  | '纠正措施'
  | '责任人'

export interface LedgerRule {
  field: DeviationLedgerField
  /** 台账版本说明，落库与报错都带上，方便核对口径。 */
  version: string
  /** 版本优先级，数值越大越高；同一取值在多本台账撞上时，按高优先级那版折算。 */
  priority: number
  /** 现行标准值，只有折算到这张表里的值才允许保存。 */
  values: string[]
  /** 旧版写法 -> 现行标准值，命中旧版只做折算，不再当成不合规挡下。 */
  aliases: Record<string, string>
}

/**
 * 偏差类型台账优先级高于根本原因台账：
 * 像「环境超标」这种在两本旧版台账里都出现过的写法，撞上时按偏差类型那版折算。
 */
export const DEVIATION_LEDGERS: LedgerRule[] = [
  {
    field: '偏差类型',
    version: '偏差类型台账-2026版',
    priority: 200,
    values: ['人员偏差', '设备偏差', '物料偏差', '环境偏差', '文件偏差', '检验偏差', '生产偏差'],
    aliases: {
      人为差错: '人员偏差',
      设备故障: '设备偏差',
      物料异常: '物料偏差',
      环境超标: '环境偏差',
      文件错误: '文件偏差',
    },
  },
  {
    field: '根本原因',
    version: '根本原因台账-2026版',
    priority: 100,
    values: [
      '未按SOP执行',
      '设备维护不到位',
      '来料质量缺陷',
      '环境监测超标',
      '工艺参数偏离',
      '规程内容缺陷',
      '岗位培训不足',
    ],
    aliases: {
      操作失误: '未按SOP执行',
      环境超标: '环境监测超标',
      培训不足: '岗位培训不足',
    },
  },
  {
    field: '纠正措施',
    version: '纠正措施台账-2026版',
    priority: 50,
    values: [
      '重新培训并考核',
      '检修维护设备',
      '偏差批次复检',
      '修订SOP并培训',
      '加强过程监控',
      '重新清洁消毒',
      '纠正操作并复核',
    ],
    aliases: {
      重新培训: '重新培训并考核',
      设备检修: '检修维护设备',
    },
  },
]

const LEDGER_BY_FIELD: Map<DeviationLedgerField, LedgerRule> = new Map(
  DEVIATION_LEDGERS.map((ledger) => [ledger.field, ledger]),
)

export function ledgerOf(field: DeviationLedgerField): LedgerRule {
  const ledger = LEDGER_BY_FIELD.get(field)
  if (!ledger) {
    throw new Error(`没有找到「${field}」台账规则`)
  }
  return ledger
}

export function standardValues(field: DeviationLedgerField): string[] {
  return [...ledgerOf(field).values]
}

export function legacyAliases(field: DeviationLedgerField): { legacy: string; canonical: string }[] {
  return Object.entries(ledgerOf(field).aliases).map(([legacy, canonical]) => ({ legacy, canonical }))
}

export interface RuleEntry {
  token: string
  canonical: string
  field: DeviationLedgerField
  version: string
  priority: number
  legacy: boolean
}

/**
 * 三本台账合并成的一份总表：同一字面量出现多次（撞上）时，
 * 只保留优先级最高那版；优先级相同按 DEVIATION_LEDGERS 的登记顺序。
 */
function buildConsolidatedEntries(): RuleEntry[] {
  const byToken = new Map<string, RuleEntry>()
  for (const ledger of DEVIATION_LEDGERS) {
    const candidates: RuleEntry[] = [
      ...ledger.values.map((value) => ({
        token: value,
        canonical: value,
        field: ledger.field,
        version: ledger.version,
        priority: ledger.priority,
        legacy: false,
      })),
      ...Object.entries(ledger.aliases).map(([token, canonical]) => ({
        token,
        canonical,
        field: ledger.field,
        version: ledger.version,
        priority: ledger.priority,
        legacy: true,
      })),
    ]
    for (const entry of candidates) {
      const incumbent = byToken.get(entry.token)
      if (!incumbent || entry.priority > incumbent.priority) {
        byToken.set(entry.token, entry)
      }
    }
  }
  return [...byToken.values()]
}

const CONSOLIDATED_ENTRIES = buildConsolidatedEntries()

/** 跨台账按版本优先级裁决一个写法；撞上时返回高优先级那版。 */
export function resolveByLedgerPriority(raw: string): RuleEntry | null {
  const token = raw.trim()
  return CONSOLIDATED_ENTRIES.find((entry) => entry.token === token) ?? null
}

export interface NormalizedValue {
  canonical: string
  version: string
  /** true 表示用的是旧版写法，已折算成现行标准值。 */
  legacy: boolean
}

/**
 * 按某一字段自己的台账折算取值。
 * 自己的台账没收、或写法在更高优先级的另一本台账里（撞版输掉），都返回 null 拦下。
 */
export function normalizeField(field: DeviationLedgerField, raw: string): NormalizedValue | null {
  const token = raw.trim()
  if (!token) {
    return null
  }
  const ledger = ledgerOf(field)
  const own: NormalizedValue | null = ledger.values.includes(token)
    ? { canonical: token, version: ledger.version, legacy: false }
    : ledger.aliases[token]
      ? { canonical: ledger.aliases[token], version: ledger.version, legacy: true }
      : null

  const winner = resolveByLedgerPriority(token)
  if (!own) {
    return winner && winner.field === field
      ? { canonical: winner.canonical, version: winner.version, legacy: winner.legacy }
      : null
  }
  if (!winner || winner.field === field) {
    return own
  }
  // 同一写法撞上了优先级更高的另一本台账：以高优先级版本为准。
  if (ledger.values.includes(winner.canonical)) {
    return { canonical: winner.canonical, version: winner.version, legacy: winner.legacy }
  }
  return null
}

/** 必须写全的字段：偏差类型、根本原因与纠正措施缺一个都不行。 */
export const DEVIATION_REQUIRED_FIELDS: DeviationFormField[] = [
  '偏差编号',
  '偏差类型',
  '发生工序',
  '偏差描述',
  '根本原因',
  '纠正措施',
  '责任人',
]

const LEDGER_FIELDS: DeviationLedgerField[] = ['偏差类型', '根本原因', '纠正措施']

export const DEVIATION_CODE_PATTERN = /^DEVI-\d{4}$/
export const CLEAN_VALIDATION_CODE_PATTERN = /^CLEA-\d{4}$/

export const DEVIATION_INITIAL_STATUS = '待处理'

/**
 * 状态顺次往下推进，倒序 / 跳步一律挡回：
 * 待处理 -> 调查中 -> 已关闭 / 已升级（已关闭、已升级为终态）。
 */
export const DEVIATION_STATUS_FLOW: Record<string, string[]> = {
  待处理: ['调查中'],
  调查中: ['已关闭', '已升级'],
  已关闭: [],
  已升级: [],
}

export function canAdvanceStatus(current: string, target: string): boolean {
  return DEVIATION_STATUS_FLOW[current]?.includes(target) ?? false
}

/** 调查阶段允许补录 / 修改登记内容，终态记录定版。 */
export function canEditDeviation(status: string): boolean {
  return status === '待处理' || status === '调查中'
}

export interface DeviationValidationResult {
  ok: boolean
  errors: string[]
  /** 折算后的标准值，校验通过后才允许落库。 */
  normalized: Partial<Record<DeviationFormField, string>>
  /** 是否用了旧版折算，提示给登记人。 */
  usedLegacy: DeviationLedgerField[]
}

export function validateDeviationDraft(
  input: Partial<Record<DeviationFormField, string>>,
  existingCodes: string[],
  selfCode?: string,
): DeviationValidationResult {
  const errors: string[] = []
  const normalized: Partial<Record<DeviationFormField, string>> = {}
  const usedLegacy: DeviationLedgerField[] = []

  for (const field of DEVIATION_REQUIRED_FIELDS) {
    const raw = String(input[field] ?? '').trim()
    if (!raw) {
      errors.push(`「${field}」不能为空：偏差类型、根本原因与纠正措施必须写全`)
    }
  }

  const code = String(input.偏差编号 ?? '').trim()
  if (code) {
    if (!DEVIATION_CODE_PATTERN.test(code)) {
      errors.push(`偏差编号「${code}」不合规，应按 DEVI-0001 这样的编号规则填写`)
    } else if (existingCodes.some((item) => item === code && item !== selfCode)) {
      errors.push(`偏差编号 ${code} 已登记过，同一条偏差编号重复送审只计一次`)
    } else {
      normalized.偏差编号 = code
    }
  }

  for (const field of LEDGER_FIELDS) {
    const raw = String(input[field] ?? '').trim()
    if (!raw) {
      continue
    }
    const hit = normalizeField(field, raw)
    const ledger = ledgerOf(field)
    if (!hit || !ledger.values.includes(hit.canonical)) {
      if (field === '纠正措施') {
        errors.push(`纠正措施「${raw}」超出${ledger.version}范围，按无效值处理，不允许保存`)
      } else {
        const winner = resolveByLedgerPriority(raw)
        if (winner && winner.field !== field) {
          errors.push(
            `「${raw}」按优先级更高的${winner.version}判定属于${winner.field}取值，不能作为${field}保存`,
          )
        } else {
          errors.push(`「${field}」填的「${raw}」不在${ledger.version}标准内，不允许保存`)
        }
      }
      continue
    }
    normalized[field] = hit.canonical
    if (hit.legacy) {
      usedLegacy.push(field)
    }
  }

  for (const field of ['发生工序', '偏差描述', '责任人'] as const) {
    const value = String(input[field] ?? '').trim()
    if (value) {
      normalized[field] = value
    }
  }

  const linkCode = String(input.关联验证编号 ?? '').trim()
  if (linkCode) {
    if (!CLEAN_VALIDATION_CODE_PATTERN.test(linkCode)) {
      errors.push(`关联验证编号「${linkCode}」不合规，应按 CLEA-0001 这样的编号填写`)
    } else {
      normalized.关联验证编号 = linkCode
    }
  }

  return { ok: errors.length === 0, errors, normalized, usedLegacy }
}
