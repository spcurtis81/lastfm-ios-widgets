// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: headphones;
// ============================================================
// LAST.FM LISTENING WIDGET — v0.3
//
// Displays the current Last.fm track when Last.fm reports one
// as now playing. Otherwise displays the most recent scrobble.
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

  // Requested refresh interval. iOS ultimately determines
  // when the Home Screen widget is refreshed.
  refreshMinutes: 10,

  cacheDirectory:
    "LastFMListeningWidget",

  dataCacheFile:
    "listening-data.json",

  artworkCacheFile:
    "artwork.jpg",

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

const artworkCachePath =
  fm.joinPath(
    cacheDir,
    CONFIG.artworkCacheFile
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
      "LastfmWidgets-Scriptable-Listening/0.3"
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
// RECENT TRACK
// ============================================================

async function loadLiveData() {

  const json =
    await lastfm(
      "user.getRecentTracks",
      {
        user: CONFIG.username,
        limit: 2,
        extended: 1
      }
    )

  let tracks =
    json.recenttracks?.track

  if (!tracks) {
    throw new Error(
      "No recent tracks returned by Last.fm."
    )
  }

  if (!Array.isArray(tracks)) {
    tracks = [tracks]
  }

  const track =
    tracks[0]

  if (!track) {
    throw new Error(
      "No recent track available."
    )
  }

  const nowPlaying =
    track["@attr"]?.nowplaying === "true"

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

  const scrobbleTime =
    nowPlaying
      ? null
      : Number(
          track.date?.uts || 0
        )

  const loved =
    String(
      track.loved ?? "0"
    ) === "1"

  return {
    title:
      track.name ||
      "Unknown track",

    artist,

    album,

    loved,

    nowPlaying,

    scrobbleTime,

    artworkURL:
      getBestImage(
        track.image
      ),

    trackURL:
      track.url ||
      CONFIG.profileURL,

    fetchedAt:
      Date.now()
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

    const live =
      await loadLiveData()

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
// IMAGE HELPERS
// ============================================================

function getBestImage(images) {

  if (!Array.isArray(images)) {
    return null
  }

  const preferred =
    images.find(
      image =>
        image.size === "extralarge"
    ) ||
    images.find(
      image =>
        image.size === "large"
    ) ||
    images.find(
      image =>
        image.size === "medium"
    ) ||
    images[images.length - 1]

  const url =
    preferred?.["#text"]

  if (!url || !url.trim()) {
    return null
  }

  return url
}


// ============================================================
// ALBUM ARTWORK
// ============================================================

async function getArtwork(url) {

  if (url) {

    try {

      const request =
        new Request(url)

      request.timeoutInterval = 10

      const image =
        await request.loadImage()

      try {
        fm.writeImage(
          artworkCachePath,
          image
        )
      } catch {}

      return image

    } catch (error) {

      console.log(
        `Artwork download failed: ${error}`
      )
    }
  }

  // Fall back to the previously cached artwork if the current
  // image cannot be downloaded.
  if (fm.fileExists(artworkCachePath)) {

    try {
      return fm.readImage(
        artworkCachePath
      )
    } catch {}
  }

  return null
}


// ============================================================
// LAST.FM LOGO
// ============================================================

async function getLastFMLogo() {

  // The logo is static, so prefer the locally cached copy.
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

    // Matches the frozen Last.fm Profile widget.
    image.imageSize =
      new Size(68, 17)

    image.applyFittingContentMode()

    return
  }

  // Used only if neither the cached nor remote logo is
  // available.
  const fallback =
    parent.addText("last.fm")

  fallback.font =
    Font.boldSystemFont(13)

  fallback.textColor =
    CONFIG.lastfmRed
}


// ============================================================
// PLAYBACK STATUS
// ============================================================

function addStatus(
  parent,
  nowPlaying
) {

  const status =
    parent.addStack()

  status.centerAlignContent()

  if (nowPlaying) {

    const dot =
      status.addText("●")

    dot.font =
      Font.systemFont(7)

    dot.textColor =
      CONFIG.lastfmRed

    status.addSpacer(4)

    const text =
      status.addText(
        "NOW PLAYING"
      )

    text.font =
      Font.boldSystemFont(8)

    text.textColor =
      CONFIG.lastfmRed

  } else {

    const text =
      status.addText(
        "LAST PLAYED"
      )

    text.font =
      Font.semiboldSystemFont(8)

    text.textColor =
      CONFIG.secondaryText
  }
}


// ============================================================
// ARTWORK PLACEHOLDER
// ============================================================

function addArtworkPlaceholder(parent) {

  const placeholder =
    parent.addStack()

  placeholder.size =
    new Size(103, 103)

  placeholder.cornerRadius = 9

  placeholder.backgroundColor =
    new Color("#1B1B1E")

  placeholder.centerAlignContent()

  const symbol =
    SFSymbol.named(
      "music.note"
    )

  const image =
    placeholder.addImage(
      symbol.image
    )

  image.imageSize =
    new Size(24, 24)

  image.tintColor =
    CONFIG.secondaryText
}


// ============================================================
// LAST-PLAYED TIME
// ============================================================

function relativePlayedText(
  timestamp
) {

  if (!timestamp) {
    return ""
  }

  const elapsed =
    Math.max(
      0,
      Date.now() -
      timestamp * 1000
    )

  const minutes =
    Math.floor(
      elapsed / 60000
    )

  if (minutes < 1) {
    return "Played just now"
  }

  if (minutes < 60) {
    return (
      `Played ${minutes} min ago`
    )
  }

  const hours =
    Math.floor(
      minutes / 60
    )

  if (hours < 24) {

    if (hours === 1) {
      return "Played 1 hour ago"
    }

    return (
      `Played ${hours} hours ago`
    )
  }

  const days =
    Math.floor(
      hours / 24
    )

  if (days === 1) {
    return "Played 1 day ago"
  }

  return (
    `Played ${days} days ago`
  )
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {

  const widget =
    new ListWidget()

  applyBackground(widget)

  // Matches the horizontal positioning of the Profile widget.
  widget.setPadding(
    15,
    17,
    14,
    17
  )

  // Tapping the widget opens the displayed track on Last.fm.
  widget.url =
    data.trackURL


  // ==========================================================
  // COMMON HEADER
  // ==========================================================

  const header =
    widget.addStack()

  header.centerAlignContent()

  await addLastFMBrand(header)

  header.addSpacer()

  addStatus(
    header,
    data.nowPlaying
  )


  widget.addSpacer(9)


  // ==========================================================
  // MAIN CONTENT
  // ==========================================================

  const main =
    widget.addStack()

  main.centerAlignContent()


  // ----------------------------------------------------------
  // ALBUM ARTWORK
  // ----------------------------------------------------------

  const artwork =
    await getArtwork(
      data.artworkURL
    )

  if (artwork) {

    const image =
      main.addImage(
        artwork
      )

    image.imageSize =
      new Size(103, 103)

    image.cornerRadius = 9

    image.applyFillingContentMode()

  } else {

    addArtworkPlaceholder(main)
  }


  main.addSpacer(13)


  // ----------------------------------------------------------
  // TRACK INFORMATION
  // ----------------------------------------------------------

  const info =
    main.addStack()

  info.layoutVertically()


  // Track title and optional loved indicator.
  const titleRow =
    info.addStack()

  titleRow.centerAlignContent()


  const title =
    titleRow.addText(
      data.title
    )

  title.font =
    Font.boldSystemFont(18)

  title.textColor =
    CONFIG.primaryText

  title.lineLimit = 2

  title.minimumScaleFactor = 0.68


  if (data.loved) {

    titleRow.addSpacer(6)

    const heart =
      titleRow.addText("♥")

    heart.font =
      Font.boldSystemFont(11)

    heart.textColor =
      CONFIG.lastfmRed
  }


  info.addSpacer(4)


  // Artist
  const artist =
    info.addText(
      data.artist
    )

  artist.font =
    Font.semiboldSystemFont(11)

  artist.textColor =
    CONFIG.primaryText

  artist.lineLimit = 1

  artist.minimumScaleFactor = 0.7


  // Album
  if (data.album) {

    info.addSpacer(2)

    const album =
      info.addText(
        data.album
      )

    album.font =
      Font.systemFont(9)

    album.textColor =
      CONFIG.secondaryText

    album.lineLimit = 1

    album.minimumScaleFactor = 0.65
  }


  // ----------------------------------------------------------
  // LAST PLAYED
  //
  // Keep the playback time visually associated with the track
  // metadata rather than pushing it to the bottom of the widget.
  // ----------------------------------------------------------

  if (
    !data.nowPlaying &&
    data.scrobbleTime
  ) {

    info.addSpacer(9)

    const played =
      info.addText(
        relativePlayedText(
          data.scrobbleTime
        )
      )

    played.font =
      Font.systemFont(8)

    played.textColor =
      CONFIG.secondaryText

    played.lineLimit = 1
  }


  // Keep any unused vertical space below the track metadata.
  info.addSpacer()


  // WidgetKit treats this as the earliest requested refresh
  // time. iOS determines when the refresh actually occurs.
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
      "Unable to load listening activity"
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
    await createWidget(data)

} catch (error) {

  console.error(error)

  widget =
    createErrorWidget(error)
}


if (config.runsInWidget) {

  Script.setWidget(widget)

} else {

  await widget.presentMedium()
}


Script.complete()