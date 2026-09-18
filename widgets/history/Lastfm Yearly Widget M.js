// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: trophy;
// Last.fm Listening History — Medium
// v1.0
//
// All-time listening history by calendar year.
//
// Completed calendar years are fetched once and cached permanently.
// Only the current calendar year is refreshed on subsequent runs.
//
// Uses Last.fm user.getRecentTracks with limit=1 because the response
// metadata contains the total number of scrobbles in the requested
// date range.
//
// Cache is intentionally retained across script updates.

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase: "https://ws.audioscrobbler.com/2.0/",
  get profileURL() {
    return `https://www.last.fm/user/${encodeURIComponent(this.username)}`
  },
  logoURL:
    "https://www.last.fm/static/images/logo_static.adb61955725c.png",

  primaryText: Color.white(),
  secondaryText: new Color("#96969D"),
  tertiaryText: new Color("#68686D"),

  lastfmRed: new Color("#D92323"),

  historicalBarColor: new Color("#85858B"),
  baselineColor: new Color("#343438"),

  refreshMinutes: 120,

  cacheDirectory: "LastFMHistoryWidget",
  annualCacheFile: "annual-history-v1.json",
  logoCacheFile: "lastfm-logo.png",

  initialBuildDelayMs: 300
}


// ============================================================
// STORAGE
// ============================================================

const fm = FileManager.local()

const cacheDirectory = fm.joinPath(
  fm.documentsDirectory(),
  CONFIG.cacheDirectory
)

if (!fm.fileExists(cacheDirectory)) {
  fm.createDirectory(cacheDirectory, true)
}

const annualCachePath = fm.joinPath(
  cacheDirectory,
  CONFIG.annualCacheFile
)

const logoCachePath = fm.joinPath(
  cacheDirectory,
  CONFIG.logoCacheFile
)


// ============================================================
// HELPERS
// ============================================================

function encode(value) {
  return encodeURIComponent(String(value))
}


function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}


function sleep(ms) {
  return new Promise(resolve =>
    Timer.schedule(
      ms / 1000,
      false,
      resolve
    )
  )
}


function addText(
  stack,
  text,
  font,
  color,
  alignment = "left",
  lineLimit = 1,
  minimumScaleFactor = 1
) {
  const item = stack.addText(String(text))

  item.font = font
  item.textColor = color
  item.lineLimit = lineLimit
  item.minimumScaleFactor = minimumScaleFactor

  if (alignment === "center") {
    item.centerAlignText()
  } else if (alignment === "right") {
    item.rightAlignText()
  } else {
    item.leftAlignText()
  }

  return item
}


function createBackgroundGradient() {
  const gradient = new LinearGradient()

  gradient.startPoint = new Point(0.15, 0.85)
  gradient.endPoint = new Point(1.0, 0.0)

  gradient.colors = [
    new Color("#101011"),
    new Color("#101011"),
    new Color("#121011"),
    new Color("#181011"),
    new Color("#241112")
  ]

  gradient.locations = [
    0.00,
    0.48,
    0.68,
    0.86,
    1.00
  ]

  return gradient
}


// ============================================================
// LAST.FM
// ============================================================

function apiURL(method, parameters = {}) {
  const parts = [
    `method=${encode(method)}`,
    `api_key=${encode(CONFIG.apiKey)}`,
    "format=json"
  ]

  for (const [key, value] of Object.entries(parameters)) {
    parts.push(
      `${encode(key)}=${encode(value)}`
    )
  }

  return `${CONFIG.apiBase}?${parts.join("&")}`
}


async function loadJSON(url) {
  const request = new Request(url)

  request.timeoutInterval = 20

  request.headers = {
    "User-Agent":
      "Scriptable Last.fm Listening History Widget/1.0"
  }

  const response = await request.loadJSON()

  if (response?.error) {
    throw new Error(
      `Last.fm ${response.error}: ${response.message}`
    )
  }

  return response
}


// ============================================================
// PROFILE
// ============================================================

async function fetchProfile() {
  const response = await loadJSON(
    apiURL(
      "user.getInfo",
      {
        user: CONFIG.username
      }
    )
  )

  const user = response?.user

  return {
    scrobbles:
      Number(user?.playcount || 0),

    registered:
      Number(
        user?.registered?.unixtime || 0
      )
  }
}


// ============================================================
// DATE BOUNDARIES
// ============================================================

function startOfYearUnix(year) {
  return Math.floor(
    Date.UTC(
      year,
      0,
      1,
      0,
      0,
      0
    ) / 1000
  )
}


function startOfNextYearUnix(year) {
  return startOfYearUnix(year + 1)
}


function currentUnix() {
  return Math.floor(Date.now() / 1000)
}


// ============================================================
// ANNUAL CACHE
// ============================================================

function createEmptyCache() {
  return {
    version: 1,
    username: CONFIG.username,
    years: {},
    updatedAt: 0
  }
}


function loadAnnualCache() {
  try {
    if (!fm.fileExists(annualCachePath)) {
      return createEmptyCache()
    }

    const cache = JSON.parse(
      fm.readString(annualCachePath)
    )

    if (
      cache?.version !== 1 ||
      cache?.username !== CONFIG.username ||
      typeof cache?.years !== "object"
    ) {
      return createEmptyCache()
    }

    return cache
  } catch (error) {
    console.log(
      `Annual cache read failed: ${error}`
    )

    return createEmptyCache()
  }
}


function saveAnnualCache(cache) {
  try {
    cache.updatedAt = Date.now()

    fm.writeString(
      annualCachePath,
      JSON.stringify(cache)
    )
  } catch (error) {
    console.log(
      `Annual cache write failed: ${error}`
    )
  }
}


// ============================================================
// YEAR TOTAL
// ============================================================

async function fetchYearTotal(
  year,
  isCurrentYear
) {
  const from = startOfYearUnix(year)

  const to = isCurrentYear
    ? currentUnix()
    : startOfNextYearUnix(year) - 1

  const response = await loadJSON(
    apiURL(
      "user.getRecentTracks",
      {
        user: CONFIG.username,
        from,
        to,
        limit: 1,
        page: 1,
        extended: 0
      }
    )
  )

  const total = Number(
    response
      ?.recenttracks
      ?.["@attr"]
      ?.total || 0
  )

  return {
    year,
    scrobbles: total,
    from,
    to,
    complete: !isCurrentYear,
    fetchedAt: Date.now()
  }
}


// ============================================================
// BUILD HISTORY
// ============================================================

async function buildHistory(
  profile,
  cache
) {
  const currentYear =
    new Date().getFullYear()

  const registeredDate =
    profile.registered
      ? new Date(profile.registered * 1000)
      : null

  const firstYear =
    registeredDate
      ? registeredDate.getFullYear()
      : currentYear

  const historicalMissing = []

  for (
    let year = firstYear;
    year < currentYear;
    year++
  ) {
    const cached =
      cache.years[String(year)]

    if (
      !cached ||
      cached.complete !== true
    ) {
      historicalMissing.push(year)
    }
  }


  // ----------------------------------------------------------
  // ONE-TIME HISTORICAL BUILD
  // ----------------------------------------------------------

  if (historicalMissing.length > 0) {
    console.log(
      `Building annual history: ` +
      `${historicalMissing.length} ` +
      `historical year(s) missing.`
    )
  }

  for (
    let index = 0;
    index < historicalMissing.length;
    index++
  ) {
    const year =
      historicalMissing[index]

    try {
      const result =
        await fetchYearTotal(
          year,
          false
        )

      cache.years[String(year)] =
        result

      // Persist immediately so an interrupted initial build
      // resumes from the last successful year.
      saveAnnualCache(cache)

      console.log(
        `${year}: ` +
        `${formatNumber(result.scrobbles)} cached.`
      )
    } catch (error) {
      console.log(
        `${year} failed: ${error}`
      )
    }

    if (
      index <
      historicalMissing.length - 1
    ) {
      await sleep(
        CONFIG.initialBuildDelayMs
      )
    }
  }


  // ----------------------------------------------------------
  // CURRENT YEAR
  // ----------------------------------------------------------
  //
  // The current year is the only completed-cache value that
  // changes during normal widget operation. If Last.fm fails,
  // the previously cached value remains untouched.

  try {
    const current =
      await fetchYearTotal(
        currentYear,
        true
      )

    cache.years[String(currentYear)] =
      current

    saveAnnualCache(cache)
  } catch (error) {
    console.log(
      `Current-year refresh failed; ` +
      `using cached value: ${error}`
    )
  }


  // ----------------------------------------------------------
  // OUTPUT
  // ----------------------------------------------------------

  const years = []

  for (
    let year = firstYear;
    year <= currentYear;
    year++
  ) {
    const cached =
      cache.years[String(year)]

    years.push({
      year,

      scrobbles:
        Number(
          cached?.scrobbles || 0
        ),

      available:
        Boolean(cached)
    })
  }

  const missingYears =
    years.filter(
      item => !item.available
    )

  return {
    firstYear,
    currentYear,
    years,
    missingYears,
    complete:
      missingYears.length === 0
  }
}


// ============================================================
// LOGO
// ============================================================

async function getLogo() {
  if (fm.fileExists(logoCachePath)) {
    try {
      return fm.readImage(
        logoCachePath
      )
    } catch (_) {}
  }

  try {
    const request =
      new Request(CONFIG.logoURL)

    request.timeoutInterval = 20

    const image =
      await request.loadImage()

    try {
      fm.writeImage(
        logoCachePath,
        image
      )
    } catch (_) {}

    return image
  } catch (error) {
    console.log(
      `Logo failed: ${error}`
    )

    return null
  }
}


// ============================================================
// CHART
// ============================================================

function createHistoryChart(
  history,
  width = 300,
  height = 58
) {
  const context = new DrawContext()

  context.size =
    new Size(width, height)

  context.opaque = false
  context.respectScreenScale = true

  const years = history.years

  if (!years.length) {
    return context.getImage()
  }

  const maximum =
    Math.max(
      1,
      ...years.map(
        item => item.scrobbles
      )
    )

  const baselineY = height - 1


  // ----------------------------------------------------------
  // BASELINE
  // ----------------------------------------------------------

  context.setFillColor(
    CONFIG.baselineColor
  )

  context.fillRect(
    new Rect(
      0,
      baselineY,
      width,
      1
    )
  )


  // ----------------------------------------------------------
  // BARS
  // ----------------------------------------------------------

  const count = years.length
  const gap = 2

  const barWidth =
    Math.max(
      3,
      (
        width -
        gap * (count - 1)
      ) / count
    )

  const maximumBarHeight =
    height - 3

  for (
    let index = 0;
    index < count;
    index++
  ) {
    const item = years[index]

    if (!item.available) {
      continue
    }

    const ratio =
      item.scrobbles / maximum

    let barHeight = 0

    if (item.scrobbles > 0) {
      barHeight =
        Math.max(
          2,
          ratio *
          maximumBarHeight
        )
    }

    if (barHeight <= 0) {
      continue
    }

    const x =
      index *
      (barWidth + gap)

    const y =
      baselineY -
      barHeight

    const path = new Path()

    path.addRoundedRect(
      new Rect(
        x,
        y,
        barWidth,
        barHeight
      ),
      2,
      2
    )

    context.addPath(path)

    context.setFillColor(
      item.year === history.currentYear
        ? CONFIG.lastfmRed
        : CONFIG.historicalBarColor
    )

    context.fillPath()
  }

  return context.getImage()
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(
  profile,
  history
) {
  const widget = new ListWidget()

  widget.backgroundGradient =
    createBackgroundGradient()

  // Standard Last.fm medium-widget suite geometry.
  widget.setPadding(
    15,
    17,
    14,
    17
  )

  widget.url = CONFIG.profileURL


  // ==========================================================
  // HEADER
  // ==========================================================

  const header = widget.addStack()

  header.layoutHorizontally()
  header.centerAlignContent()

  const logo = await getLogo()

  if (logo) {
    const logoView =
      header.addImage(logo)

    logoView.imageSize =
      new Size(68, 17)

    logoView.applyFittingContentMode()
  } else {
    addText(
      header,
      "last.fm",
      Font.boldSystemFont(18),
      CONFIG.lastfmRed
    )
  }

  header.addSpacer()

  addText(
    header,
    "HISTORY",
    Font.semiboldSystemFont(8),
    CONFIG.secondaryText,
    "right"
  )


  widget.addSpacer(8)


  // ==========================================================
  // HEADLINE
  // ==========================================================

  const stats = widget.addStack()

  stats.layoutHorizontally()


  // ----------------------------------------------------------
  // SCROBBLES
  // ----------------------------------------------------------

  const left = stats.addStack()

  left.layoutVertically()

  addText(
    left,
    formatNumber(profile.scrobbles),
    Font.boldSystemFont(18),
    CONFIG.primaryText
  )

  left.addSpacer(1)

  addText(
    left,
    "SCROBBLES",
    Font.semiboldSystemFont(8),
    CONFIG.secondaryText
  )


  stats.addSpacer()


  // ----------------------------------------------------------
  // YEARS SHOWN
  // ----------------------------------------------------------

  const right = stats.addStack()

  right.layoutVertically()

  const yearCount =
    history.currentYear -
    history.firstYear + 1

  const yearsValue =
    addText(
      right,
      yearCount,
      Font.boldSystemFont(18),
      CONFIG.primaryText,
      "right"
    )

  yearsValue.rightAlignText()

  right.addSpacer(1)

  const yearsLabel =
    addText(
      right,
      "YEARS SHOWN",
      Font.semiboldSystemFont(7),
      CONFIG.secondaryText,
      "right"
    )

  yearsLabel.rightAlignText()


  widget.addSpacer(6)


  // ==========================================================
  // CHART
  // ==========================================================

  const chart =
    widget.addImage(
      createHistoryChart(
        history,
        300,
        58
      )
    )

  chart.imageSize =
    new Size(300, 58)


  // ==========================================================
  // AXIS
  // ==========================================================

  widget.addSpacer(3)

  const axis = widget.addStack()

  axis.layoutHorizontally()
  axis.centerAlignContent()

  addText(
    axis,
    String(history.firstYear),
    Font.semiboldSystemFont(7),
    CONFIG.tertiaryText
  )

  axis.addSpacer()

  const midpoint =
    Math.round(
      (
        history.firstYear +
        history.currentYear
      ) / 2
    )

  const middle =
    addText(
      axis,
      String(midpoint),
      Font.semiboldSystemFont(7),
      CONFIG.tertiaryText,
      "center"
    )

  middle.centerAlignText()

  axis.addSpacer()

  const end =
    addText(
      axis,
      String(history.currentYear),
      Font.semiboldSystemFont(7),
      CONFIG.tertiaryText,
      "right"
    )

  end.rightAlignText()


  // ==========================================================
  // FOOTER
  // ==========================================================

  widget.addSpacer(5)

  const footer = widget.addStack()

  footer.layoutHorizontally()
  footer.centerAlignContent()

  footer.size =
    new Size(0, 10)


  if (history.complete) {
    addText(
      footer,
      `${history.firstYear}–${history.currentYear}`,
      Font.semiboldSystemFont(7),
      CONFIG.tertiaryText
    )
  } else {
    addText(
      footer,
      `BUILDING HISTORY · ` +
      `${history.missingYears.length} ` +
      `YEAR${
        history.missingYears.length === 1
          ? ""
          : "S"
      } LEFT`,
      Font.semiboldSystemFont(7),
      CONFIG.tertiaryText,
      "left",
      1,
      0.75
    )
  }

  footer.addSpacer()

  const current =
    history.years.find(
      item =>
        item.year ===
        history.currentYear
    )

  const currentYearText =
    addText(
      footer,
      `${formatNumber(
        current?.scrobbles || 0
      )} IN ${history.currentYear}`,
      Font.semiboldSystemFont(7),
      CONFIG.lastfmRed,
      "right"
    )

  currentYearText.rightAlignText()


  // ==========================================================
  // REFRESH
  // ==========================================================

  widget.refreshAfterDate =
    new Date(
      Date.now() +
      CONFIG.refreshMinutes *
      60 *
      1000
    )

  return widget
}


// ============================================================
// ERROR STATE
// ============================================================

function createErrorWidget(error) {
  const widget = new ListWidget()

  widget.backgroundGradient =
    createBackgroundGradient()

  widget.setPadding(
    15,
    17,
    14,
    17
  )

  addText(
    widget,
    "last.fm",
    Font.boldSystemFont(18),
    CONFIG.lastfmRed
  )

  widget.addSpacer(12)

  addText(
    widget,
    "Unable to load history",
    Font.boldSystemFont(15),
    CONFIG.primaryText
  )

  widget.addSpacer(4)

  addText(
    widget,
    String(error?.message || error),
    Font.systemFont(8),
    CONFIG.secondaryText,
    "left",
    4,
    0.75
  )

  return widget
}


// ============================================================
// MAIN
// ============================================================

let widget

try {
  const profile =
    await fetchProfile()

  const cache =
    loadAnnualCache()

  const history =
    await buildHistory(
      profile,
      cache
    )

  widget =
    await createWidget(
      profile,
      history
    )
} catch (error) {
  console.log(error)

  widget =
    createErrorWidget(error)
}


if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}

Script.complete()