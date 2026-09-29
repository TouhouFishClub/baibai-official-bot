const DATE_TOKEN = /^\d{4}-\d{1,2}-\d{1,2}$/
const pad2 = n => (n < 10 ? '0' + n : '' + n)

const dateKey = d => {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`
}

const enumerateDays = (start, end) => {
  const days = []
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0)
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0)
  while (d <= last) {
    days.push(dateKey(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

const escHtml = s =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const partToRegex = part =>
  part.replace(/([.+?^${}()|[\]\\])/g, '\\$1').replace(/%/g, '.*')

const parseDateStart = s => {
  const t = s.trim()
  if (!DATE_TOKEN.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0)
  return isNaN(dt.getTime()) ? null : dt
}

const parseDateEnd = s => {
  const t = s.trim()
  if (!DATE_TOKEN.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999)
  return isNaN(dt.getTime()) ? null : dt
}

const isDateToken = s => DATE_TOKEN.test(s.trim())

const rangeDefaultThreeMonths = () => {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0)
  start.setMonth(start.getMonth() - 3)
  return { start, end }
}

/** 与 mbtvStats / mbzzStats 一致的时间 + 关键词解析；关键词内勿夹杂未转义空格分段时间（首个非日期 token 为关键词） */
const parseMbcdsArgs = raw => {
  const args = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (args.length === 0) {
    // 无参数：默认近 3 个月的“总览统计”
    const { start, end } = rangeDefaultThreeMonths()
    return { start, end, keyword: null }
  }

  if (args.length === 1) {
    if (isDateToken(args[0])) {
      const start = parseDateStart(args[0])
      if (!start) return { error: '开始时间格式无效，请使用 2026-1-1 形式' }
      // 仅时间：进入“总览统计”模式（无关键词）
      return { start, end: new Date(), keyword: null }
    }
    const { start, end } = rangeDefaultThreeMonths()
    return { start, end, keyword: args[0] }
  }

  if (args.length === 2) {
    if (isDateToken(args[0]) && isDateToken(args[1])) {
      const start = parseDateStart(args[0])
      const end = parseDateEnd(args[1])
      if (!start || !end) return { error: '时间格式无效，请使用 2026-1-1 形式' }
      if (end < start) return { error: '结束时间不能早于开始时间' }
      const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000
      if (end.getTime() - start.getTime() > ONE_YEAR_MS) {
        return { error: '开始时间与结束时间的范围不能超过1年' }
      }
      // 仅时间：总览统计模式
      return { start, end, keyword: null }
    }
    if (isDateToken(args[0])) {
      const start = parseDateStart(args[0])
      const end = parseDateEnd(args[1])
      if (!start || !end) return { error: '时间格式无效，请使用 2026-1-1 形式' }
      if (end < start) return { error: '结束时间不能早于开始时间' }
      const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000
      if (end.getTime() - start.getTime() > ONE_YEAR_MS) {
        return { error: '开始时间与结束时间的范围不能超过1年' }
      }
      return { error: '指定起止时间时请将关键词放在最前。例：mbcds 关键词 2026-1-1 2026-4-1' }
    }
    const start = parseDateStart(args[1])
    if (!start) return { error: '开始时间格式无效，请使用 2026-1-1 形式' }
    return { start, end: new Date(), keyword: args[0] }
  }

  const start = parseDateStart(args[1])
  const end = parseDateEnd(args[2])
  if (!start || !end) return { error: '时间格式无效，请使用 2026-1-1 形式' }
  if (end < start) return { error: '结束时间不能早于开始时间' }
  const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000
  if (end.getTime() - start.getTime() > ONE_YEAR_MS) {
    return { error: '开始时间与结束时间的范围不能超过1年' }
  }
  return { start, end, keyword: args[0] }
}

const formatRangeText = (start, end) => {
  const f = d => {
    const x = new Date(d)
    return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()} ${pad2(x.getHours())}:${pad2(
      x.getMinutes()
    )}`
  }
  return `${f(start)} ~ ${f(end)}`
}

const topNWithOther = (map, n = 15) => {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1])
  if (arr.length <= n) {
    return { labels: arr.map(([k]) => k), data: arr.map(([, v]) => v) }
  }
  const head = arr.slice(0, n)
  const rest = arr.slice(n).reduce((s, [, v]) => s + v, 0)
  return { labels: [...head.map(([k]) => k), '其他'], data: [...head.map(([, v]) => v), rest] }
}

const UNKNOWN_POOL_LABEL = '（未知蛋池）'

const countDrawsInPool = (col, start, end, poolName) => {
  if (poolName === UNKNOWN_POOL_LABEL) {
    return col.countDocuments({
      time: { $gte: start, $lte: end },
      $or: [{ draw_pool: { $exists: false } }, { draw_pool: null }, { draw_pool: '' }]
    })
  }
  return col.countDocuments({
    time: { $gte: start, $lte: end },
    draw_pool: poolName
  })
}

const docsToPoolPie = docs => {
  const m = new Map()
  for (const doc of docs) {
    const p =
      doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
    m.set(p, (m.get(p) || 0) + 1)
  }
  return topNWithOther(m, 15)
}

const docsToItemPie = docs => {
  const m = new Map()
  for (const doc of docs) {
    const it = doc.item_name && String(doc.item_name).trim() ? String(doc.item_name).trim() : '（无名称）'
    m.set(it, (m.get(it) || 0) + 1)
  }
  return topNWithOther(m, 15)
}

const rankItemsByShare = docs => {
  const m = new Map()
  for (const doc of docs) {
    const it = doc.item_name && String(doc.item_name).trim() ? String(doc.item_name).trim() : '（无名称）'
    m.set(it, (m.get(it) || 0) + 1)
  }
  const total = [...m.values()].reduce((s, v) => s + v, 0)
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, count], i) => ({
      rank: i + 1,
      name,
      count,
      pct: total > 0 ? (100 * count) / total : 0
    }))
}

const top10CharsFromDocs = docs => {
  const m = new Map()
  for (const doc of docs) {
    const ch = doc.character_name && String(doc.character_name).trim()
    if (!ch) continue
    m.set(ch, (m.get(ch) || 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count], i) => ({ rank: i + 1, name, count }))
}

const top10ItemsFromDocs = docs => {
  const m = new Map()
  for (const doc of docs) {
    const it = doc.item_name && String(doc.item_name).trim() ? String(doc.item_name).trim() : '（无名称）'
    m.set(it, (m.get(it) || 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count], i) => ({ rank: i + 1, name, count }))
}

const buildDailyUniqueSeries = (docs, start, end, poolLabels) => {
  const labels = enumerateDays(start, end)
  const totalByDay = new Map()
  const byPoolDay = new Map() // pool -> day -> Set(chars)
  const otherPools = new Set()
  const poolSet = new Set(poolLabels)
  for (const p of poolLabels) byPoolDay.set(p, new Map())

  for (const doc of docs) {
    const t = doc.time ? new Date(doc.time) : new Date(doc.ts)
    const dk = dateKey(t)
    const ch = doc.character_name && String(doc.character_name).trim()
    if (!ch) continue
    const pool =
      doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL

    if (!totalByDay.has(dk)) totalByDay.set(dk, new Set())
    totalByDay.get(dk).add(ch)

    const target = poolSet.has(pool) ? pool : '其他'
    if (!poolSet.has(pool)) otherPools.add(pool)
    if (!byPoolDay.has(target)) byPoolDay.set(target, new Map())
    const mp = byPoolDay.get(target)
    if (!mp.has(dk)) mp.set(dk, new Set())
    mp.get(dk).add(ch)
  }

  const series = {}
  for (const [pool, mp] of byPoolDay.entries()) {
    series[pool] = labels.map(d => (mp.get(d) ? mp.get(d).size : 0))
  }
  const totalSeries = labels.map(d => (totalByDay.get(d) ? totalByDay.get(d).size : 0))
  return { labels, totalSeries, series }
}

const aggregateSummaryFromDocs = (docs, start, end) => {
  const poolCount = new Map()
  const bumpPool = p => poolCount.set(p, (poolCount.get(p) || 0) + 1)
  for (const doc of docs) {
    const pool =
      doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
    bumpPool(pool)
  }

  // 折线：蛋池过多时取 TOP7 + 其他
  const poolsSorted = [...poolCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  const poolLabelsForLine = poolsSorted.length <= 8 ? poolsSorted : [...poolsSorted.slice(0, 7), '其他']

  const piePool = topNWithOther(poolCount, 15)
  const topChars = top10CharsFromDocs(docs)
  const topItems = top10ItemsFromDocs(docs)
  const daily = buildDailyUniqueSeries(docs, start, end, poolLabelsForLine.filter(x => x !== '其他'))

  return {
    piePool,
    topChars,
    topItems,
    daily
  }
}

const toFiniteNumber = x => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

const buildRevenueRows = (docs, poolSRareMap) => {
  const poolCount = new Map()
  for (const doc of docs) {
    const pool =
      doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
    poolCount.set(pool, (poolCount.get(pool) || 0) + 1)
  }

  const rows = []
  for (const [poolName, count] of poolCount.entries()) {
    if (poolName === UNKNOWN_POOL_LABEL) continue
    const sRarePct = toFiniteNumber(poolSRareMap.get(poolName))
    // 没有目标礼包的 S 级概率时直接忽略
    if (!(sRarePct > 0)) continue
    const estRevenue = sRarePct > 0 ? (count / (sRarePct / 100) / 60) * 264 : 0
    rows.push({
      poolName,
      count,
      sRarePct,
      estRevenue
    })
  }

  rows.sort((a, b) => b.estRevenue - a.estRevenue || b.count - a.count)
  return rows
}

const buildPoolSRareMap = async (db, poolNames) => {
  const uniqPools = [
    ...new Set(
      poolNames
        .map(x => String(x || '').trim())
        .filter(Boolean)
        .filter(x => x !== UNKNOWN_POOL_LABEL)
    )
  ]
  if (!uniqPools.length) return new Map()

  const col = db.collection('cl_mabinogi_gacha_info')
  const docs = await col
    .aggregate([
      {
        $match: {
          info: {
            $elemMatch: {
              pool: { $in: uniqPools },
              rareTag: 'S'
            }
          }
        }
      },
      { $unwind: '$info' },
      {
        $match: {
          'info.pool': { $in: uniqPools },
          'info.rareTag': 'S'
        }
      },
      {
        $group: {
          _id: '$info.pool',
          rare: { $first: '$info.rare' }
        }
      }
    ])
    .toArray()

  const poolSRareMap = new Map()
  for (const doc of docs) {
    const pool = doc._id && String(doc._id).trim()
    if (!pool || !uniqPools.includes(pool) || poolSRareMap.has(pool)) continue
    const rare = toFiniteNumber(doc.rare)
    if (rare > 0) poolSRareMap.set(pool, rare)
  }
  return poolSRareMap
}

const escapeJsonForHtml = obj =>
  JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

const buildPayload = async (db, start, end, keyword) => {
  const kw = keyword && String(keyword).trim().length ? String(keyword).trim() : null
  const timeQ = { time: { $gte: start, $lte: end } }
  const fields = { draw_pool: 1, item_name: 1, character_name: 1, time: 1, ts: 1, _id: 0 }
  const colYlx = db.collection('cl_mbcd_ylx')
  const colYate = db.collection('cl_mbcd_yate')

  // 仅时间：总览统计（不做关键词三维度）
  if (!kw) {
    const [docsYlx, docsYate] = await Promise.all([
      colYlx.find(timeQ, { projection: fields }).toArray(),
      colYate.find(timeQ, { projection: fields }).toArray()
    ])
    const allPools = [...docsYlx, ...docsYate].map(doc =>
      doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
    )
    const poolSRareMap = await buildPoolSRareMap(db, allPools)
    return {
      rangeText: formatRangeText(start, end),
      keyword: '',
      summary: {
        ylx: {
          ...aggregateSummaryFromDocs(docsYlx, start, end),
          revenueRows: buildRevenueRows(docsYlx, poolSRareMap)
        },
        yate: {
          ...aggregateSummaryFromDocs(docsYate, start, end),
          revenueRows: buildRevenueRows(docsYate, poolSRareMap)
        }
      },
      character: null,
      pool: null,
      item: null
    }
  }

  const [charYlx, charYate] = await Promise.all([
    colYlx.find({ ...timeQ, character_name: kw }, { projection: fields }).toArray(),
    colYate.find({ ...timeQ, character_name: kw }, { projection: fields }).toArray()
  ])

  let character = null
  if (charYlx.length || charYate.length) {
    character = {
      name: kw,
      pieYlx: charYlx.length ? docsToPoolPie(charYlx) : null,
      pieYate: charYate.length ? docsToPoolPie(charYate) : null
    }
  }

  const [poolYlx, poolYate] = await Promise.all([
    colYlx.find({ ...timeQ, draw_pool: kw }, { projection: fields }).toArray(),
    colYate.find({ ...timeQ, draw_pool: kw }, { projection: fields }).toArray()
  ])

  let pool = null
  if (poolYlx.length || poolYate.length) {
    const topYlx = poolYlx.length ? top10CharsFromDocs(poolYlx) : []
    const topYate = poolYate.length ? top10CharsFromDocs(poolYate) : []
    const itemRankYlx = poolYlx.length ? rankItemsByShare(poolYlx) : []
    const itemRankYate = poolYate.length ? rankItemsByShare(poolYate) : []
    pool = {
      poolName: kw,
      pieYlx: poolYlx.length ? docsToItemPie(poolYlx) : null,
      pieYate: poolYate.length ? docsToItemPie(poolYate) : null,
      itemRankYlx,
      itemRankYate,
      topYlx,
      topYate,
      showItemRankYlx: itemRankYlx.length > 0,
      showItemRankYate: itemRankYate.length > 0,
      showRankYlx: topYlx.length > 0,
      showRankYate: topYate.length > 0
    }
  }

  const itemRegex = new RegExp(partToRegex(kw), 'i')
  const [itemYlx, itemYate] = await Promise.all([
    colYlx.find({ ...timeQ, item_name: itemRegex }, { projection: fields }).toArray(),
    colYate.find({ ...timeQ, item_name: itemRegex }, { projection: fields }).toArray()
  ])

  let item = null
  if (itemYlx.length || itemYate.length) {
    const namesSet = new Set()
    for (const d of [...itemYlx, ...itemYate]) {
      if (d.item_name && String(d.item_name).trim()) namesSet.add(String(d.item_name).trim())
    }
    const matchedNames = [...namesSet].sort()

    const buildRows = async (col, docs) => {
      const poolMatched = new Map()
      for (const doc of docs) {
        const pool =
          doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
        poolMatched.set(pool, (poolMatched.get(pool) || 0) + 1)
      }
      const rows = []
      for (const [poolName, matched] of poolMatched.entries()) {
        const safeTotal = await countDrawsInPool(col, start, end, poolName)
        const denom = safeTotal > 0 ? safeTotal : matched
        const pct = denom ? (100 * matched) / denom : 0
        rows.push({ pool: poolName, matched, total: safeTotal, pct })
      }
      rows.sort((a, b) => b.pct - a.pct || b.matched - a.matched)
      return rows
    }

    const splitDocsByItem = docs => {
      const m = new Map()
      for (const doc of docs) {
        const it = doc.item_name && String(doc.item_name).trim() ? String(doc.item_name).trim() : '（无名称）'
        if (!m.has(it)) m.set(it, [])
        m.get(it).push(doc)
      }
      return m
    }

    const buildPoolGroups = async (col, docs) => {
      const byPool = new Map()
      for (const doc of docs) {
        const pool =
          doc.draw_pool && String(doc.draw_pool).trim() ? String(doc.draw_pool).trim() : UNKNOWN_POOL_LABEL
        const item =
          doc.item_name && String(doc.item_name).trim() ? String(doc.item_name).trim() : '（无名称）'
        if (!byPool.has(pool)) byPool.set(pool, new Map())
        const itemMap = byPool.get(pool)
        itemMap.set(item, (itemMap.get(item) || 0) + 1)
      }

      const groups = []
      for (const [poolName, itemMap] of byPool.entries()) {
        const poolTotal = await countDrawsInPool(col, start, end, poolName)
        const rows = [...itemMap.entries()]
          .map(([itemName, matched]) => {
            const denom = poolTotal > 0 ? poolTotal : matched
            const pct = denom ? (100 * matched) / denom : 0
            return { itemName, matched, total: poolTotal, pct }
          })
          .sort((a, b) => b.pct - a.pct || b.matched - a.matched)
        groups.push({
          poolName,
          poolMatched: rows.reduce((s, x) => s + x.matched, 0),
          rows
        })
      }
      groups.sort((a, b) => b.poolMatched - a.poolMatched)
      // 蛋池过多时限制展示数量，避免图片过长
      return { groups: groups.slice(0, 8), hiddenCount: Math.max(0, groups.length - 8) }
    }

    const perPoolYlx = itemYlx.length
      ? await buildPoolGroups(colYlx, itemYlx)
      : { groups: [], hiddenCount: 0 }
    const perPoolYate = itemYate.length
      ? await buildPoolGroups(colYate, itemYate)
      : { groups: [], hiddenCount: 0 }

    const topYlx = itemYlx.length ? top10CharsFromDocs(itemYlx) : []
    const topYate = itemYate.length ? top10CharsFromDocs(itemYate) : []
    item = {
      keyword: kw,
      matchedNames,
      perPoolYlx,
      perPoolYate,
      topYlx,
      topYate,
      showTableYlx: perPoolYlx.groups.length > 0,
      showTableYate: perPoolYate.groups.length > 0,
      showRankYlx: topYlx.length > 0,
      showRankYate: topYate.length > 0
    }
  }

  return {
    rangeText: formatRangeText(start, end),
    keyword: kw,
    summary: null,
    character,
    pool,
    item
  }
}


async function queryMbcdStats(db, start, end, keyword) {
  return buildPayload(db, start, end, keyword);
}

module.exports = {
  buildPayload,
  parseMbcdsArgs,
  queryMbcdStats
};
