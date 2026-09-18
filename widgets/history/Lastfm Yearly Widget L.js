// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: trophy;
// Last.fm Listening History — Large
// Locked version v1.0
//
// Large annual listening-history widget.
//
// Uses the same permanent annual-history cache as the medium
// widget. Historical years are fetched once and cached.
// The current calendar year is refreshed.
//
// MULTIPLE WIDGET INSTANCES
//
// Widget Parameter:
//
//   latest
//     Shows the latest 15 calendar years.
//     Example: 2012–2026
//
//   older
//     Shows the previous 15-year page.
//     Example: 2006–2020
//
// You can therefore add this same Scriptable script to the
// Home Screen more than once and assign a different Widget
// Parameter to each instance.
//
// The two pages intentionally overlap where the complete
// history is shorter than 30 years.
//
// Layout:
// - Standard Last.fm suite styling.
// - 15 annual rows.
// - Wider chart area.
// - Dedicated scrobble-count column.
// - Current year highlighted in Last.fm red.
// - No interactive paging controls.


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
  subtleText: new Color("#56565C"),

  lastfmRed: new Color("#D92323"),

  barColor: new Color("#929297"),
  barBackground: new Color("#29292D"),

  refreshMinutes: 120,

  yearsPerPage: 15,

  cacheDirectory: "LastFMHistoryWidget",
  annualCacheFile: "annual-history-v1.json",
  logoCacheFile: "lastfm-logo.png",

  initialBuildDelayMs: 300
}


// ============================================================
// FILE SYSTEM
// ============================================================

const fm = FileManager.local()

const cacheDirectory = fm.joinPath(
  fm.documentsDirectory(),
  CONFIG.cacheDirectory
)

if (!fm.fileExists(cacheDirectory)) {
  fm.createDirectory(
    cacheDirectory,
    true
  )
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
// BASIC HELPERS
// ============================================================

function encode(value) {
  return encodeURIComponent(
    String(value)
  )
}


function formatNumber(value) {
  return Number(
    value || 0
  ).toLocaleString()
}


function sleep(ms) {
  return new Promise(
    resolve =>
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
  const item =
    stack.addText(String(text))

  item.font = font
  item.textColor = color
  item.lineLimit = lineLimit
  item.minimumScaleFactor =
    minimumScaleFactor

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
  const gradient =
    new LinearGradient()

  gradient.startPoint =
    new Point(0.15, 0.85)

  gradient.endPoint =
    new Point(1.0, 0.0)

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
// LAST.FM NETWORK
// ============================================================

function apiURL(
  method,
  parameters = {}
) {
  const parts = [
    `method=${encode(method)}`,
    `api_key=${encode(CONFIG.apiKey)}`,
    "format=json"
  ]

  for (
    const [key, value]
    of Object.entries(parameters)
  ) {
    parts.push(
      `${encode(key)}=${encode(value)}`
    )
  }

  return (
    `${CONFIG.apiBase}?` +
    parts.join("&")
  )
}


async function loadJSON(url) {
  const request =
    new Request(url)

  request.timeoutInterval = 20

  request.headers = {
    "User-Agent":
      "Scriptable Last.fm History Large Widget/1.0"
  }

  const response =
    await request.loadJSON()

  if (response?.error) {
    throw new Error(
      `Last.fm ${response.error}: ` +
      `${response.message}`
    )
  }

  return response
}


// ============================================================
// PROFILE
// ============================================================

async function fetchProfile() {
  const response =
    await loadJSON(
      apiURL(
        "user.getInfo",
        {
          user: CONFIG.username
        }
      )
    )

  const user =
    response?.user

  return {
    scrobbles:
      Number(
        user?.playcount || 0
      ),

    registered:
      Number(
        user
          ?.registered
          ?.unixtime || 0
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
  return startOfYearUnix(
    year + 1
  )
}


function currentUnix() {
  return Math.floor(
    Date.now() / 1000
  )
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
    if (
      !fm.fileExists(
        annualCachePath
      )
    ) {
      return createEmptyCache()
    }

    const cache =
      JSON.parse(
        fm.readString(
          annualCachePath
        )
      )

    if (
      cache?.version !== 1 ||
      cache?.username !==
        CONFIG.username ||
      typeof cache?.years !==
        "object"
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
    cache.updatedAt =
      Date.now()

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
// FETCH ONE YEAR
// ============================================================

async function fetchYearTotal(
  year,
  isCurrentYear
) {
  const from =
    startOfYearUnix(year)

  let to

  if (isCurrentYear) {
    to = currentUnix()
  } else {
    to =
      startOfNextYearUnix(year) - 1
  }

  const response =
    await loadJSON(
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

  const total =
    Number(
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

    complete:
      !isCurrentYear,

    fetchedAt:
      Date.now()
  }
}


// ============================================================
// BUILD / REFRESH COMPLETE HISTORY
// ============================================================

async function buildHistory(
  profile,
  cache
) {
  const now =
    new Date()

  const currentYear =
    now.getFullYear()

  const registeredDate =
    profile.registered
      ? new Date(
          profile.registered * 1000
        )
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
      cache.years[
        String(year)
      ]

    if (
      !cached ||
      cached.complete !== true
    ) {
      historicalMissing.push(year)
    }
  }


  // ----------------------------------------------------------
  // ONE-OFF HISTORICAL CACHE BUILD
  // ----------------------------------------------------------

  for (
    let index = 0;
    index <
      historicalMissing.length;
    index++
  ) {
    const year =
      historicalMissing[index]

    try {
      console.log(
        `Fetching ${year} ` +
        `(${index + 1}/` +
        `${historicalMissing.length})…`
      )

      const result =
        await fetchYearTotal(
          year,
          false
        )

      cache.years[
        String(year)
      ] = result

      // Save after every successful year so an interrupted
      // first build resumes rather than starting again.
      saveAnnualCache(cache)

      console.log(
        `${year}: ` +
        `${formatNumber(
          result.scrobbles
        )} scrobbles cached.`
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

  try {
    const current =
      await fetchYearTotal(
        currentYear,
        true
      )

    cache.years[
      String(currentYear)
    ] = current

    saveAnnualCache(cache)
  } catch (error) {
    console.log(
      `Current year refresh failed: ${error}`
    )
  }


  // ----------------------------------------------------------
  // COMPLETE OUTPUT
  // ----------------------------------------------------------

  const years = []

  for (
    let year = firstYear;
    year <= currentYear;
    year++
  ) {
    const cached =
      cache.years[
        String(year)
      ]

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

  return {
    firstYear,
    currentYear,
    years
  }
}


// ============================================================
// WIDGET PARAMETER / PAGE
// ============================================================

function getRequestedPage() {
  const parameter =
    String(
      args.widgetParameter || "latest"
    )
      .trim()
      .toLowerCase()

  if (
    parameter === "older" ||
    parameter === "old" ||
    parameter === "1"
  ) {
    return "older"
  }

  return "latest"
}


function createPage(
  history,
  requestedPage
) {
  const totalYears =
    history.years.length

  const pageSize =
    CONFIG.yearsPerPage

  let startIndex

  if (requestedPage === "older") {

    // Previous 15-year block.
    //
    // With 21 years of history this gives:
    //
    //   latest = 2012–2026
    //   older  = 2006–2020
    //
    // This deliberately overlaps because there are fewer
    // than 30 years available.

    startIndex = 0

  } else {

    startIndex =
      Math.max(
        0,
        totalYears - pageSize
      )
  }

  const years =
    history.years.slice(
      startIndex,
      startIndex + pageSize
    )

  return {
    mode: requestedPage,
    years,

    firstYear:
      years[0]?.year ??
      history.firstYear,

    lastYear:
      years[
        years.length - 1
      ]?.year ??
      history.currentYear,

    yearCount:
      years.length
  }
}


// ============================================================
// LOGO CACHE
// ============================================================

async function getLogo() {
  if (
    fm.fileExists(
      logoCachePath
    )
  ) {
    try {
      return fm.readImage(
        logoCachePath
      )
    } catch (_) {}
  }

  try {
    const request =
      new Request(
        CONFIG.logoURL
      )

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
// BAR
// ============================================================

function createBar(
  value,
  maximum,
  isCurrentYear,
  width = 205,
  height = 6
) {
  const context =
    new DrawContext()

  context.size =
    new Size(
      width,
      height
    )

  context.opaque = false
  context.respectScreenScale = true


  // ----------------------------------------------------------
  // BACKGROUND
  // ----------------------------------------------------------

  const background =
    new Path()

  background.addRoundedRect(
    new Rect(
      0,
      0,
      width,
      height
    ),
    height / 2,
    height / 2
  )

  context.addPath(background)

  context.setFillColor(
    CONFIG.barBackground
  )

  context.fillPath()


  // ----------------------------------------------------------
  // VALUE
  // ----------------------------------------------------------

  if (
    value > 0 &&
    maximum > 0
  ) {
    const ratio =
      Math.min(
        1,
        value / maximum
      )

    const valueWidth =
      Math.max(
        height,
        width * ratio
      )

    const foreground =
      new Path()

    foreground.addRoundedRect(
      new Rect(
        0,
        0,
        valueWidth,
        height
      ),
      height / 2,
      height / 2
    )

    context.addPath(
      foreground
    )

    context.setFillColor(
      isCurrentYear
        ? CONFIG.lastfmRed
        : CONFIG.barColor
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
  history,
  page
) {
  const widget =
    new ListWidget()

  widget.backgroundGradient =
    createBackgroundGradient()

  widget.setPadding(
    17,
    18,
    16,
    18
  )

  widget.url =
    CONFIG.profileURL


  // ==========================================================
  // HEADER
  // ==========================================================

  const header =
    widget.addStack()

  header.layoutHorizontally()
  header.centerAlignContent()

  const logo =
    await getLogo()

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


  widget.addSpacer(11)


  // ==========================================================
  // HEADLINE
  // ==========================================================

  const headline =
    widget.addStack()

  headline.layoutHorizontally()


  // ----------------------------------------------------------
  // LIFETIME SCROBBLES
  // ----------------------------------------------------------

  const lifetime =
    headline.addStack()

  lifetime.layoutVertically()

  addText(
    lifetime,
    formatNumber(
      profile.scrobbles
    ),
    Font.boldSystemFont(20),
    CONFIG.primaryText
  )

  lifetime.addSpacer(1)

  addText(
    lifetime,
    "SCROBBLES",
    Font.semiboldSystemFont(8),
    CONFIG.secondaryText
  )


  headline.addSpacer()


  // ----------------------------------------------------------
  // PERIOD
  // ----------------------------------------------------------

  const period =
    headline.addStack()

  period.layoutVertically()

  const periodValue =
    addText(
      period,
      `${page.firstYear}–${page.lastYear}`,
      Font.boldSystemFont(16),
      CONFIG.primaryText,
      "right"
    )

  periodValue.rightAlignText()

  period.addSpacer(1)

  const periodLabel =
    addText(
      period,
      `${page.yearCount} YEARS`,
      Font.semiboldSystemFont(7),
      CONFIG.secondaryText,
      "right"
    )

  periodLabel.rightAlignText()


  widget.addSpacer(13)


  // ==========================================================
  // COLUMN HEADERS
  // ==========================================================

  const headings =
    widget.addStack()

  headings.layoutHorizontally()
  headings.centerAlignContent()


  // YEAR
  const yearHeading =
    headings.addStack()

  yearHeading.size =
    new Size(38, 10)

  addText(
    yearHeading,
    "YEAR",
    Font.semiboldSystemFont(7),
    CONFIG.tertiaryText
  )


  headings.addSpacer(9)


  // BAR COLUMN
  const barHeading =
    headings.addStack()

  barHeading.size =
    new Size(205, 10)


  headings.addSpacer(10)


  // SCROBBLES
  const countHeading =
    headings.addStack()

  countHeading.size =
    new Size(55, 10)

  const scrobblesHeading =
    addText(
      countHeading,
      "SCROBBLES",
      Font.semiboldSystemFont(6.5),
      CONFIG.tertiaryText,
      "right",
      1,
      0.85
    )

  scrobblesHeading.rightAlignText()


  widget.addSpacer(6)


  // ==========================================================
  // YEAR ROWS
  // ==========================================================

  const maximum =
    Math.max(
      1,
      ...page.years.map(
        item =>
          item.scrobbles
      )
    )

  for (
    let index = 0;
    index < page.years.length;
    index++
  ) {
    const item =
      page.years[index]

    const isCurrentYear =
      item.year ===
      history.currentYear


    const row =
      widget.addStack()

    row.layoutHorizontally()
    row.centerAlignContent()

    row.size =
      new Size(0, 13)


    // --------------------------------------------------------
    // YEAR
    // --------------------------------------------------------

    const yearColumn =
      row.addStack()

    yearColumn.size =
      new Size(38, 13)

    addText(
      yearColumn,
      String(item.year),
      Font.semiboldSystemFont(8),
      isCurrentYear
        ? CONFIG.lastfmRed
        : CONFIG.secondaryText
    )


    row.addSpacer(9)


    // --------------------------------------------------------
    // BAR
    // --------------------------------------------------------

    const barColumn =
      row.addStack()

    barColumn.size =
      new Size(205, 13)

    barColumn.centerAlignContent()

    if (item.available) {
      const bar =
        barColumn.addImage(
          createBar(
            item.scrobbles,
            maximum,
            isCurrentYear,
            205,
            6
          )
        )

      bar.imageSize =
        new Size(
          205,
          6
        )
    }


    row.addSpacer(10)


    // --------------------------------------------------------
    // SCROBBLE COUNT
    // --------------------------------------------------------

    const countColumn =
      row.addStack()

    countColumn.size =
      new Size(55, 13)

    const count =
      addText(
        countColumn,
        item.available
          ? formatNumber(
              item.scrobbles
            )
          : "—",
        Font.semiboldSystemFont(8),
        isCurrentYear
          ? CONFIG.lastfmRed
          : CONFIG.secondaryText,
        "right"
      )

    count.rightAlignText()


    // Consistent row rhythm.
    if (
      index <
      page.years.length - 1
    ) {
      widget.addSpacer(2)
    }
  }


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
// ERROR WIDGET
// ============================================================

function createErrorWidget(error) {
  const widget =
    new ListWidget()

  widget.backgroundGradient =
    createBackgroundGradient()

  widget.setPadding(
    17,
    18,
    16,
    18
  )

  addText(
    widget,
    "last.fm",
    Font.boldSystemFont(18),
    CONFIG.lastfmRed
  )

  widget.addSpacer(14)

  addText(
    widget,
    "Unable to load history",
    Font.boldSystemFont(16),
    CONFIG.primaryText
  )

  widget.addSpacer(5)

  addText(
    widget,
    String(
      error?.message || error
    ),
    Font.systemFont(8),
    CONFIG.secondaryText,
    "left",
    5,
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

  const requestedPage =
    getRequestedPage()

  const page =
    createPage(
      history,
      requestedPage
    )

  console.log(
    `History page: ` +
    `${page.mode} · ` +
    `${page.firstYear}–` +
    `${page.lastYear}`
  )

  widget =
    await createWidget(
      profile,
      history,
      page
    )

} catch (error) {

  console.log(error)

  widget =
    createErrorWidget(error)
}


// ============================================================
// PRESENT
// ============================================================

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentLarge()
}

Script.complete()