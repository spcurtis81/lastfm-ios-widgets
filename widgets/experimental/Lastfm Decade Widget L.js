// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: magic;
// Last.fm Decade History Collector
// Experimental development version v0.6
//
// SAFE / GENTLE COLLECTOR
// ------------------------------------------------------------
//
// Absolute maximum Last.fm HTTP requests per execution: 1
//
// v0.6 architecture:
//   - Username-scoped local storage
//   - Cache schema v2
//   - Conservative import of matching v0.5/v1 cache data
//   - Captured/unparsable years do not block other years
//   - Chronological collection queue
//
// This is still a manual Scriptable collector.
// It does not create a Home Screen widget.
//
// Temporary development year bounds (CONFIG.firstYear / lastYear)
// remain until automatic range discovery is implemented.


const SCHEMA_VERSION = 2

// Increment when parsers change so captured HTML can be reparsed once.
const PARSER_GENERATION = 1


const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",

  // TEMPORARY development bounds. Do not treat as Last.fm product limits.
  // Automatic account-range discovery is intentionally not in v0.6.
  firstYear: 2006,
  lastYear: 2025,

  cacheRootDirectory: "LastFMDecadeHistory",
  usersDirectory: "users",
  cacheFile: "decade-history-v2.json",
  rawDirectory: "RawReports",

  legacyCacheFile: "decade-history-v1.json"
}


// ============================================================
// FILE SYSTEM
// ============================================================

const fm = FileManager.local()

const cacheRoot = fm.joinPath(
  fm.documentsDirectory(),
  CONFIG.cacheRootDirectory
)

if (!fm.fileExists(cacheRoot)) {
  fm.createDirectory(cacheRoot, true)
}


function userStorageKey(username) {
  const trimmed = String(username ?? "").trim()
  const normalized = trimmed.normalize
    ? trimmed.normalize("NFC")
    : trimmed

  if (!normalized) {
    return "_empty"
  }

  let encoded = ""

  for (const character of normalized) {
    const codePoint = character.codePointAt(0)

    const safe =
      (codePoint >= 48 && codePoint <= 57) ||
      (codePoint >= 65 && codePoint <= 90) ||
      (codePoint >= 97 && codePoint <= 122) ||
      character === "-" ||
      character === "_"

    if (safe) {
      encoded += character
    } else {
      encoded += "~" + codePoint.toString(16).toLowerCase() + "~"
    }
  }

  if (
    encoded === "." ||
    encoded === ".." ||
    encoded.startsWith(".") ||
    encoded.startsWith("-")
  ) {
    encoded = "u" + encoded
  }

  if (encoded.length > 200) {
    encoded =
      encoded.slice(0, 160) +
      "~h" +
      fnv1aHex(normalized) +
      "~"
  }

  return encoded
}


function fnv1aHex(value) {
  let hash = 2166136261

  const text = String(value)

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}


function userDirectoryPath() {
  return fm.joinPath(
    fm.joinPath(cacheRoot, CONFIG.usersDirectory),
    userStorageKey(CONFIG.username)
  )
}


function ensureUserDirectories() {
  const userDirectory = userDirectoryPath()

  if (!fm.fileExists(userDirectory)) {
    fm.createDirectory(userDirectory, true)
  }

  const rawDir = fm.joinPath(userDirectory, CONFIG.rawDirectory)

  if (!fm.fileExists(rawDir)) {
    fm.createDirectory(rawDir, true)
  }

  return userDirectory
}


function cacheFilePath() {
  return fm.joinPath(ensureUserDirectories(), CONFIG.cacheFile)
}


function rawDirectoryPath() {
  ensureUserDirectories()
  return fm.joinPath(userDirectoryPath(), CONFIG.rawDirectory)
}


function legacyCacheFilePath() {
  return fm.joinPath(cacheRoot, CONFIG.legacyCacheFile)
}


function legacyRawDirectoryPath() {
  return fm.joinPath(cacheRoot, CONFIG.rawDirectory)
}


// ============================================================
// HELPERS
// ============================================================

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}


function yearKey(year) {
  return String(year)
}


function yearsInRange() {
  const years = []

  for (let year = CONFIG.firstYear; year <= CONFIG.lastYear; year += 1) {
    years.push(year)
  }

  return years
}


function rawPath(year) {
  return fm.joinPath(rawDirectoryPath(), `${year}.html`)
}


function legacyRawPath(year) {
  return fm.joinPath(legacyRawDirectoryPath(), `${year}.html`)
}


function reportURL(year) {
  return (
    "https://www.last.fm/user/" +
    encodeURIComponent(CONFIG.username) +
    "/listening-report/year/" +
    year
  )
}


function decodeHTML(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim()
}


function stripTags(value) {
  return decodeHTML(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  )
}


function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}


function copyFileIfMissing(fromPath, toPath) {
  if (!fm.fileExists(fromPath) || fm.fileExists(toPath)) {
    return false
  }

  const parent = toPath.slice(0, toPath.lastIndexOf("/"))

  if (parent && !fm.fileExists(parent)) {
    fm.createDirectory(parent, true)
  }

  if (typeof fm.copy === "function") {
    fm.copy(fromPath, toPath)
  } else {
    fm.writeString(toPath, fm.readString(fromPath))
  }

  return true
}


// ============================================================
// DECADE DEFINITIONS
// ============================================================

const DECADES = [
  { label: "Pre-1960", key: "pre-1960" },
  { label: "1960s", key: "1960s" },
  { label: "1970s", key: "1970s" },
  { label: "1980s", key: "1980s" },
  { label: "1990s", key: "1990s" },
  { label: "2000s", key: "2000s" },
  { label: "2010s", key: "2010s" },
  { label: "2020s", key: "2020s" }
]


// ============================================================
// CACHE SCHEMA v2
// ============================================================

function createEmptyCache() {
  const now = Date.now()

  return {
    version: SCHEMA_VERSION,
    username: CONFIG.username,
    years: {},
    createdAt: now,
    updatedAt: now,
    migratedFromV1: false
  }
}


function createYearRecord(year, extra = {}) {
  return {
    year: Number(year),
    status: extra.status || "transient",
    decades: extra.decades || null,
    classified: extra.classified ?? null,
    parser: extra.parser || null,
    source: extra.source || null,
    httpStatus: extra.httpStatus ?? null,
    capturedAt: extra.capturedAt ?? null,
    parsedAt: extra.parsedAt ?? null,
    checkedAt: extra.checkedAt ?? null,
    updatedAt: extra.updatedAt ?? Date.now(),
    rawSaved: extra.rawSaved ?? false,
    lastTriedAt: extra.lastTriedAt ?? null,
    failureCount: extra.failureCount ?? 0,
    lastFailureStatus: extra.lastFailureStatus ?? null,
    parseGeneration: extra.parseGeneration ?? null,
    ...extra,
    year: Number(year)
  }
}


function canWriteCache(cache) {
  return cache && cache.ok !== false && !cache.integrityError
}


function saveCache(cache) {
  if (!canWriteCache(cache)) {
    return false
  }

  cache.updatedAt = Date.now()
  cache.version = SCHEMA_VERSION
  cache.username = CONFIG.username

  const persisted = {
    version: cache.version,
    username: cache.username,
    years: cache.years,
    createdAt: cache.createdAt,
    updatedAt: cache.updatedAt,
    migratedFromV1: Boolean(cache.migratedFromV1)
  }

  if (cache.migratedAt) {
    persisted.migratedAt = cache.migratedAt
  }

  fm.writeString(
    cacheFilePath(),
    JSON.stringify(persisted)
  )

  return true
}


function readJSONFile(path) {
  if (!fm.fileExists(path)) {
    return { exists: false, value: null, corrupt: false }
  }

  try {
    const value = JSON.parse(fm.readString(path))
    return { exists: true, value, corrupt: false }
  } catch (error) {
    return { exists: true, value: null, corrupt: true, error }
  }
}


function yearStatus(cache, year) {
  return cache.years?.[yearKey(year)]?.status || null
}


function isAvailable(cache, year) {
  return yearStatus(cache, year) === "available"
}


function isUnavailable(cache, year) {
  return yearStatus(cache, year) === "unavailable"
}


function isCaptured(cache, year) {
  return yearStatus(cache, year) === "captured"
}


function hasRawReport(year) {
  return fm.fileExists(rawPath(year))
}


function loadRawReport(year) {
  if (!hasRawReport(year)) {
    return null
  }

  try {
    return fm.readString(rawPath(year))
  } catch (_) {
    return null
  }
}


function saveRawReport(year, html) {
  fm.writeString(rawPath(year), html)

  console.log(`Saved ${year} listening report locally.`)
}


// ============================================================
// PARSERS (unchanged from v0.5)
// ============================================================

function extractTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)

  return match ? stripTags(match[1]) : ""
}


function parseKnownTableFormat(html) {
  const tableMatch = String(html).match(
    /<table[^>]*class=["'][^"']*js-music-decade-data[^"']*["'][^>]*>([\s\S]*?)<\/table>/i
  )

  if (!tableMatch) {
    return null
  }

  const tableHTML = tableMatch[1]
  const result = {}

  for (const decade of DECADES) {
    const pattern = new RegExp(
      "<td[^>]*data-decade=[\"']" +
        escapeRegExp(decade.key) +
        "[\"'][^>]*>" +
        "[\\s\\S]*?<\\/td>" +
        "\\s*" +
        "<td[^>]*>" +
        "\\s*([0-9,]+)\\s*" +
        "<\\/td>",
      "i"
    )

    const match = tableHTML.match(pattern)

    if (match) {
      result[decade.label] = Number(match[1].replace(/,/g, ""))
    }
  }

  if (Object.keys(result).length === 0) {
    return null
  }

  return {
    parser: "js-music-decade-data",
    decades: result
  }
}


function parseGenericDataDecade(html) {
  const source = String(html)
  const result = {}

  for (const decade of DECADES) {
    const marker = new RegExp(
      "data-decade=[\"']" + escapeRegExp(decade.key) + "[\"']",
      "i"
    )

    const markerMatch = marker.exec(source)

    if (!markerMatch) {
      continue
    }

    const fragment = source.slice(markerMatch.index, markerMatch.index + 1500)
    const numericCell = fragment.match(
      /<\/td>\s*<td[^>]*>\s*([0-9,]+)\s*<\/td>/i
    )

    if (numericCell) {
      result[decade.label] = Number(numericCell[1].replace(/,/g, ""))
    }
  }

  if (Object.keys(result).length === 0) {
    return null
  }

  return {
    parser: "generic-data-decade",
    decades: result
  }
}


function parseLabelFallback(html) {
  const source = String(html)
  const result = {}

  for (const decade of DECADES) {
    const match = new RegExp(escapeRegExp(decade.label), "i").exec(source)

    if (!match) {
      return null
    }

    const fragment = source.slice(match.index, match.index + 800)
    const numberMatch = fragment.match(/<td[^>]*>\s*([0-9][0-9,]*)\s*<\/td>/i)

    if (!numberMatch) {
      return null
    }

    result[decade.label] = Number(numberMatch[1].replace(/,/g, ""))
  }

  return {
    parser: "label-fallback",
    decades: result
  }
}


function parseDecades(html) {
  const parsers = [
    parseKnownTableFormat,
    parseGenericDataDecade,
    parseLabelFallback
  ]

  for (const parser of parsers) {
    try {
      const result = parser(html)

      if (result && result.decades) {
        return result
      }
    } catch (error) {
      console.log(`Parser error: ${error}`)
    }
  }

  return null
}


function validateDecades(decades) {
  if (!decades) {
    return { valid: false, reason: "No decade data" }
  }

  const labels = DECADES.map(item => item.label)

  for (const label of labels) {
    if (decades[label] === undefined || decades[label] === null) {
      return { valid: false, reason: `Missing ${label}` }
    }

    const value = Number(decades[label])

    if (!Number.isFinite(value) || value < 0) {
      return { valid: false, reason: `Invalid ${label}` }
    }
  }

  const total = labels.reduce(
    (sum, label) => sum + Number(decades[label]),
    0
  )

  if (total <= 0) {
    return { valid: false, reason: "Classified total is zero" }
  }

  return { valid: true, total }
}


// ============================================================
// v1 → v2 MIGRATION
// ============================================================

function importYearFromLegacy(cache, year, legacyYear, htmlCopied) {
  const key = yearKey(year)

  // Idempotent: never replace a year already recorded in v2.
  if (cache.years[key]) {
    return "kept-v2"
  }

  const now = Date.now()
  const legacyStatus = legacyYear?.status
  const rawSaved = htmlCopied || hasRawReport(year)

  if (legacyStatus === "available" && legacyYear?.decades) {
    const validation = validateDecades(legacyYear.decades)

    if (validation.valid) {
      cache.years[key] = createYearRecord(year, {
        status: "available",
        decades: legacyYear.decades,
        classified: validation.total,
        parser: legacyYear.parser || null,
        source: legacyYear.source || "v1-import",
        httpStatus: legacyYear.httpStatus ?? 200,
        capturedAt: legacyYear.capturedAt ?? null,
        parsedAt: legacyYear.parsedAt ?? now,
        checkedAt: legacyYear.checkedAt ?? null,
        updatedAt: now,
        rawSaved,
        lastTriedAt: legacyYear.lastTriedAt ?? null,
        failureCount: 0,
        lastFailureStatus: null,
        parseGeneration: PARSER_GENERATION
      })

      return "available"
    }
  }

  if (legacyStatus === "unavailable") {
    if (!cache.years[key]) {
      cache.years[key] = createYearRecord(year, {
        status: "unavailable",
        httpStatus: legacyYear.httpStatus ?? 404,
        checkedAt: legacyYear.checkedAt ?? now,
        updatedAt: now,
        rawSaved: false,
        source: "v1-import"
      })
    }

    return "unavailable"
  }

  if (rawSaved || legacyStatus === "captured") {
    if (!cache.years[key] || cache.years[key].status !== "available") {
      cache.years[key] = createYearRecord(year, {
        status: "captured",
        httpStatus: legacyYear?.httpStatus ?? 200,
        capturedAt: legacyYear?.capturedAt ?? now,
        updatedAt: now,
        rawSaved,
        source: legacyYear?.source || "v1-import",
        parseGeneration: null
      })
    }

    return "captured"
  }

  return "skipped"
}


function migrateMatchingLegacyCache(cache) {
  const legacy = readJSONFile(legacyCacheFilePath())

  if (!legacy.exists || legacy.corrupt || !legacy.value) {
    return { imported: false, reason: "none" }
  }

  if (legacy.value.username !== CONFIG.username) {
    console.log("Legacy cache belongs to another Last.fm user. Not imported.")
    return { imported: false, reason: "username-mismatch" }
  }

  const legacyYears = legacy.value.years || {}
  const summary = {
    imported: false,
    reason: "already-present",
    available: 0,
    captured: 0,
    unavailable: 0,
    htmlCopied: 0
  }

  for (const [key, legacyYear] of Object.entries(legacyYears)) {
    const year = Number(legacyYear?.year ?? key)

    if (!Number.isFinite(year)) {
      continue
    }

    const copied = copyFileIfMissing(
      legacyRawPath(year),
      rawPath(year)
    )

    if (copied) {
      summary.htmlCopied += 1
    }

    const result = importYearFromLegacy(
      cache,
      year,
      legacyYear,
      copied || hasRawReport(year)
    )

    if (result === "available") {
      summary.available += 1
    } else if (result === "captured") {
      summary.captured += 1
    } else if (result === "unavailable") {
      summary.unavailable += 1
    }
  }

  const changed =
    summary.available > 0 ||
    summary.captured > 0 ||
    summary.unavailable > 0 ||
    summary.htmlCopied > 0

  if (!changed) {
    return summary
  }

  cache.migratedFromV1 = true
  cache.migratedAt = Date.now()
  summary.imported = true
  summary.reason = "imported"

  return summary
}


function loadCache() {
  const current = readJSONFile(cacheFilePath())

  if (current.corrupt) {
    console.log(`Cache read error: ${current.error}`)

    return {
      ...createEmptyCache(),
      ok: false,
      integrityError: "corrupt",
      message:
        "The saved listening history file could not be read. " +
        "Local report files were left untouched."
    }
  }

  if (current.exists && current.value) {
    const cache = current.value

    if (cache.username !== CONFIG.username) {
      return {
        ...createEmptyCache(),
        ok: false,
        integrityError: "username-mismatch",
        message:
          "Saved listening history does not match the configured Last.fm username. " +
          "Nothing was overwritten."
      }
    }

    if (cache.version !== SCHEMA_VERSION) {
      return {
        ...createEmptyCache(),
        ok: false,
        integrityError: "version",
        message:
          "Saved listening history uses an unsupported format. " +
          "Local report files were left untouched."
      }
    }

    if (typeof cache.years !== "object" || cache.years === null) {
      cache.years = {}
    }

    cache.ok = true

    const migration = migrateMatchingLegacyCache(cache)

    if (migration.imported) {
      saveCache(cache)
      cache.migration = migration
    }

    return cache
  }

  const cache = createEmptyCache()
  const migration = migrateMatchingLegacyCache(cache)

  if (migration.imported) {
    saveCache(cache)
    cache.migration = migration
  }

  cache.ok = true
  return cache
}


// ============================================================
// STORE PARSED YEAR
// ============================================================

function storeParsedYear(cache, year, parsed, source) {
  const validation = validateDecades(parsed.decades)

  if (!validation.valid) {
    throw new Error(validation.reason)
  }

  const existing = cache.years[yearKey(year)] || {}

  cache.years[yearKey(year)] = createYearRecord(year, {
    ...existing,
    status: "available",
    httpStatus: existing.httpStatus ?? 200,
    parser: parsed.parser,
    decades: parsed.decades,
    classified: validation.total,
    source,
    rawSaved: hasRawReport(year),
    parsedAt: Date.now(),
    updatedAt: Date.now(),
    parseGeneration: PARSER_GENERATION,
    failureCount: 0,
    lastFailureStatus: null
  })

  saveCache(cache)

  return validation.total
}


function markCapturedParsePending(cache, year, extra = {}) {
  const existing = cache.years[yearKey(year)] || {}

  cache.years[yearKey(year)] = createYearRecord(year, {
    ...existing,
    status: "captured",
    rawSaved: hasRawReport(year),
    parseGeneration: PARSER_GENERATION,
    lastTriedAt: Date.now(),
    updatedAt: Date.now(),
    ...extra
  })

  saveCache(cache)
}


function markUnavailable(cache, year, httpStatus) {
  const existing = cache.years[yearKey(year)] || {}

  cache.years[yearKey(year)] = createYearRecord(year, {
    ...existing,
    status: "unavailable",
    httpStatus,
    checkedAt: Date.now(),
    lastTriedAt: Date.now(),
    updatedAt: Date.now(),
    rawSaved: false
  })

  saveCache(cache)
}


function markTransient(cache, year, httpStatus) {
  const existing = cache.years[yearKey(year)] || {}

  cache.years[yearKey(year)] = createYearRecord(year, {
    ...existing,
    status: "transient",
    httpStatus,
    lastTriedAt: Date.now(),
    lastFailureStatus: httpStatus,
    failureCount: Number(existing.failureCount || 0) + 1,
    updatedAt: Date.now()
  })

  saveCache(cache)
}


// ============================================================
// LOCAL PARSE
// ============================================================

function trySavedReport(cache, year) {
  const html = loadRawReport(year)

  if (!html) {
    // Empty or unreadable files still count as a local parse attempt
    // so they cannot monopolise later runs. Do not download again.
    markCapturedParsePending(cache, year)
    return { found: false, parsed: false }
  }

  console.log(`Using the saved ${year} listening report. No network request.`)

  const parsed = parseDecades(html)

  if (!parsed) {
    markCapturedParsePending(cache, year)
    return { found: true, parsed: false, html }
  }

  const validation = validateDecades(parsed.decades)

  if (!validation.valid) {
    markCapturedParsePending(cache, year)
    return { found: true, parsed: false, html, reason: validation.reason }
  }

  const total = storeParsedYear(cache, year, parsed, "saved-html")

  return {
    found: true,
    parsed: true,
    total,
    parser: parsed.parser
  }
}


// ============================================================
// TARGET SELECTION
//
// Local parse work is separate from network collection.
// A captured year is attempted at most once per parser generation.
// It never causes another download of that year.
// It does not monopolise later runs after that parse attempt.
// ============================================================

function needsLocalParse(cache, year) {
  if (!hasRawReport(year)) {
    return false
  }

  if (isAvailable(cache, year) || isUnavailable(cache, year)) {
    return false
  }

  const record = cache.years[yearKey(year)]

  if (record && record.parseGeneration === PARSER_GENERATION) {
    return false
  }

  return true
}


function needsNetwork(cache, year) {
  if (hasRawReport(year)) {
    return false
  }

  const status = yearStatus(cache, year)

  if (
    status === "available" ||
    status === "unavailable" ||
    status === "captured" ||
    status === "transient"
  ) {
    return false
  }

  return true
}


function chooseTarget(cache) {
  for (const year of yearsInRange()) {
    if (needsLocalParse(cache, year)) {
      return { year, kind: "local-parse" }
    }
  }

  for (const year of yearsInRange()) {
    if (needsNetwork(cache, year)) {
      return { year, kind: "network" }
    }
  }

  return null
}


function collectionProgress(cache) {
  const years = yearsInRange()
  let available = 0
  let unavailable = 0
  let captured = 0
  let transient = 0

  for (const year of years) {
    const status = yearStatus(cache, year)

    if (status === "available") {
      available += 1
    } else if (status === "unavailable") {
      unavailable += 1
    } else if (status === "captured") {
      captured += 1
    } else if (status === "transient") {
      transient += 1
    }
  }

  return {
    total: years.length,
    available,
    unavailable,
    captured,
    transient,
    remaining: years.length - available - unavailable - captured - transient
  }
}


function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`
}


function progressMessage(cache) {
  const progress = collectionProgress(cache)

  return (
    `${progress.available} of ${progress.total} years collected` +
    (progress.captured
      ? `\n${countLabel(progress.captured, "report needs parsing", "reports need parsing")}`
      : "") +
    (progress.transient
      ? `\n${countLabel(progress.transient, "report is waiting to retry", "reports are waiting to retry")}`
      : "") +
    (progress.unavailable
      ? `\n${countLabel(progress.unavailable, "year is not available on Last.fm", "years are not available on Last.fm")}`
      : "")
  )
}


function idleStatus(cache) {
  const progress = collectionProgress(cache)
  const unresolved =
    progress.captured + progress.transient + progress.remaining
  const body = progressMessage(cache)

  if (unresolved === 0) {
    return {
      complete: true,
      title: "Listening history up to date",
      message:
        body +
        "\n\nThere are no further years to collect with the current settings."
    }
  }

  return {
    complete: false,
    title: "Collection paused",
    message:
      body +
      "\n\nNothing more can be collected until a saved report can be read or a later retry is possible."
  }
}


// ============================================================
// NETWORK — the only Request path
// ============================================================

async function fetchReport(year) {
  const url = reportURL(year)

  console.log("NETWORK REQUEST")
  console.log(url)

  const request = new Request(url)
  request.timeoutInterval = 30

  const html = await request.loadString()
  const status = Number(request.response?.statusCode || 0)

  return {
    url,
    status,
    html,
    title: extractTitle(html)
  }
}


// ============================================================
// OUTPUT
// ============================================================

function printDecades(decades) {
  console.log("")

  for (const item of DECADES) {
    const value = Number(decades[item.label] || 0)
    console.log(item.label.padEnd(12) + formatNumber(value).padStart(8))
  }
}


function printCacheSummary(cache) {
  const progress = collectionProgress(cache)

  console.log("")
  console.log("========================================")
  console.log("CACHE SUMMARY")
  console.log("========================================")
  console.log(`User: ${CONFIG.username}`)
  console.log(`Storage key: ${userStorageKey(CONFIG.username)}`)
  console.log(progressMessage(cache))
  console.log(`Remaining to collect: ${progress.remaining}`)
}


async function presentAlert(title, message) {
  if (typeof Alert === "undefined") {
    console.log(`${title}: ${message}`)
    return
  }

  const alert = new Alert()
  alert.title = title
  alert.message = message
  alert.addAction("OK")
  await alert.present()
}


// ============================================================
// MAIN
// ============================================================

async function runCollector() {
  const cache = loadCache()

  console.log("")
  console.log("========================================")
  console.log("LAST.FM DECADE COLLECTOR v0.6")
  console.log("========================================")
  console.log(`User: ${CONFIG.username}`)
  console.log("Maximum network requests this run: 1")

  if (cache.ok === false) {
    await presentAlert("Listening history problem", cache.message)
    if (typeof Script !== "undefined") {
      Script.complete()
    }
    return cache
  }

  if (cache.migration?.imported) {
    console.log("Imported matching previous collector data.")
  }

  printCacheSummary(cache)

  const target = chooseTarget(cache)

  if (!target) {
    const idle = idleStatus(cache)

    await presentAlert(idle.title, idle.message)

    if (typeof Script !== "undefined") {
      Script.complete()
    }

    return cache
  }

  console.log(`Target year: ${target.year} (${target.kind})`)

  if (target.kind === "local-parse") {
    const local = trySavedReport(cache, target.year)

    if (!local.parsed) {
      markCapturedParsePending(cache, target.year)
    }

    printCacheSummary(cache)

    if (local.parsed) {
      await presentAlert(
        `${target.year} added from saved report`,
        `${formatNumber(local.total)} scrobbles classified.\n\n` +
          progressMessage(cache) +
          "\n\nNo Last.fm request was made."
      )
    } else {
      await presentAlert(
        `${target.year} saved but not yet readable`,
        "The report is stored on this device, but its decade table could not be read yet.\n\n" +
          "It will not block collection of other years.\n\n" +
          progressMessage(cache)
      )
    }

    if (typeof Script !== "undefined") {
      Script.complete()
    }

    return cache
  }

  try {
    const result = await fetchReport(target.year)

    console.log(`HTTP ${result.status}`)

    if (result.status === 200) {
      saveRawReport(target.year, result.html)

      const existing = cache.years[yearKey(target.year)] || {}

      cache.years[yearKey(target.year)] = createYearRecord(target.year, {
        ...existing,
        status: existing.status === "available" ? "available" : "captured",
        httpStatus: 200,
        rawSaved: true,
        capturedAt: Date.now(),
        lastTriedAt: Date.now(),
        source: "network-capture"
      })

      saveCache(cache)

      const parsed = parseDecades(result.html)

      if (parsed) {
        const validation = validateDecades(parsed.decades)

        if (validation.valid) {
          const total = storeParsedYear(
            cache,
            target.year,
            parsed,
            "network-capture"
          )

          printDecades(parsed.decades)
          printCacheSummary(cache)

          await presentAlert(
            `${target.year} collected`,
            `${formatNumber(total)} scrobbles classified.\n\n` +
              progressMessage(cache) +
              "\n\nOne Last.fm request was made."
          )
        } else {
          markCapturedParsePending(cache, target.year)
          printCacheSummary(cache)

          await presentAlert(
            `${target.year} saved`,
            "The report was downloaded, but its decade table could not be read yet.\n\n" +
              "Other years can still be collected.\n\n" +
              progressMessage(cache)
          )
        }
      } else {
        markCapturedParsePending(cache, target.year)
        printCacheSummary(cache)

        await presentAlert(
          `${target.year} saved`,
          "The report was downloaded, but its decade table could not be read yet.\n\n" +
            "Other years can still be collected.\n\n" +
            progressMessage(cache)
        )
      }
    } else if (result.status === 404) {
      markUnavailable(cache, target.year, 404)
      printCacheSummary(cache)

      await presentAlert(
        `${target.year} not available`,
        "Last.fm has no listening report for this year.\n\n" +
          progressMessage(cache)
      )
    } else {
      markTransient(cache, target.year, result.status)
      printCacheSummary(cache)

      await presentAlert(
        "Last.fm is busy",
        `${target.year} could not be collected (HTTP ${result.status}).\n\n` +
          "Nothing already saved was changed. Try again later.\n\n" +
          progressMessage(cache)
      )
    }
  } catch (error) {
    markTransient(cache, target.year, 0)

    await presentAlert(
      "Last.fm request failed",
      `${target.year} could not be retrieved.\n\n` +
        String(error?.message || error) +
        "\n\nNothing already saved was discarded."
    )
  }

  if (typeof Script !== "undefined") {
    Script.complete()
  }

  return cache
}


if (typeof Script !== "undefined") {
  await runCollector()
}


if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SCHEMA_VERSION,
    PARSER_GENERATION,
    CONFIG,
    userStorageKey,
    userDirectoryPath,
    cacheFilePath,
    rawPath,
    legacyCacheFilePath,
    legacyRawPath,
    createEmptyCache,
    createYearRecord,
    validateDecades,
    parseDecades,
    chooseTarget,
    needsLocalParse,
    needsNetwork,
    yearsInRange,
    collectionProgress,
    progressMessage,
    idleStatus,
    importYearFromLegacy,
    migrateMatchingLegacyCache,
    loadCache,
    saveCache,
    trySavedReport,
    markCapturedParsePending,
    runCollector,
    fnv1aHex
  }
}
