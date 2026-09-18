// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: user-circle;
// Last.fm All-Time Profile — Large
// v1.0
//
// Large companion to the Last.fm Profile widget.
// Shows lifetime profile statistics and the user's five
// most-scrobbled artists.
//
// Artist images are resolved from the artist's Last.fm web page
// because the Last.fm API no longer reliably supplies artist artwork.
//
// Successful data and images are cached locally for widget reliability.

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase: "https://ws.audioscrobbler.com/2.0/",
  lastfmBase: "https://www.last.fm",
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

  barBackground: new Color("#29292D"),
  barFill: new Color("#77777D"),

  refreshMinutes: 120,
  topArtistCount: 5,

  cacheDirectory: "LastFMAllTimeProfileWidget",
  dataCacheFile: "all-time-profile-data.json",
  avatarCacheFile: "profile-avatar.jpg",
  logoCacheFile: "lastfm-logo.png"
}


// ============================================================
// FILE SYSTEM
// ============================================================

const fm = FileManager.local()

const cacheDirectory = fm.joinPath(
  fm.documentsDirectory(),
  CONFIG.cacheDirectory
)

const artistImageDirectory = fm.joinPath(
  cacheDirectory,
  "artist-images"
)

if (!fm.fileExists(cacheDirectory)) {
  fm.createDirectory(cacheDirectory, true)
}

if (!fm.fileExists(artistImageDirectory)) {
  fm.createDirectory(artistImageDirectory, true)
}

const dataCachePath = fm.joinPath(
  cacheDirectory,
  CONFIG.dataCacheFile
)

const avatarCachePath = fm.joinPath(
  cacheDirectory,
  CONFIG.avatarCacheFile
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


function safeFilename(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}


function artistCachePath(name) {
  const filename =
    safeFilename(name) || "unknown-artist"

  return fm.joinPath(
    artistImageDirectory,
    `${filename}.jpg`
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
// NETWORK
// ============================================================

async function loadJSON(url) {
  const request = new Request(url)

  request.timeoutInterval = 20
  request.headers = {
    "User-Agent":
      "Scriptable Last.fm All-Time Profile Widget/1.0"
  }

  const response = await request.loadJSON()

  if (response?.error) {
    throw new Error(
      `Last.fm ${response.error}: ${response.message}`
    )
  }

  return response
}


async function loadHTML(url) {
  const request = new Request(url)

  request.timeoutInterval = 20
  request.headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
  }

  return await request.loadString()
}


async function loadRemoteImage(url) {
  const request = new Request(url)

  request.timeoutInterval = 20
  request.headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"
  }

  return await request.loadImage()
}


// ============================================================
// LAST.FM API
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


async function fetchProfileData() {
  const [
    userInfoResponse,
    artistCountResponse,
    lovedTracksResponse,
    topArtistsResponse
  ] = await Promise.all([
    loadJSON(
      apiURL(
        "user.getInfo",
        {
          user: CONFIG.username
        }
      )
    ),

    loadJSON(
      apiURL(
        "library.getArtists",
        {
          user: CONFIG.username,
          limit: 1,
          page: 1
        }
      )
    ),

    loadJSON(
      apiURL(
        "user.getLovedTracks",
        {
          user: CONFIG.username,
          limit: 1,
          page: 1
        }
      )
    ),

    loadJSON(
      apiURL(
        "user.getTopArtists",
        {
          user: CONFIG.username,
          period: "overall",
          limit: CONFIG.topArtistCount
        }
      )
    )
  ])

  const user = userInfoResponse.user

  const artistCount = Number(
    artistCountResponse
      ?.artists
      ?.["@attr"]
      ?.total || 0
  )

  const lovedCount = Number(
    lovedTracksResponse
      ?.lovedtracks
      ?.["@attr"]
      ?.total || 0
  )

  const topArtistsRaw =
    topArtistsResponse
      ?.topartists
      ?.artist || []

  const topArtists = topArtistsRaw
    .slice(0, CONFIG.topArtistCount)
    .map(artist => ({
      name:
        artist.name || "Unknown Artist",

      playcount:
        Number(artist.playcount || 0),

      url:
        artist.url ||
        `${CONFIG.lastfmBase}/music/${encode(artist.name)}`
    }))

  return {
    username:
      user?.name || CONFIG.username,

    realname:
      user?.realname || "",

    scrobbles:
      Number(user?.playcount || 0),

    artistCount,

    lovedCount,

    registered:
      Number(user?.registered?.unixtime || 0),

    avatarURL:
      getBestAPILastfmImage(user?.image),

    topArtists,

    fetchedAt:
      Date.now()
  }
}


function getBestAPILastfmImage(images) {
  if (!Array.isArray(images)) {
    return null
  }

  const preferredSizes = [
    "extralarge",
    "large",
    "medium",
    "small"
  ]

  for (const size of preferredSizes) {
    const match = images.find(
      item =>
        item?.size === size &&
        item?.["#text"]
    )

    if (match) {
      return match["#text"]
    }
  }

  const fallback = images.find(
    item => item?.["#text"]
  )

  return fallback?.["#text"] || null
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
      `Could not save data cache: ${error}`
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
      `Could not read data cache: ${error}`
    )

    return null
  }
}


async function getProfileData() {
  try {
    const data =
      await fetchProfileData()

    saveDataCache(data)

    return data
  } catch (error) {
    console.log(
      `Live Last.fm data failed: ${error}`
    )

    const cached =
      loadDataCache()

    if (cached) {
      console.log(
        "Using cached all-time profile data."
      )

      return cached
    }

    throw error
  }
}


// ============================================================
// IMAGE CACHE
// ============================================================

async function getCachedImage(
  url,
  path,
  preferCache = false
) {
  if (
    preferCache &&
    fm.fileExists(path)
  ) {
    try {
      return fm.readImage(path)
    } catch (_) {}
  }

  if (url) {
    try {
      const image =
        await loadRemoteImage(url)

      try {
        fm.writeImage(path, image)
      } catch (_) {}

      return image
    } catch (error) {
      console.log(
        `Image download failed: ${url}`
      )
    }
  }

  if (fm.fileExists(path)) {
    try {
      return fm.readImage(path)
    } catch (_) {}
  }

  return null
}


// ============================================================
// ARTIST IMAGE EXTRACTION
// ============================================================

async function resolveArtistImageURL(artist) {
  const artistURL =
    artist.url ||
    `${CONFIG.lastfmBase}/music/${encode(artist.name)}`

  try {
    const html =
      await loadHTML(artistURL)

    // Preferred source: the artist page's Open Graph image.
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
    )

    if (ogMatch?.[1]) {
      return decodeHTMLEntities(
        ogMatch[1]
      )
    }

    // Support pages where the meta attributes appear
    // in the opposite order.
    const reversedOgMatch = html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
    )

    if (reversedOgMatch?.[1]) {
      return decodeHTMLEntities(
        reversedOgMatch[1]
      )
    }

    // Fallback to the artist header artwork.
    const backgroundMatch = html.match(
      /header-new-background-image[^>]+background-image:\s*url\((https:\/\/lastfm-img\.freetls\.fastly\.net\/[^)]+)\)/i
    )

    if (backgroundMatch?.[1]) {
      return decodeHTMLEntities(
        backgroundMatch[1]
      )
    }

    // Final fallback to the first full-resolution Last.fm image.
    const ar0Match = html.match(
      /https:\/\/lastfm-img\.freetls\.fastly\.net\/i\/u\/ar0\/[^"' <>)]+/i
    )

    if (ar0Match?.[0]) {
      return decodeHTMLEntities(
        ar0Match[0]
      )
    }
  } catch (error) {
    console.log(
      `Could not resolve image for ${artist.name}: ${error}`
    )
  }

  return null
}


function decodeHTMLEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
}


async function getArtistImage(artist) {
  const path =
    artistCachePath(artist.name)

  // Artist artwork changes rarely, so prefer the local copy.
  if (fm.fileExists(path)) {
    try {
      return fm.readImage(path)
    } catch (_) {}
  }

  const imageURL =
    await resolveArtistImageURL(artist)

  if (!imageURL) {
    return null
  }

  try {
    const image =
      await loadRemoteImage(imageURL)

    try {
      fm.writeImage(path, image)
    } catch (_) {}

    return image
  } catch (error) {
    console.log(
      `Artist image download failed for ${artist.name}: ${error}`
    )

    return null
  }
}


// ============================================================
// MEMBERSHIP CALCULATIONS
// ============================================================

function membershipYears(registeredUnix) {
  if (!registeredUnix) {
    return 0
  }

  const registered =
    new Date(registeredUnix * 1000)

  const today =
    new Date()

  let years =
    today.getFullYear() -
    registered.getFullYear()

  const anniversary =
    new Date(
      today.getFullYear(),
      registered.getMonth(),
      registered.getDate()
    )

  if (today < anniversary) {
    years -= 1
  }

  return Math.max(0, years)
}


function averagePerDay(
  scrobbles,
  registeredUnix
) {
  if (!registeredUnix) {
    return 0
  }

  const start =
    registeredUnix * 1000

  const elapsed =
    Date.now() - start

  const days =
    elapsed / 86400000

  if (days <= 0) {
    return 0
  }

  return scrobbles / days
}


function scrobblingSince(
  registeredUnix
) {
  if (!registeredUnix) {
    return ""
  }

  return new Date(
    registeredUnix * 1000
  ).getFullYear()
}


// ============================================================
// DRAWING
// ============================================================

function createArtistBar(
  value,
  maximum,
  width = 54,
  height = 4
) {
  const context =
    new DrawContext()

  context.size =
    new Size(width, height)

  context.opaque = false
  context.respectScreenScale = true

  const backgroundPath =
    new Path()

  backgroundPath.addRoundedRect(
    new Rect(
      0,
      0,
      width,
      height
    ),
    2,
    2
  )

  context.addPath(backgroundPath)
  context.setFillColor(
    CONFIG.barBackground
  )
  context.fillPath()

  const ratio =
    maximum > 0
      ? Math.max(
          0,
          Math.min(
            1,
            value / maximum
          )
        )
      : 0

  if (ratio > 0) {
    const fillWidth =
      Math.max(
        height,
        width * ratio
      )

    const fillPath =
      new Path()

    fillPath.addRoundedRect(
      new Rect(
        0,
        0,
        fillWidth,
        height
      ),
      2,
      2
    )

    context.addPath(fillPath)
    context.setFillColor(
      CONFIG.barFill
    )
    context.fillPath()
  }

  return context.getImage()
}


function createRankedArtistImage(
  image,
  rank,
  size = 54
) {
  const context =
    new DrawContext()

  context.size =
    new Size(size, size)

  context.opaque = false
  context.respectScreenScale = true

  if (image) {
    context.drawImageInRect(
      image,
      new Rect(
        0,
        0,
        size,
        size
      )
    )
  } else {
    context.setFillColor(
      new Color("#242428")
    )

    context.fillRect(
      new Rect(
        0,
        0,
        size,
        size
      )
    )

    const symbol =
      SFSymbol.named("music.note")

    if (symbol) {
      const symbolSize = 20

      context.setTintColor(
        CONFIG.secondaryText
      )

      context.drawImageInRect(
        symbol.image,
        new Rect(
          (size - symbolSize) / 2,
          (size - symbolSize) / 2,
          symbolSize,
          symbolSize
        )
      )
    }
  }

  const badgeWidth = 22
  const badgeHeight = 16

  const badgePath =
    new Path()

  badgePath.addRoundedRect(
    new Rect(
      4,
      4,
      badgeWidth,
      badgeHeight
    ),
    5,
    5
  )

  context.addPath(badgePath)
  context.setFillColor(
    new Color("#111113", 0.78)
  )
  context.fillPath()

  context.setTextColor(
    Color.white()
  )

  context.setFont(
    Font.semiboldSystemFont(7)
  )

  context.setTextAlignedCenter()

  context.drawTextInRect(
    String(rank).padStart(2, "0"),
    new Rect(
      4,
      7,
      badgeWidth,
      10
    )
  )

  return context.getImage()
}


// ============================================================
// FALLBACK ART
// ============================================================

function createAvatarFallback(
  size = 52
) {
  const context =
    new DrawContext()

  context.size =
    new Size(size, size)

  context.opaque = false
  context.respectScreenScale = true

  context.setFillColor(
    new Color("#242428")
  )

  context.fillEllipse(
    new Rect(
      0,
      0,
      size,
      size
    )
  )

  const symbol =
    SFSymbol.named("person.fill")

  if (symbol) {
    context.setTintColor(
      CONFIG.secondaryText
    )

    const symbolSize = 23

    context.drawImageInRect(
      symbol.image,
      new Rect(
        (size - symbolSize) / 2,
        (size - symbolSize) / 2,
        symbolSize,
        symbolSize
      )
    )
  }

  return context.getImage()
}


// ============================================================
// STAT COLUMN
// ============================================================

function addStatColumn(
  parent,
  value,
  label,
  alignment
) {
  const column =
    parent.addStack()

  column.layoutVertically()
  column.size =
    new Size(92, 0)

  if (alignment === "center") {
    column.centerAlignContent()
  }

  const valueText =
    addText(
      column,
      formatNumber(value),
      Font.boldSystemFont(22),
      CONFIG.primaryText,
      alignment,
      1,
      0.75
    )

  if (alignment === "center") {
    valueText.centerAlignText()
  } else if (alignment === "right") {
    valueText.rightAlignText()
  }

  column.addSpacer(2)

  const labelText =
    addText(
      column,
      label,
      Font.semiboldSystemFont(8),
      CONFIG.secondaryText,
      alignment,
      1,
      0.8
    )

  if (alignment === "center") {
    labelText.centerAlignText()
  } else if (alignment === "right") {
    labelText.rightAlignText()
  }

  return column
}


// ============================================================
// ARTIST COLUMN
// ============================================================

async function addArtistColumn(
  parent,
  artist,
  index,
  maximum
) {
  const COLUMN_WIDTH = 54
  const IMAGE_SIZE = 54
  const NAME_HEIGHT = 27
  const BAR_WIDTH = 54

  const column =
    parent.addStack()

  column.layoutVertically()
  column.size =
    new Size(COLUMN_WIDTH, 0)

  column.centerAlignContent()

  if (artist.url) {
    column.url = artist.url
  }


  // ----------------------------------------------------------
  // ARTIST IMAGE + RANK
  // ----------------------------------------------------------

  const artistImage =
    await getArtistImage(artist)

  const rankedImage =
    createRankedArtistImage(
      artistImage,
      index + 1,
      IMAGE_SIZE
    )

  const imageView =
    column.addImage(rankedImage)

  imageView.imageSize =
    new Size(
      IMAGE_SIZE,
      IMAGE_SIZE
    )

  imageView.cornerRadius = 8
  imageView.applyFillingContentMode()


  // Slightly more separation between artwork and artist name.
  column.addSpacer(9)


  // ----------------------------------------------------------
  // ARTIST NAME
  //
  // The fixed-height outer region gives every artist the same
  // vertical allocation. The horizontal wrapper forces the
  // text element itself to sit centrally beneath the artwork.
  // ----------------------------------------------------------

  const nameRegion =
    column.addStack()

  nameRegion.layoutVertically()
  nameRegion.size =
    new Size(
      COLUMN_WIDTH,
      NAME_HEIGHT
    )

  const nameRow =
    nameRegion.addStack()

  nameRow.layoutHorizontally()
  nameRow.size =
    new Size(
      COLUMN_WIDTH,
      0
    )

  nameRow.addSpacer()

  const nameText =
    nameRow.addText(
      artist.name
    )

  nameText.font =
    Font.semiboldSystemFont(8.5)

  nameText.textColor =
    CONFIG.primaryText

  nameText.lineLimit = 2
  nameText.minimumScaleFactor = 0.72
  nameText.centerAlignText()

  nameRow.addSpacer()

  // Keep the name anchored at the top of its fixed two-line
  // region so all counts below share the same baseline.
  nameRegion.addSpacer()


  // Slightly more separation before the numeric data.
  column.addSpacer(7)


  // ----------------------------------------------------------
  // SCROBBLE COUNT
  // ----------------------------------------------------------

  const countRow =
    column.addStack()

  countRow.layoutHorizontally()
  countRow.size =
    new Size(
      COLUMN_WIDTH,
      0
    )

  countRow.addSpacer()

  const count =
    countRow.addText(
      formatNumber(
        artist.playcount
      )
    )

  count.font =
    Font.systemFont(8)

  count.textColor =
    CONFIG.secondaryText

  count.lineLimit = 1
  count.minimumScaleFactor = 0.75
  count.centerAlignText()

  countRow.addSpacer()


  column.addSpacer(6)


  // ----------------------------------------------------------
  // SCROBBLE BAR
  // ----------------------------------------------------------

  const bar =
    column.addImage(
      createArtistBar(
        artist.playcount,
        maximum,
        BAR_WIDTH,
        4
      )
    )

  bar.imageSize =
    new Size(
      BAR_WIDTH,
      4
    )

  return column
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {
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
    await getCachedImage(
      CONFIG.logoURL,
      logoCachePath,
      true
    )

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
    "ALL TIME",
    Font.semiboldSystemFont(8),
    CONFIG.secondaryText,
    "right"
  )


  widget.addSpacer(12)


  // ==========================================================
  // PROFILE
  // ==========================================================

  const profileRow =
    widget.addStack()

  profileRow.layoutHorizontally()
  profileRow.centerAlignContent()

  let avatar =
    await getCachedImage(
      data.avatarURL,
      avatarCachePath,
      false
    )

  if (!avatar) {
    avatar =
      createAvatarFallback(52)
  }

  const avatarView =
    profileRow.addImage(avatar)

  avatarView.imageSize =
    new Size(52, 52)

  avatarView.cornerRadius = 26
  avatarView.applyFillingContentMode()

  profileRow.addSpacer(12)

  const profileText =
    profileRow.addStack()

  profileText.layoutVertically()

  addText(
    profileText,
    data.username,
    Font.boldSystemFont(18),
    CONFIG.primaryText,
    "left",
    1,
    0.8
  )

  profileText.addSpacer(3)

  const sinceYear =
    scrobblingSince(
      data.registered
    )

  addText(
    profileText,
    sinceYear
      ? `Scrobbling since ${sinceYear}`
      : "Last.fm listener",
    Font.systemFont(10),
    CONFIG.secondaryText
  )


  widget.addSpacer(17)


  // ==========================================================
  // LIFETIME STATS
  // ==========================================================

  const statsRow =
    widget.addStack()

  statsRow.layoutHorizontally()
  statsRow.centerAlignContent()

  addStatColumn(
    statsRow,
    data.scrobbles,
    "SCROBBLES",
    "left"
  )

  statsRow.addSpacer()

  addStatColumn(
    statsRow,
    data.artistCount,
    "ARTISTS",
    "center"
  )

  statsRow.addSpacer()

  addStatColumn(
    statsRow,
    data.lovedCount,
    "LOVED TRACKS",
    "right"
  )


  widget.addSpacer(12)


  // ==========================================================
  // MEMBERSHIP CONTEXT
  // ==========================================================

  const years =
    membershipYears(
      data.registered
    )

  const dailyAverage =
    averagePerDay(
      data.scrobbles,
      data.registered
    )

  const contextRow =
    widget.addStack()

  contextRow.layoutHorizontally()
  contextRow.centerAlignContent()

  addText(
    contextRow,
    `MEMBER FOR ${years} YEARS`,
    Font.semiboldSystemFont(7),
    CONFIG.tertiaryText
  )

  contextRow.addSpacer(8)

  addText(
    contextRow,
    "•",
    Font.systemFont(7),
    CONFIG.subtleText
  )

  contextRow.addSpacer(8)

  addText(
    contextRow,
    `${dailyAverage.toFixed(1)} SCROBBLES / DAY`,
    Font.semiboldSystemFont(7),
    CONFIG.tertiaryText
  )


  widget.addSpacer(18)


  // ==========================================================
  // ARTIST SECTION
  // ==========================================================

  const artistHeader =
    widget.addStack()

  artistHeader.layoutHorizontally()
  artistHeader.centerAlignContent()

  addText(
    artistHeader,
    "ALL-TIME TOP ARTISTS",
    Font.semiboldSystemFont(8),
    CONFIG.secondaryText
  )

  artistHeader.addSpacer()

  addText(
    artistHeader,
    "SCROBBLES",
    Font.semiboldSystemFont(7),
    CONFIG.tertiaryText,
    "right"
  )


  // Slightly more air between the section title and artwork.
  widget.addSpacer(12)


  const artists =
    data.topArtists
      .slice(
        0,
        CONFIG.topArtistCount
      )

  const maximum =
    Math.max(
      1,
      ...artists.map(
        artist =>
          Number(
            artist.playcount || 0
          )
      )
    )

  const artistGrid =
    widget.addStack()

  artistGrid.layoutHorizontally()
  artistGrid.centerAlignContent()

  for (
    let index = 0;
    index < artists.length;
    index++
  ) {
    await addArtistColumn(
      artistGrid,
      artists[index],
      index,
      maximum
    )

    if (
      index <
      artists.length - 1
    ) {
      artistGrid.addSpacer()
    }
  }


  widget.addSpacer()


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
    "Unable to load profile",
    Font.boldSystemFont(16),
    CONFIG.primaryText
  )

  widget.addSpacer(5)

  addText(
    widget,
    String(
      error?.message || error
    ),
    Font.systemFont(9),
    CONFIG.secondaryText,
    "left",
    4,
    0.8
  )

  return widget
}


// ============================================================
// MAIN
// ============================================================

let widget

try {
  const data =
    await getProfileData()

  widget =
    await createWidget(data)
} catch (error) {
  console.log(error)

  widget =
    createErrorWidget(error)
}


if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentLarge()
}

Script.complete()