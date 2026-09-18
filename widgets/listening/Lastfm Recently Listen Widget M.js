// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: rss;
// ============================================================
// LAST.FM RECENT LISTENING WIDGET — v0.4
//
// Medium Scriptable widget.
//
// Displays four recent unique listening items. Each column shows:
// - Album artwork
// - Track title
// - Artist
//
// Artwork is resolved through album.getInfo rather than relying
// only on the image returned with user.getRecentTracks.
// Candidates without usable album artwork are skipped.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase:
    "https://ws.audioscrobbler.com/2.0/",

  get recentURL() {
    return `https://www.last.fm/user/${encodeURIComponent(this.username)}/library`
  },

  logoURL:
    "https://www.last.fm/static/images/logo_static.adb61955725c.png",

  primaryText:
    Color.white(),

  secondaryText:
    new Color("#96969D"),

  lastfmRed:
    new Color("#D92323"),

  refreshMinutes: 30,

  recentTrackLimit: 40,

  itemCount: 4,

  artworkSize: 62,

  cacheDirectory:
    "LastFMRecentWidget",

  dataCacheFile:
    "recent-v04-data.json",

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

const artworkDir =
  fm.joinPath(
    cacheDir,
    "Artwork-v04"
  )

if (!fm.fileExists(artworkDir)) {
  fm.createDirectory(artworkDir)
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
      "LastfmWidgets-Scriptable-Recent/0.4"
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

  const scrobbleTime =
    nowPlaying
      ? null
      : Number(
          track.date?.uts || 0
        )

  return {
    title:
      track.name ||
      "Unknown track",

    artist,

    album,

    nowPlaying,

    scrobbleTime,

    trackURL:
      track.url ||
      CONFIG.recentURL
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
        image.size === "mega"
    ) ||
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

  return url.trim()
}


// ============================================================
// OBVIOUS PLACEHOLDER URL DETECTION
// ============================================================

function hasPlaceholderURL(url) {

  if (!url) {
    return true
  }

  const value =
    url.toLowerCase()

  const patterns = [
    "noimage",
    "no-image",
    "default_album",
    "default-album",
    "defaultalbum",
    "placeholder"
  ]

  return patterns.some(
    pattern =>
      value.includes(pattern)
  )
}


// ============================================================
// ALBUM ARTWORK LOOKUP
//
// The recent-tracks response is used to determine listening
// order. Artwork is then independently resolved through
// album.getInfo using the track's artist and album.
// ============================================================

async function getAlbumArtworkURL(
  artist,
  album
) {

  if (!artist || !album) {
    return null
  }

  try {

    const json =
      await lastfm(
        "album.getInfo",
        {
          artist,
          album,
          autocorrect: 1
        }
      )

    const url =
      getBestImage(
        json.album?.image
      )

    if (!url) {
      return null
    }

    if (
      hasPlaceholderURL(url)
    ) {
      return null
    }

    return url

  } catch (error) {

    // A missing album is not fatal to the widget. This candidate
    // is simply ignored and the next recent album is examined.
    console.log(
      `Album lookup failed for ${artist} — ${album}: ${error}`
    )

    return null
  }
}


// ============================================================
// IMAGE DOWNLOAD
// ============================================================

async function downloadImage(url) {

  if (!url) {
    return null
  }

  try {

    const request =
      new Request(url)

    request.timeoutInterval = 10

    return await request.loadImage()

  } catch (error) {

    console.log(
      `Artwork download failed: ${error}`
    )

    return null
  }
}


// ============================================================
// RECENT LISTENING DATA
// ============================================================

async function loadLiveData() {

  const json =
    await lastfm(
      "user.getRecentTracks",
      {
        user: CONFIG.username,
        limit: CONFIG.recentTrackLimit,
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

  const parsedTracks =
    tracks.map(parseTrack)

  const items = []

  const seenAlbums =
    new Set()


  // ----------------------------------------------------------
  // FIND FOUR UNIQUE ALBUMS WITH RESOLVABLE ARTWORK
  // ----------------------------------------------------------

  for (const track of parsedTracks) {

    // album.getInfo needs a real album name. Tracks without one
    // are skipped for this artwork-focused widget.
    if (
      !track.artist ||
      !track.album
    ) {
      continue
    }


    const key =
      `${track.artist}::${track.album}`
        .trim()
        .toLowerCase()


    if (seenAlbums.has(key)) {
      continue
    }


    // Mark this album as examined even if Last.fm has no usable
    // artwork, preventing repeated API calls for later tracks
    // from the same album.
    seenAlbums.add(key)


    const artworkURL =
      await getAlbumArtworkURL(
        track.artist,
        track.album
      )


    if (!artworkURL) {
      continue
    }


    // Verify that the returned image can actually be downloaded
    // before accepting this album into the four-item strip.
    const image =
      await downloadImage(
        artworkURL
      )


    if (!image) {
      continue
    }


    items.push({
      title:
        track.title,

      artist:
        track.artist,

      album:
        track.album,

      nowPlaying:
        track.nowPlaying,

      scrobbleTime:
        track.scrobbleTime,

      artworkURL,

      trackURL:
        track.trackURL
    })


    if (
      items.length >=
      CONFIG.itemCount
    ) {
      break
    }
  }


  if (items.length === 0) {
    throw new Error(
      "No recent albums with artwork could be loaded."
    )
  }


  return {
    items,
    fetchedAt: Date.now()
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
// ARTWORK CACHE
// ============================================================

function artworkCachePath(index) {

  return fm.joinPath(
    artworkDir,
    `recent-${index}.jpg`
  )
}


async function getArtwork(
  url,
  index
) {

  const path =
    artworkCachePath(index)


  if (url) {

    const image =
      await downloadImage(url)


    if (image) {

      try {

        fm.writeImage(
          path,
          image
        )

      } catch {}


      return image
    }
  }


  // Retain the previous image in this position if a temporary
  // network failure prevents the current image being retrieved.
  if (fm.fileExists(path)) {

    try {

      return fm.readImage(path)

    } catch {}
  }


  return null
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
    parent.addText("last.fm")

  fallback.font =
    Font.boldSystemFont(13)

  fallback.textColor =
    CONFIG.lastfmRed
}


// ============================================================
// ARTWORK PLACEHOLDER
// ============================================================

function addArtworkPlaceholder(
  parent,
  size
) {

  const placeholder =
    parent.addStack()

  placeholder.size =
    new Size(size, size)

  placeholder.cornerRadius = 7

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
    new Size(17, 17)

  image.tintColor =
    CONFIG.secondaryText
}


// ============================================================
// LISTENING ITEM
// ============================================================

async function addListeningItem(
  parent,
  item,
  index
) {

  const column =
    parent.addStack()

  column.layoutVertically()

  column.size =
    new Size(
      CONFIG.artworkSize,
      0
    )


  if (item) {

    column.url =
      item.trackURL


    const artwork =
      await getArtwork(
        item.artworkURL,
        index
      )


    if (artwork) {

      const image =
        column.addImage(
          artwork
        )

      image.imageSize =
        new Size(
          CONFIG.artworkSize,
          CONFIG.artworkSize
        )

      image.cornerRadius = 7

      image.applyFillingContentMode()

    } else {

      addArtworkPlaceholder(
        column,
        CONFIG.artworkSize
      )
    }


    column.addSpacer(6)


    // --------------------------------------------------------
    // TRACK TITLE
    // --------------------------------------------------------

    const title =
      column.addText(
        item.title
      )

    title.font =
      Font.semiboldSystemFont(9)

    title.textColor =
      CONFIG.primaryText

    title.lineLimit = 1

    title.minimumScaleFactor = 0.65


    column.addSpacer(2)


    // --------------------------------------------------------
    // ARTIST
    // --------------------------------------------------------

    const artist =
      column.addText(
        item.artist
      )

    artist.font =
      Font.systemFont(8)

    artist.textColor =
      CONFIG.secondaryText

    artist.lineLimit = 1

    artist.minimumScaleFactor = 0.6


  } else {

    addArtworkPlaceholder(
      column,
      CONFIG.artworkSize
    )
  }
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {

  const widget =
    new ListWidget()


  applyBackground(widget)


  // Matches the Profile and Listening widgets.
  widget.setPadding(
    15,
    17,
    14,
    17
  )


  widget.url =
    CONFIG.recentURL


  // ==========================================================
  // HEADER
  // ==========================================================

  const header =
    widget.addStack()

  header.centerAlignContent()


  await addLastFMBrand(header)


  header.addSpacer()


  const heading =
    header.addText(
      "RECENT LISTENING"
    )

  heading.font =
    Font.semiboldSystemFont(8)

  heading.textColor =
    CONFIG.secondaryText


  widget.addSpacer(10)


  // ==========================================================
  // FOUR RECENT ITEMS
  // ==========================================================

  const row =
    widget.addStack()


  for (
    let index = 0;
    index < CONFIG.itemCount;
    index++
  ) {

    await addListeningItem(
      row,
      data.items[index],
      index
    )


    if (
      index <
      CONFIG.itemCount - 1
    ) {

      row.addSpacer()
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
      "Unable to load recent listening"
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