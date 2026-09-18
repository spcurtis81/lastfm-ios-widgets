// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: tachometer-alt;
// ============================================================
// LAST.FM THIS WEEK — LARGE v1.0
//
// Large Scriptable widget showing:
//
// - Current-week scrobbles, artists and albums
// - Comparison with the equivalent elapsed period last week
// - Monday–Sunday daily scrobble activity
// - Top three artists
// - Top three albums
//
// Weeks begin Monday at 00:00 local time.
//
// Successful Last.fm responses are cached locally. If Last.fm
// is temporarily unavailable, the widget uses cached data from
// the current week.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase:
    "https://ws.audioscrobbler.com/2.0/",

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

  subtleText:
    new Color("#56565C"),

  lastfmRed:
    new Color("#D92323"),

  refreshMinutes: 60,

  pageLimit: 200,

  maxPages: 20,

  rankingCount: 3,

  cacheDirectory:
    "LastFMWeekLargeWidget",

  // Permanent cache name. Do not version this filename.
  dataCacheFile:
    "week-large-data.json",

  // Previous development cache names. These are checked only
  // when the permanent cache does not yet exist.
  legacyDataCacheFiles: [
    "week-large-v04-data.json",
    "week-large-v03-data.json"
  ],

  logoCacheFile:
    "lastfm-logo.png"
}


// ============================================================
// LOCAL STORAGE
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
      "LastfmWidgets-Scriptable-ThisWeekLarge/1.0"
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
// WEEK HELPERS
// ============================================================

function getWeekStart(date = new Date()) {

  const start =
    new Date(date)

  start.setHours(
    0,
    0,
    0,
    0
  )

  const daysSinceMonday =
    (start.getDay() + 6) % 7

  start.setDate(
    start.getDate() -
    daysSinceMonday
  )

  return start
}


// ============================================================
// DATE RANGES
//
// Current period:
// Monday 00:00 → now
//
// Comparison period:
// Previous Monday 00:00 → equivalent weekday/time
// ============================================================

function getRanges() {

  const now =
    new Date()

  const thisWeekStart =
    getWeekStart(now)

  const previousWeekStart =
    new Date(
      thisWeekStart
    )

  previousWeekStart.setDate(
    previousWeekStart.getDate() - 7
  )

  const elapsed =
    now.getTime() -
    thisWeekStart.getTime()

  const previousEquivalentEnd =
    new Date(
      previousWeekStart.getTime() +
      elapsed
    )

  return {
    now,
    thisWeekStart,
    previousWeekStart,
    previousEquivalentEnd
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

    artist:
      artist.trim(),

    album:
      album.trim(),

    nowPlaying,

    timestamp
  }
}


// ============================================================
// LOAD TRACK RANGE
// ============================================================

async function loadTracks(
  fromDate,
  toDate
) {

  const from =
    Math.floor(
      fromDate.getTime() /
      1000
    )

  const to =
    Math.floor(
      toDate.getTime() /
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

      // A currently playing track has not yet become a
      // completed scrobble.
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

  return tracks
}


// ============================================================
// ANALYSE TRACK SET
// ============================================================

function analyseTracks(tracks) {

  const artists =
    new Set()

  const albums =
    new Set()

  const artistCounts =
    {}

  const albumCounts =
    {}

  for (const track of tracks) {

    const artistKey =
      track.artist
        .trim()
        .toLowerCase()

    // --------------------------------------------------------
    // ARTISTS
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // ALBUMS
    //
    // Artist + album forms the internal identity so albums
    // with identical titles by different artists remain
    // distinct.
    // --------------------------------------------------------

    if (
      artistKey &&
      track.album
    ) {

      const albumKey =
        `${artistKey}::${track.album
          .trim()
          .toLowerCase()}`

      albums.add(
        albumKey
      )

      if (!albumCounts[albumKey]) {

        albumCounts[albumKey] = {
          name: track.album,
          artist: track.artist,
          count: 0
        }
      }

      albumCounts[
        albumKey
      ].count++
    }
  }

  const topArtists =
    Object.values(
      artistCounts
    )
      .sort(
        (a, b) => {

          if (b.count !== a.count) {
            return b.count - a.count
          }

          return a.name.localeCompare(
            b.name
          )
        }
      )
      .slice(
        0,
        CONFIG.rankingCount
      )

  const topAlbums =
    Object.values(
      albumCounts
    )
      .sort(
        (a, b) => {

          if (b.count !== a.count) {
            return b.count - a.count
          }

          const albumCompare =
            a.name.localeCompare(
              b.name
            )

          if (albumCompare !== 0) {
            return albumCompare
          }

          return a.artist.localeCompare(
            b.artist
          )
        }
      )
      .slice(
        0,
        CONFIG.rankingCount
      )

  return {
    scrobbles:
      tracks.length,

    artists:
      artists.size,

    albums:
      albums.size,

    topArtists,

    topAlbums
  }
}


// ============================================================
// DAILY COUNTS
// ============================================================

function getDailyCounts(tracks) {

  const daily =
    [0, 0, 0, 0, 0, 0, 0]

  for (const track of tracks) {

    const date =
      new Date(
        track.timestamp *
        1000
      )

    const dayIndex =
      (date.getDay() + 6) % 7

    daily[
      dayIndex
    ]++
  }

  return daily
}


// ============================================================
// LIVE DATA
// ============================================================

async function loadLiveData() {

  const ranges =
    getRanges()

  const currentTracks =
    await loadTracks(
      ranges.thisWeekStart,
      ranges.now
    )

  const previousTracks =
    await loadTracks(
      ranges.previousWeekStart,
      ranges.previousEquivalentEnd
    )

  const current =
    analyseTracks(
      currentTracks
    )

  const previous =
    analyseTracks(
      previousTracks
    )

  return {
    current: {
      ...current,

      daily:
        getDailyCounts(
          currentTracks
        )
    },

    previous,

    currentDayIndex:
      (ranges.now.getDay() + 6) % 7,

    weekStart:
      ranges.thisWeekStart.getTime(),

    fetchedAt:
      Date.now()
  }
}


// ============================================================
// CACHE VALIDATION
// ============================================================

function isCurrentWeekCache(data) {

  if (
    !data ||
    !data.weekStart
  ) {
    return false
  }

  const currentWeekStart =
    getWeekStart()
      .getTime()

  return (
    Number(data.weekStart) ===
    currentWeekStart
  )
}


// ============================================================
// CACHE READING
// ============================================================

function readCacheFile(path) {

  try {

    if (!fm.fileExists(path)) {
      return null
    }

    return JSON.parse(
      fm.readString(path)
    )

  } catch (error) {

    console.log(
      `Unable to read cache ${path}: ${error}`
    )

    return null
  }
}


// ============================================================
// CACHE WRITING
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


// ============================================================
// CACHE MIGRATION
//
// If the permanent cache does not yet exist, valid data from a
// previous development cache can seed it automatically.
// ============================================================

function migrateLegacyCache() {

  if (fm.fileExists(dataCachePath)) {
    return null
  }

  for (
    const filename of
    CONFIG.legacyDataCacheFiles
  ) {

    const path =
      fm.joinPath(
        cacheDir,
        filename
      )

    const legacy =
      readCacheFile(path)

    if (
      legacy &&
      isCurrentWeekCache(legacy)
    ) {

      console.log(
        `Migrating cache from ${filename}`
      )

      saveDataCache(
        legacy
      )

      return legacy
    }
  }

  return null
}


// ============================================================
// VALID CURRENT-WEEK CACHE
// ============================================================

function loadCurrentWeekCache() {

  let cached =
    readCacheFile(
      dataCachePath
    )

  if (
    cached &&
    isCurrentWeekCache(cached)
  ) {
    return cached
  }

  cached =
    migrateLegacyCache()

  if (
    cached &&
    isCurrentWeekCache(cached)
  ) {
    return cached
  }

  return null
}


// ============================================================
// DATA
//
// Live data is always preferred.
//
// If Last.fm fails, cached data is used only when that cache
// belongs to the current Monday–Sunday week.
// ============================================================

async function getData() {

  try {

    const live =
      await loadLiveData()

    saveDataCache(
      live
    )

    return {
      ...live,
      cached: false
    }

  } catch (error) {

    console.log(
      `Live Last.fm request failed: ${error}`
    )

    const cached =
      loadCurrentWeekCache()

    if (cached) {

      console.log(
        "Using current-week cached data."
      )

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
    new Point(
      0.15,
      0.85
    )

  gradient.endPoint =
    new Point(
      1.0,
      0.0
    )

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
      parent.addImage(
        logo
      )

    image.imageSize =
      new Size(
        68,
        17
      )

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
    .toLocaleString(
      "en-GB"
    )
}


// ============================================================
// COMPARISON
// ============================================================

function getComparison(
  current,
  previous
) {

  if (
    previous === 0 &&
    current === 0
  ) {

    return {
      text: "—",
      direction: 0
    }
  }

  if (previous === 0) {

    return {
      text: "NEW",
      direction: 1
    }
  }

  const percentage =
    Math.round(
      (
        (current - previous) /
        previous
      ) *
      100
    )

  if (percentage > 0) {

    return {
      text:
        `↑ ${percentage}%`,
      direction: 1
    }
  }

  if (percentage < 0) {

    return {
      text:
        `↓ ${Math.abs(
          percentage
        )}%`,
      direction: -1
    }
  }

  return {
    text: "→ 0%",
    direction: 0
  }
}


// ============================================================
// THREE-COLUMN GRID
//
// Headline statistics and comparison values use the same
// geometry:
//
// Left column:   left aligned
// Centre column: centred
// Right column:  right aligned
// ============================================================

function createGridColumn(
  parent,
  alignment
) {

  const column =
    parent.addStack()

  column.layoutVertically()

  column.size =
    new Size(
      94,
      0
    )

  if (alignment === "center") {
    column.centerAlignContent()
  }

  return column
}


// ============================================================
// HEADLINE COLUMN
// ============================================================

function addHeadlineContent(
  column,
  value,
  label,
  alignment
) {

  const valueRow =
    column.addStack()

  if (
    alignment === "center" ||
    alignment === "right"
  ) {
    valueRow.addSpacer()
  }

  const number =
    valueRow.addText(
      formatNumber(value)
    )

  number.font =
    Font.boldSystemFont(24)

  number.textColor =
    CONFIG.primaryText

  number.lineLimit = 1

  if (alignment === "center") {
    valueRow.addSpacer()
  }

  column.addSpacer(2)

  const labelRow =
    column.addStack()

  if (
    alignment === "center" ||
    alignment === "right"
  ) {
    labelRow.addSpacer()
  }

  const caption =
    labelRow.addText(
      label.toUpperCase()
    )

  caption.font =
    Font.semiboldSystemFont(8)

  caption.textColor =
    CONFIG.secondaryText

  caption.lineLimit = 1

  if (alignment === "center") {
    labelRow.addSpacer()
  }
}


// ============================================================
// COMPARISON COLUMN
// ============================================================

function addComparisonContent(
  column,
  current,
  previous,
  alignment
) {

  const comparison =
    getComparison(
      current,
      previous
    )

  const row =
    column.addStack()

  if (
    alignment === "center" ||
    alignment === "right"
  ) {
    row.addSpacer()
  }

  const text =
    row.addText(
      comparison.text
    )

  text.font =
    Font.semiboldSystemFont(8)

  text.textColor =
    comparison.direction > 0
      ? CONFIG.lastfmRed
      : CONFIG.secondaryText

  text.lineLimit = 1

  if (alignment === "center") {
    row.addSpacer()
  }
}


// ============================================================
// WEEK CHART
// ============================================================

function createWeekChart(
  daily,
  currentDayIndex
) {

  const width = 300
  const height = 116

  const context =
    new DrawContext()

  context.size =
    new Size(
      width,
      height
    )

  context.opaque = false

  context.respectScreenScale =
    true

  const completedValues =
    daily.slice(
      0,
      currentDayIndex + 1
    )

  const maxValue =
    Math.max(
      1,
      ...completedValues
    )

  const labels = [
    "M",
    "T",
    "W",
    "T",
    "F",
    "S",
    "S"
  ]

  const slotWidth =
    width / 7

  const barWidth = 25

  const chartTop = 20

  const chartBottom = 91

  const chartHeight =
    chartBottom -
    chartTop


  // ----------------------------------------------------------
  // BASELINE
  // ----------------------------------------------------------

  context.setStrokeColor(
    new Color(
      "#343438",
      0.55
    )
  )

  context.setLineWidth(1)

  const baseline =
    new Path()

  baseline.move(
    new Point(
      4,
      chartBottom
    )
  )

  baseline.addLine(
    new Point(
      width - 4,
      chartBottom
    )
  )

  context.addPath(
    baseline
  )

  context.strokePath()


  // ----------------------------------------------------------
  // DAYS
  // ----------------------------------------------------------

  for (
    let index = 0;
    index < 7;
    index++
  ) {

    const centreX =
      slotWidth *
      index +
      slotWidth / 2

    const value =
      daily[index]

    const isFuture =
      index >
      currentDayIndex

    if (!isFuture) {

      const barHeight =
        value > 0
          ? Math.max(
              3,
              chartHeight *
              value /
              maxValue
            )
          : 2

      const x =
        centreX -
        barWidth / 2

      const y =
        chartBottom -
        barHeight

      context.setFillColor(
        index ===
        currentDayIndex
          ? CONFIG.lastfmRed
          : new Color("#77777D")
      )

      const bar =
        new Path()

      bar.addRoundedRect(
        new Rect(
          x,
          y,
          barWidth,
          barHeight
        ),
        3,
        3
      )

      context.addPath(
        bar
      )

      context.fillPath()


      // ------------------------------------------------------
      // VALUE
      // ------------------------------------------------------

      context.setTextAlignedCenter()

      context.setFont(
        Font.semiboldSystemFont(9)
      )

      context.setTextColor(
        index ===
        currentDayIndex
          ? CONFIG.lastfmRed
          : CONFIG.primaryText
      )

      context.drawTextInRect(
        String(value),
        new Rect(
          centreX - 18,
          Math.max(
            0,
            y - 17
          ),
          36,
          14
        )
      )
    }


    // --------------------------------------------------------
    // DAY LABEL
    // --------------------------------------------------------

    context.setTextAlignedCenter()

    context.setFont(
      Font.semiboldSystemFont(8)
    )

    context.setTextColor(
      index ===
      currentDayIndex
        ? CONFIG.primaryText
        : (
            isFuture
              ? CONFIG.subtleText
              : CONFIG.secondaryText
          )
    )

    context.drawTextInRect(
      labels[index],
      new Rect(
        centreX - 15,
        98,
        30,
        14
      )
    )
  }

  return context.getImage()
}


// ============================================================
// RANKING ROW
// ============================================================

function addRankingRow(
  parent,
  index,
  name,
  count
) {

  const row =
    parent.addStack()

  row.centerAlignContent()

  const rank =
    row.addText(
      String(index + 1)
        .padStart(2, "0")
    )

  rank.font =
    Font.semiboldSystemFont(8)

  rank.textColor =
    CONFIG.tertiaryText

  row.addSpacer(8)

  const item =
    row.addText(
      name
    )

  item.font =
    Font.semiboldSystemFont(9)

  item.textColor =
    CONFIG.primaryText

  item.lineLimit = 1

  item.minimumScaleFactor = 0.65

  row.addSpacer()

  const plays =
    row.addText(
      String(count)
    )

  plays.font =
    Font.systemFont(8)

  plays.textColor =
    CONFIG.secondaryText

  plays.lineLimit = 1
}


// ============================================================
// RANKING COLUMN
// ============================================================

function addRankingColumn(
  parent,
  headingText,
  items
) {

  const column =
    parent.addStack()

  column.layoutVertically()

  const heading =
    column.addText(
      headingText
    )

  heading.font =
    Font.semiboldSystemFont(8)

  heading.textColor =
    CONFIG.secondaryText

  column.addSpacer(7)

  if (
    !items ||
    items.length === 0
  ) {

    const empty =
      column.addText(
        "No data yet"
      )

    empty.font =
      Font.systemFont(9)

    empty.textColor =
      CONFIG.secondaryText

    return column
  }

  for (
    let index = 0;
    index < items.length;
    index++
  ) {

    addRankingRow(
      column,
      index,
      items[index].name,
      items[index].count
    )

    if (
      index <
      items.length - 1
    ) {

      column.addSpacer(7)
    }
  }

  return column
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {

  const widget =
    new ListWidget()

  applyBackground(
    widget
  )

  widget.setPadding(
    17,
    18,
    16,
    18
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

  widget.addSpacer(14)


  // ==========================================================
  // HEADLINE STATISTICS
  // ==========================================================

  const stats =
    widget.addStack()


  const scrobblesColumn =
    createGridColumn(
      stats,
      "left"
    )

  addHeadlineContent(
    scrobblesColumn,
    data.current.scrobbles,
    "Scrobbles",
    "left"
  )


  stats.addSpacer()


  const artistsColumn =
    createGridColumn(
      stats,
      "center"
    )

  addHeadlineContent(
    artistsColumn,
    data.current.artists,
    "Artists",
    "center"
  )


  stats.addSpacer()


  const albumsColumn =
    createGridColumn(
      stats,
      "right"
    )

  addHeadlineContent(
    albumsColumn,
    data.current.albums,
    "Albums",
    "right"
  )


  // ==========================================================
  // SHARED COMPARISON LABEL
  // ==========================================================

  widget.addSpacer(9)

  const comparisonHeading =
    widget.addText(
      "VS SAME POINT LAST WEEK"
    )

  comparisonHeading.font =
    Font.semiboldSystemFont(7)

  comparisonHeading.textColor =
    CONFIG.tertiaryText

  widget.addSpacer(4)


  // ==========================================================
  // COMPARISON VALUES
  // ==========================================================

  const comparisons =
    widget.addStack()


  const scrobblesComparison =
    createGridColumn(
      comparisons,
      "left"
    )

  addComparisonContent(
    scrobblesComparison,
    data.current.scrobbles,
    data.previous.scrobbles,
    "left"
  )


  comparisons.addSpacer()


  const artistsComparison =
    createGridColumn(
      comparisons,
      "center"
    )

  addComparisonContent(
    artistsComparison,
    data.current.artists,
    data.previous.artists,
    "center"
  )


  comparisons.addSpacer()


  const albumsComparison =
    createGridColumn(
      comparisons,
      "right"
    )

  addComparisonContent(
    albumsComparison,
    data.current.albums,
    data.previous.albums,
    "right"
  )


  widget.addSpacer(11)


  // ==========================================================
  // DAILY ACTIVITY
  // ==========================================================

  const chartHeading =
    widget.addStack()

  const activityLabel =
    chartHeading.addText(
      "DAILY ACTIVITY"
    )

  activityLabel.font =
    Font.semiboldSystemFont(8)

  activityLabel.textColor =
    CONFIG.secondaryText

  chartHeading.addSpacer()

  const totalLabel =
    chartHeading.addText(
      `${data.current.scrobbles} scrobbles`
    )

  totalLabel.font =
    Font.systemFont(8)

  totalLabel.textColor =
    CONFIG.tertiaryText

  widget.addSpacer(4)

  const chart =
    widget.addImage(
      createWeekChart(
        data.current.daily,
        data.currentDayIndex
      )
    )

  chart.imageSize =
    new Size(
      300,
      116
    )

  chart.applyFittingContentMode()

  widget.addSpacer(11)


  // ==========================================================
  // TOP ARTISTS + TOP ALBUMS
  // ==========================================================

  const rankings =
    widget.addStack()

  const topArtists =
    addRankingColumn(
      rankings,
      "TOP ARTISTS",
      data.current.topArtists
    )

  topArtists.size =
    new Size(
      137,
      0
    )

  rankings.addSpacer(18)

  const topAlbums =
    addRankingColumn(
      rankings,
      "TOP ALBUMS",
      data.current.topAlbums
    )

  topAlbums.size =
    new Size(
      137,
      0
    )


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
//
// This should normally appear only if Last.fm is unavailable
// before the widget has obtained valid data for the current
// week.
// ============================================================

function createErrorWidget(error) {

  const widget =
    new ListWidget()

  applyBackground(
    widget
  )

  widget.setPadding(
    18,
    18,
    18,
    18
  )

  const title =
    widget.addText(
      "last.fm"
    )

  title.font =
    Font.boldSystemFont(13)

  title.textColor =
    CONFIG.lastfmRed

  widget.addSpacer(12)

  const heading =
    widget.addText(
      "Unable to load weekly listening"
    )

  heading.font =
    Font.boldSystemFont(16)

  heading.textColor =
    CONFIG.primaryText

  widget.addSpacer(6)

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
      {
        source:
          data.cached
            ? "cache"
            : "live",

        fetchedAt:
          data.fetchedAt,

        current:
          data.current,

        previous:
          data.previous
      },
      null,
      2
    )
  )

  widget =
    await createWidget(
      data
    )

} catch (error) {

  console.error(
    error
  )

  widget =
    createErrorWidget(
      error
    )
}


if (config.runsInWidget) {

  Script.setWidget(
    widget
  )

} else {

  await widget.presentLarge()
}


Script.complete()