/**
 * 偏差规则台账：偏差类型、根本原因、纠正措施、发生工序、状态顺序都收成这一份。
 * 登记、送审、关闭时都以这里为准，页面不再各自写死。
 *
 * 同一取值在不同版本/分类里撞车时，priority 数值越大优先级越高，以高优先级那一版为准；
 * status 为 invalid 的条目表示该取值在这一版规则下已作废或超出范围，按无效值处理。
 */

export type RuleField = '偏差类型' | '根本原因' | '纠正措施'
export type RuleStatus = 'valid' | 'invalid'

export type LedgerRule = {
  field: RuleField
  value: string
  status: RuleStatus
  version: string
  priority: number
  /** 旧版写法：命中别名时按本条款归一化到 value，不再拿旧版目录去识别。 */
  aliases?: string[]
  note: string
}

export const DEVIATION_LEDGER: LedgerRule[] = [
  // —— 偏差类型：现行版（2024.2，优先级 20）——
  { field: '偏差类型', value: '生产工艺偏差', status: 'valid', version: '2024.2', priority: 20, note: '现行版类型' },
  { field: '偏差类型', value: '设备设施偏差', status: 'valid', version: '2024.2', priority: 20, note: '现行版类型' },
  { field: '偏差类型', value: '物料与产品偏差', status: 'valid', version: '2024.2', priority: 20, note: '现行版类型' },
  { field: '偏差类型', value: '数据完整性偏差', status: 'valid', version: '2024.2', priority: 20, note: '现行版类型' },
  { field: '偏差类型', value: '环境监测偏差', status: 'valid', version: '2024.2', priority: 20, note: '现行版类型' },

  // —— 偏差类型：旧版（2019.1，优先级 10），旧名称只能作为别名归一化，不再按旧版识别 ——
  {
    field: '偏差类型',
    value: '生产工艺偏差',
    status: 'valid',
    version: '2019.1',
    priority: 10,
    aliases: ['工艺偏差'],
    note: '旧版「工艺偏差」已并入「生产工艺偏差」',
  },
  {
    field: '偏差类型',
    value: '设备设施偏差',
    status: 'valid',
    version: '2019.1',
    priority: 10,
    aliases: ['设备故障'],
    note: '旧版「设备故障」已并入「设备设施偏差」',
  },
  {
    field: '偏差类型',
    value: '物料与产品偏差',
    status: 'valid',
    version: '2019.1',
    priority: 10,
    aliases: ['物料偏差', '物料异常'],
    note: '旧版「物料偏差/物料异常」已并入「物料与产品偏差」',
  },
  // 旧版类型目录里有、现行版作废的取值
  { field: '偏差类型', value: '人为差错', status: 'invalid', version: '2019.1', priority: 10, note: '旧版类型，现行版已作废，按无效值处理' },

  // —— 根本原因（现行版，优先级 10）——
  { field: '根本原因', value: '人员操作失误', status: 'valid', version: '2024.2', priority: 10, note: '根本原因标准项' },
  { field: '根本原因', value: '工艺参数偏离', status: 'valid', version: '2024.2', priority: 10, note: '根本原因标准项' },
  { field: '根本原因', value: '物料质量异常', status: 'valid', version: '2024.2', priority: 10, note: '根本原因标准项' },
  { field: '根本原因', value: '环境条件超标', status: 'valid', version: '2024.2', priority: 10, note: '根本原因标准项' },

  // 「设备故障」同时是旧版偏差类型的别名：两版撞车时按高优先级那一版为准。
  // 这里给根本原因一档更高的优先级，命中冲突时取根本原因口径（仍是有效值，但会标注归一化口径）。
  { field: '根本原因', value: '设备故障', status: 'valid', version: '2024.2-conflict', priority: 30, note: '与旧版偏差类型目录撞车，按高优先级版裁决' },

  // —— 纠正措施：只允许台账范围内的取值，超出范围按无效值 ——
  { field: '纠正措施', value: '设备检修与再验证', status: 'valid', version: '2024.2', priority: 20, note: '纠正措施标准项' },
  { field: '纠正措施', value: '人员再培训与考核', status: 'valid', version: '2024.2', priority: 20, note: '纠正措施标准项' },
  { field: '纠正措施', value: '工艺参数重新确认', status: 'valid', version: '2024.2', priority: 20, note: '纠正措施标准项' },
  { field: '纠正措施', value: '加强清洁与环境监测', status: 'valid', version: '2024.2', priority: 20, note: '纠正措施标准项' },
  { field: '纠正措施', value: '物料隔离与退库处理', status: 'valid', version: '2024.2', priority: 20, note: '纠正措施标准项' },

  // —— 发生工序：偏差必须落在已登记工序上 ——
]

/** 已登记的发生工序（与批生产/清洁台账对齐）。 */
export const DEVIATION_PROCESSES = ['配料', '制粒', '压片', '包衣', '灌装', '轧盖', '包装', '清洁', '灭菌']

/** 偏差状态必须顺次推进的顺序。 */
export const DEVIATION_STATUSES = ['待处理', '调查中', '已关闭', '已升级'] as const
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number]

/** 允许动作只允许从紧邻的上一个状态进入（倒序、跨格都挡回）。 */
export const DEVIATION_ACTION_SOURCE: Record<string, DeviationStatus> = {
  提交调查: '待处理',
  关闭偏差: '调查中',
  升级偏差: '调查中',
}

function normalized(value: string): string {
  return String(value ?? '').trim()
}

export type RuleVerdict = {
  ok: boolean
  /** 归一化后的标准取值；未命中台账时原样返回。 */
  canonical: string
  /** 命中的生效条款（高优先级那一版）。 */
  rule?: LedgerRule
  message?: string
}

/** 按取值找到所有命中的条款（含别名），跨字段一起参与撞车裁决。 */
function matchedRules(raw: string): { rule: LedgerRule; canonical: string }[] {
  const value = normalized(raw)
  const hits: { rule: LedgerRule; canonical: string }[] = []
  for (const rule of DEVIATION_LEDGER) {
    if (normalized(rule.value) === value) {
      hits.push({ rule, canonical: rule.value })
    } else if (rule.aliases?.some((alias) => normalized(alias) === value)) {
      hits.push({ rule, canonical: rule.value })
    }
  }
  return hits
}

/**
 * 按台账裁决一个字段取值。
 * 偏差类型与根本原因撞上（同一取值落在多个分类/版本）时，取优先级最高的那一版为准。
 */
export function resolveRule(field: RuleField, raw: string): RuleVerdict {
  const value = normalized(raw)
  if (!value) {
    return { ok: false, canonical: value, message: `${field}不能为空` }
  }
  const hits = matchedRules(value)
  if (hits.length === 0) {
    if (field === '纠正措施') {
      return { ok: false, canonical: value, message: `纠正措施「${value}」超出台账范围，按无效值处理` }
    }
    return { ok: false, canonical: value, message: `${field}「${value}」不在现行版台账内` }
  }
  // 偏差类型与根本原因撞上（同一取值落在多个分类/版本）时，跨字段一起比，取优先级最高的那一版为准。
  const winner = hits.reduce((best, hit) => (hit.rule.priority > best.rule.priority ? hit : best))
  if (winner.rule.status === 'invalid') {
    return {
      ok: false,
      canonical: winner.canonical,
      rule: winner.rule,
      message: `${field}「${value}」在现行版规则（${winner.rule.version}）下已作废，不允许保存`,
    }
  }
  if (winner.rule.field !== field) {
    return {
      ok: false,
      canonical: winner.canonical,
      rule: winner.rule,
      message: `「${value}」与${winner.rule.field}目录撞车，按优先级更高的${winner.rule.version}版归为${winner.rule.field}，不能作为${field}保存`,
    }
  }
  const aliasNote = winner.canonical !== value ? `（旧版写法「${value}」已归一化为「${winner.canonical}」，不再按旧版识别）` : ''
  return {
    ok: true,
    canonical: winner.canonical,
    rule: winner.rule,
    message: aliasNote || undefined,
  }
}

export function allowedTypeValues(): string[] {
  return uniqueValidValues('偏差类型')
}

export function allowedRootCauseValues(): string[] {
  return uniqueValidValues('根本原因')
}

export function allowedCorrectiveActionValues(): string[] {
  return uniqueValidValues('纠正措施')
}

function uniqueValidValues(field: RuleField): string[] {
  const picked = new Map<string, LedgerRule>()
  for (const rule of DEVIATION_LEDGER) {
    if (rule.field !== field || rule.status !== 'valid') {
      continue
    }
    const current = picked.get(rule.value)
    if (!current || rule.priority > current.priority) {
      picked.set(rule.value, rule)
    }
  }
  return [...picked.keys()]
}
