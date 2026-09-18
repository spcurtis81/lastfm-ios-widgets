// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: chart-bar;
// ============================================================
// LAST.FM THIS WEEK WIDGET — v0.1
//
// Medium Scriptable widget.
//
// Displays listening activity for the current calendar week,
// Monday through Sunday:
//
// - Total scrobbles
// - Unique artists
// - Unique albums
// - Daily scrobble bar chart
// - Top artist for the week
//
// Current-week data is built from user.getRecentTracks so all
// statistics use the same Monday-to-now time period.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase:
    "https://ws.audioscrobbler.com/2.0/",

  get profileURL() {
    return `https://www.last.fm/user/${encodeURIComponent(this.username)}`
  },

  get libraryURL() {
    return `https://www.last.fm/user/${encodeURIComponent(this.username)}/library`
  },

  logoURL:
    "https://www.last.fm/static/images/logo_static.adb61955725c.png",

  primaryText:
    Color.white(),

  secondaryText:
    new Color("#96969D"),

  tertiaryText:
    new Color("#68686D"),

  lastfmRed:
    new Color("#D92323"),

  // This widget does not require near-real-time updates.
  refreshMinutes: 60,

  // Last.fm allows pagination of recent tracks. A high page
  // size keeps the number of requests low for normal weeks.
  pageLimit: 200,

  // Safety cap to avoid unexpectedly large request loops.
  maxPages: 10,

  cacheDirectory:
    "LastFMWeekWidget",

  dataCacheFile:
    "week-data.json",

  logoCacheFile:
    "lastfm-logo.png"
}


// ============================================================
// LOCAL CACHE
// ============================================================

const fm =
  FileManager.local()

const cacheDir =
  fm.joinPath(
    fm.documentsDirectory(),
    CONFIG.cacheDirectory
  )

if (!fm.fileExists(cacheDir)) {
  fm.createDirectory(cacheDir)
}

const dataCachePath =
  fm.joinPath(
    cacheDir,
    CONFIG.dataCacheFile
  )

const logoCachePath =
  fm.joinPath(
    cacheDir,
    CONFIG.logoCacheFile
  )


// ============================================================
// LAST.FM API
// ============================================================

async function lastfm(
  method,
  extra = {}
) {

  const params = {
    method,
    api_key: CONFIG.apiKey,
    format: "json",
    ...extra
  }

  const query =
    Object.entries(params)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      .join("&")

  const request =
    new Request(
      `${CONFIG.apiBase}?${query}`
    )

  request.headers = {
    "User-Agent":
      "LastfmWidgets-Scriptable-ThisWeek/0.1"
  }

  request.timeoutInterval = 15

  const json =
    await request.loadJSON()

  if (json.error) {
    throw new Error(
      `Last.fm ${json.error}: ${json.message}`
    )
  }

  return json
}


// ============================================================
// WEEK RANGE
//
// Monday 00:00 local time through the current moment.
// ============================================================

function getWeekRange() {

  const now =
    new Date()

  const start =
    new Date(now)

  start.setHours(
    0,
    0,
    0,
    0
  )

  // JavaScript:
  // Sunday = 0
  // Monday = 1
  //
  // Convert this into days elapsed since Monday.
  const daysSinceMonday =
    (start.getDay() + 6) % 7

  start.setDate(
    start.getDate() -
    daysSinceMonday
  )

  return {
    start,
    end: now
  }
}


// ============================================================
// TRACK PARSING
// ============================================================

function parseTrack(track) {

  const artist =
    typeof track.artist === "string"
      ? track.artist
      : (
          track.artist?.name ||
          track.artist?.["#text"] ||
          "Unknown artist"
        )

  const album =
    typeof track.album === "string"
      ? track.album
      : (
          track.album?.["#text"] ||
          track.album?.name ||
          ""
        )

  const nowPlaying =
    track["@attr"]?.nowplaying === "true"

  const timestamp =
    Number(
      track.date?.uts || 0
    )

  return {
    title:
      track.name ||
      "Unknown track",

    artist,

    album,

    nowPlaying,

    timestamp
  }
}


// ============================================================
// LOAD CURRENT WEEK
// ============================================================

async function loadWeekTracks() {

  const range =
    getWeekRange()

  const from =
    Math.floor(
      range.start.getTime() /
      1000
    )

  const to =
    Math.floor(
      range.end.getTime() /
      1000
    )

  let page = 1

  let totalPages = 1

  const tracks = []


  do {

    const json =
      await lastfm(
        "user.getRecentTracks",
        {
          user: CONFIG.username,
          from,
          to,
          limit: CONFIG.pageLimit,
          page,
          extended: 1
        }
      )


    let pageTracks =
      json.recenttracks?.track || []


    if (!Array.isArray(pageTracks)) {
      pageTracks = [pageTracks]
    }


    for (const raw of pageTracks) {

      const track =
        parseTrack(raw)

      // A now-playing item is not yet a completed scrobble and
      // therefore is not counted in the weekly statistics.
      if (
        track.nowPlaying ||
        !track.timestamp
      ) {
        continue
      }

      tracks.push(track)
    }


    const attr =
      json.recenttracks?.["@attr"]


    totalPages =
      Number(
        attr?.totalPages || 1
      )


    page++


  } while (
    page <= totalPages &&
    page <= CONFIG.maxPages
  )


  return {
    tracks,
    weekStart:
      range.start.getTime(),

    fetchedAt:
      Date.now()
  }
}


// ============================================================
// WEEK ANALYSIS
// ============================================================

function analyseWeek(raw) {

  const tracks =
    raw.tracks


  // ----------------------------------------------------------
  // UNIQUE ARTISTS
  // ----------------------------------------------------------

  const artists =
    new Set()


  // ----------------------------------------------------------
  // UNIQUE ALBUMS
  //
  // Artist is included in the identity to avoid treating two
  // different albums with the same title as one album.
  // ----------------------------------------------------------

  const albums =
    new Set()


  // ----------------------------------------------------------
  // ARTIST COUNTS
  // ----------------------------------------------------------

  const artistCounts =
    {}


  // ----------------------------------------------------------
  // DAILY COUNTS
  //
  // Index:
  // 0 Monday
  // 1 Tuesday
  // ...
  // 6 Sunday
  // ----------------------------------------------------------

  const daily =
    [0, 0, 0, 0, 0, 0, 0]


  for (const track of tracks) {

    const artistKey =
      track.artist
        .trim()
        .toLowerCase()


    if (artistKey) {

      artists.add(
        artistKey
      )

      if (!artistCounts[artistKey]) {

        artistCounts[artistKey] = {
          name: track.artist,
          count: 0
        }
      }

      artistCounts[
        artistKey
      ].count++
    }


    if (track.album) {

      const albumKey =
        `${artistKey}::${track.album}`
          .trim()
          .toLowerCase()

      albums.add(
        albumKey
      )
    }


    const date =
      new Date(
        track.timestamp *
        1000
      )


    const dayIndex =
      (date.getDay() + 6) % 7


    daily[dayIndex]++
  }


  // ----------------------------------------------------------
  // TOP ARTIST
  // ----------------------------------------------------------

  let topArtist = null


  for (
    const value of
    Object.values(artistCounts)
  ) {

    if (
      !topArtist ||
      value.count >
      topArtist.count
    ) {

      topArtist = value
    }
  }


  return {
    scrobbles:
      tracks.length,

    artists:
      artists.size,

    albums:
      albums.size,

    daily,

    topArtist,

    weekStart:
      raw.weekStart,

    fetchedAt:
      raw.fetchedAt
  }
}


// ============================================================
// DATA CACHE
// ============================================================

function saveDataCache(data) {

  try {

    fm.writeString(
      dataCachePath,
      JSON.stringify(data)
    )

  } catch (error) {

    console.log(
      `Unable to save data cache: ${error}`
    )
  }
}


function loadDataCache() {

  try {

    if (!fm.fileExists(dataCachePath)) {
      return null
    }

    return JSON.parse(
      fm.readString(dataCachePath)
    )

  } catch (error) {

    console.log(
      `Unable to read data cache: ${error}`
    )

    return null
  }
}


async function getData() {

  try {

    const raw =
      await loadWeekTracks()

    const live =
      analyseWeek(raw)

    saveDataCache(live)

    return {
      ...live,
      cached: false
    }

  } catch (error) {

    console.log(
      `Live Last.fm request failed: ${error}`
    )


    const cached =
      loadDataCache()


    if (cached) {

      return {
        ...cached,
        cached: true
      }
    }


    throw error
  }
}


// ============================================================
// LAST.FM LOGO
// ============================================================

async function getLastFMLogo() {

  if (fm.fileExists(logoCachePath)) {

    try {

      return fm.readImage(
        logoCachePath
      )

    } catch {}
  }


  try {

    const request =
      new Request(
        CONFIG.logoURL
      )

    request.timeoutInterval = 10


    const logo =
      await request.loadImage()


    try {

      fm.writeImage(
        logoCachePath,
        logo
      )

    } catch {}


    return logo

  } catch (error) {

    console.log(
      `Logo download failed: ${error}`
    )

    return null
  }
}


// ============================================================
// BACKGROUND
// ============================================================

function applyBackground(widget) {

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

  widget.backgroundGradient =
    gradient
}


// ============================================================
// LAST.FM BRANDING
// ============================================================

async function addLastFMBrand(parent) {

  const logo =
    await getLastFMLogo()


  if (logo) {

    const image =
      parent.addImage(logo)

    image.imageSize =
      new Size(68, 17)

    image.applyFittingContentMode()

    return
  }


  const fallback =
    parent.addText(
      "last.fm"
    )

  fallback.font =
    Font.boldSystemFont(13)

  fallback.textColor =
    CONFIG.lastfmRed
}


// ============================================================
// NUMBER FORMATTING
// ============================================================

function formatNumber(value) {

  return Number(value)
    .toLocaleString("en-GB")
}


// ============================================================
// STAT
// ============================================================

function addStat(
  parent,
  value,
  label
) {

  const stack =
    parent.addStack()

  stack.layoutVertically()


  const number =
    stack.addText(
      formatNumber(value)
    )

  number.font =
    Font.boldSystemFont(17)

  number.textColor =
    CONFIG.primaryText

  number.lineLimit = 1


  stack.addSpacer(2)


  const caption =
    stack.addText(
      label.toUpperCase()
    )

  caption.font =
    Font.semiboldSystemFont(7)

  caption.textColor =
    CONFIG.secondaryText

  caption.lineLimit = 1
}


// ============================================================
// BAR CHART
// ============================================================

function createWeekChart(
  daily,
  weekStart
) {

  const width = 292
  const height = 43

  const context =
    new DrawContext()

  context.size =
    new Size(
      width,
      height
    )

  context.opaque = false

  context.respectScreenScale = true


  const maxValue =
    Math.max(
      1,
      ...daily
    )


  const barWidth = 24
  const gap = 17

  const chartHeight = 29

  const startX = 5


  const now =
    new Date()

  const currentDayIndex =
    (now.getDay() + 6) % 7


  for (
    let index = 0;
    index < 7;
    index++
  ) {

    const x =
      startX +
      index *
      (barWidth + gap)


    const value =
      daily[index]


    // --------------------------------------------------------
    // BAR
    // --------------------------------------------------------

    const barHeight =
      value > 0
        ? Math.max(
            3,
            chartHeight *
            value /
            maxValue
          )
        : 2


    const y =
      chartHeight -
      barHeight


    // Future days are deliberately very subtle.
    if (index > currentDayIndex) {

      context.setFillColor(
        new Color(
          "#343438",
          0.55
        )
      )

    } else if (
      index === currentDayIndex
    ) {

      context.setFillColor(
        CONFIG.lastfmRed
      )

    } else {

      context.setFillColor(
        new Color("#737379")
      )
    }


    const path =
      new Path()

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

    context.fillPath()
  }


  return context.getImage()
}


// ============================================================
// DAY LABELS
// ============================================================

function addDayLabels(
  parent
) {

  const labels =
    [
      "M",
      "T",
      "W",
      "T",
      "F",
      "S",
      "S"
    ]


  for (
    let index = 0;
    index < labels.length;
    index++
  ) {

    const slot =
      parent.addStack()

    slot.size =
      new Size(24, 0)

    slot.centerAlignContent()


    const label =
      slot.addText(
        labels[index]
      )

    label.font =
      Font.semiboldSystemFont(7)

    label.textColor =
      CONFIG.tertiaryText


    if (
      index <
      labels.length - 1
    ) {

      parent.addSpacer(17)
    }
  }
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {

  const widget =
    new ListWidget()


  applyBackground(widget)


  // Same design system as the other Last.fm widgets.
  widget.setPadding(
    15,
    17,
    14,
    17
  )


  widget.url =
    CONFIG.libraryURL


  // ==========================================================
  // HEADER
  // ==========================================================

  const header =
    widget.addStack()

  header.centerAlignContent()


  await addLastFMBrand(
    header
  )


  header.addSpacer()


  const heading =
    header.addText(
      "THIS WEEK"
    )

  heading.font =
    Font.semiboldSystemFont(8)

  heading.textColor =
    CONFIG.secondaryText


  widget.addSpacer(9)


  // ==========================================================
  // HEADLINE STATISTICS
  // ==========================================================

  const stats =
    widget.addStack()


  addStat(
    stats,
    data.scrobbles,
    "Scrobbles"
  )


  stats.addSpacer()


  addStat(
    stats,
    data.artists,
    "Artists"
  )


  stats.addSpacer()


  addStat(
    stats,
    data.albums,
    "Albums"
  )


  widget.addSpacer(7)


  // ==========================================================
  // WEEKLY ACTIVITY CHART
  // ==========================================================

  const chart =
    widget.addImage(
      createWeekChart(
        data.daily,
        data.weekStart
      )
    )

  chart.imageSize =
    new Size(
      292,
      43
    )

  chart.applyFittingContentMode()


  // ==========================================================
  // DAY LABELS
  // ==========================================================

  const dayRow =
    widget.addStack()


  addDayLabels(
    dayRow
  )


  widget.addSpacer()


  // ==========================================================
  // TOP ARTIST
  // ==========================================================

  const footer =
    widget.addStack()

  footer.centerAlignContent()


  const label =
    footer.addText(
      "TOP ARTIST"
    )

  label.font =
    Font.semiboldSystemFont(7)

  label.textColor =
    CONFIG.secondaryText


  footer.addSpacer()


  if (data.topArtist) {

    const artist =
      footer.addText(
        `${data.topArtist.name}  ·  ${data.topArtist.count}`
      )

    artist.font =
      Font.semiboldSystemFont(9)

    artist.textColor =
      CONFIG.primaryText

    artist.lineLimit = 1

    artist.minimumScaleFactor = 0.7

  } else {

    const artist =
      footer.addText(
        "No scrobbles yet"
      )

    artist.font =
      Font.systemFont(9)

    artist.textColor =
      CONFIG.secondaryText
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
// ERROR STATE
// ============================================================

function createErrorWidget(error) {

  const widget =
    new ListWidget()


  applyBackground(widget)


  widget.setPadding(
    16,
    16,
    16,
    16
  )


  const title =
    widget.addText(
      "last.fm"
    )

  title.font =
    Font.boldSystemFont(13)

  title.textColor =
    CONFIG.lastfmRed


  widget.addSpacer(10)


  const heading =
    widget.addText(
      "Unable to load this week"
    )

  heading.font =
    Font.boldSystemFont(15)

  heading.textColor =
    CONFIG.primaryText


  widget.addSpacer(5)


  const detail =
    widget.addText(
      error?.message ||
      String(error)
    )

  detail.font =
    Font.systemFont(9)

  detail.textColor =
    CONFIG.secondaryText


  return widget
}


// ============================================================
// RUN
// ============================================================

let widget


try {

  const data =
    await getData()


  console.log(
    JSON.stringify(
      data,
      null,
      2
    )
  )


  widget =
    await createWidget(
      data
    )


} catch (error) {

  console.error(error)


  widget =
    createErrorWidget(
      error
    )
}


if (config.runsInWidget) {

  Script.setWidget(widget)

} else {

  await widget.presentMedium()
}


Script.complete()