// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: user-circle;
// ============================================================
// LAST.FM PROFILE WIDGET — v1.0
//
// Scriptable medium widget.
//
// Displays:
// - Last.fm branding
// - Profile image and username
// - Account start year
// - Total scrobbles
// - Total artists
// - Total loved tracks
//
// API data and images are cached locally so the widget can
// continue rendering if Last.fm is temporarily unavailable.
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  username: "YOUR_LASTFM_USERNAME",
  apiKey: "YOUR_LASTFM_API_KEY",

  apiBase: "https://ws.audioscrobbler.com/2.0/",
  get profileURL() {
    return `https://www.last.fm/user/${encodeURIComponent(this.username)}`
  },

  // Last.fm logo. Cached locally after the first download.
  logoURL:
    "https://www.last.fm/static/images/logo_static.adb61955725c.png",

  primaryText: Color.white(),
  secondaryText: new Color("#96969D"),
  lastfmRed: new Color("#D92323"),

  // Requested refresh interval. WidgetKit ultimately decides
  // when the Home Screen widget is refreshed.
  refreshMinutes: 30,

  cacheDirectory: "LastFMWidget",
  dataCacheFile: "profile-data.json",
  avatarCacheFile: "profile-avatar.jpg",
  logoCacheFile: "lastfm-logo.png"
}


// ============================================================
// LOCAL CACHE
// ============================================================

const fm = FileManager.local()

const cacheDir = fm.joinPath(
  fm.documentsDirectory(),
  CONFIG.cacheDirectory
)

if (!fm.fileExists(cacheDir)) {
  fm.createDirectory(cacheDir)
}

const dataCachePath = fm.joinPath(
  cacheDir,
  CONFIG.dataCacheFile
)

const avatarCachePath = fm.joinPath(
  cacheDir,
  CONFIG.avatarCacheFile
)

const logoCachePath = fm.joinPath(
  cacheDir,
  CONFIG.logoCacheFile
)


// ============================================================
// LAST.FM API
// ============================================================

async function lastfm(method, extra = {}) {
  const params = {
    method,
    api_key: CONFIG.apiKey,
    format: "json",
    ...extra
  }

  const query = Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&")

  const request = new Request(
    `${CONFIG.apiBase}?${query}`
  )

  request.headers = {
    "User-Agent":
      "LastfmWidgets-Scriptable-Profile/1.0"
  }

  request.timeoutInterval = 15

  const json = await request.loadJSON()

  if (json.error) {
    throw new Error(
      `Last.fm ${json.error}: ${json.message}`
    )
  }

  return json
}


// ============================================================
// PROFILE DATA
// ============================================================

async function loadLiveData() {
  // Only one artist and loved track are requested because their
  // pagination metadata contains the full collection totals.
  const [info, artists, loved] = await Promise.all([
    lastfm("user.getInfo", {
      user: CONFIG.username
    }),

    lastfm("library.getArtists", {
      user: CONFIG.username,
      limit: 1,
      page: 1
    }),

    lastfm("user.getLovedTracks", {
      user: CONFIG.username,
      limit: 1,
      page: 1
    })
  ])

  const user = info.user

  if (!user) {
    throw new Error(
      "No user information returned by Last.fm."
    )
  }

  const artistAttr =
    artists.artists?.["@attr"] || {}

  const lovedAttr =
    loved.lovedtracks?.["@attr"] || {}

  return {
    username:
      user.name || CONFIG.username,

    profileURL:
      user.url || CONFIG.profileURL,

    scrobbles:
      Number(user.playcount || 0),

    artists:
      Number(
        artistAttr.total ||
        artistAttr.totalResults ||
        0
      ),

    loved:
      Number(
        lovedAttr.total ||
        lovedAttr.totalResults ||
        0
      ),

    registered:
      Number(
        user.registered?.unixtime ||
        user.registered?.["#text"] ||
        0
      ),

    imageURL:
      getBestImage(user.image),

    updatedAt:
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
    const live = await loadLiveData()

    saveDataCache(live)

    console.log("Using live Last.fm data")

    return {
      ...live,
      cached: false
    }

  } catch (error) {
    console.log(
      `Live Last.fm request failed: ${error}`
    )

    const cached = loadDataCache()

    if (cached) {
      console.log("Using cached Last.fm data")

      return {
        ...cached,
        cached: true
      }
    }

    throw error
  }
}


// ============================================================
// PROFILE IMAGE
// ============================================================

function getBestImage(images) {
  if (!Array.isArray(images)) {
    return null
  }

  const preferred =
    images.find(
      image => image.size === "extralarge"
    ) ||
    images.find(
      image => image.size === "large"
    ) ||
    images.find(
      image => image.size === "medium"
    ) ||
    images[images.length - 1]

  const url = preferred?.["#text"]

  if (!url || !url.trim()) {
    return null
  }

  return url
}


async function getAvatar(url) {
  // Prefer the current profile image and update the local copy
  // whenever Last.fm successfully returns one.
  if (url) {
    try {
      const request = new Request(url)
      request.timeoutInterval = 10

      const image =
        await request.loadImage()

      try {
        fm.writeImage(
          avatarCachePath,
          image
        )
      } catch {}

      return image

    } catch (error) {
      console.log(
        `Avatar download failed: ${error}`
      )
    }
  }

  // Use the previous avatar if the image server is unavailable.
  if (fm.fileExists(avatarCachePath)) {
    try {
      return fm.readImage(
        avatarCachePath
      )
    } catch {}
  }

  return null
}


// ============================================================
// LAST.FM LOGO
// ============================================================

async function getLastFMLogo() {
  // The logo is static, so prefer the cached copy rather than
  // downloading the same asset on every widget refresh.
  if (fm.fileExists(logoCachePath)) {
    try {
      return fm.readImage(
        logoCachePath
      )
    } catch {}
  }

  try {
    const request =
      new Request(CONFIG.logoURL)

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
// FORMATTING
// ============================================================

function formatNumber(value) {
  return new Intl.NumberFormat(
    "en-GB"
  ).format(value)
}


function registrationText(timestamp) {
  if (!timestamp) {
    return "Last.fm listener"
  }

  const date =
    new Date(timestamp * 1000)

  return `Scrobbling since ${date.getFullYear()}`
}


// ============================================================
// APPEARANCE
// ============================================================

function applyBackground(widget) {
  const gradient =
    new LinearGradient()

  gradient.startPoint =
    new Point(0.15, 0.85)

  gradient.endPoint =
    new Point(1.0, 0.0)

  // Keep most of the widget near-black, with a restrained
  // Last.fm-red tint towards the upper-right corner.
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

  // Text fallback is only used if no cached or remote logo
  // is available.
  const fallback =
    parent.addText("last.fm")

  fallback.font =
    Font.boldSystemFont(13)

  fallback.textColor =
    CONFIG.lastfmRed
}


// ============================================================
// STAT COMPONENT
// ============================================================

function addStat(
  parent,
  value,
  label
) {
  const stat =
    parent.addStack()

  stat.layoutVertically()
  stat.centerAlignContent()

  const number =
    stat.addText(
      formatNumber(value)
    )

  number.font =
    Font.boldSystemFont(18)

  number.textColor =
    CONFIG.primaryText

  number.minimumScaleFactor = 0.6
  number.lineLimit = 1

  stat.addSpacer(3)

  const caption =
    stat.addText(
      label.toUpperCase()
    )

  caption.font =
    Font.semiboldSystemFont(8)

  caption.textColor =
    CONFIG.secondaryText

  caption.minimumScaleFactor = 0.55
  caption.lineLimit = 1
}


// ============================================================
// AVATAR PLACEHOLDER
// ============================================================

function addAvatarPlaceholder(
  parent,
  username
) {
  const placeholder =
    parent.addStack()

  placeholder.size =
    new Size(52, 52)

  placeholder.backgroundColor =
    new Color("#1B1B1E")

  placeholder.cornerRadius = 26
  placeholder.centerAlignContent()

  const initial =
    placeholder.addText(
      username
        .substring(0, 1)
        .toUpperCase()
    )

  initial.font =
    Font.boldSystemFont(21)

  initial.textColor =
    CONFIG.lastfmRed
}


// ============================================================
// WIDGET
// ============================================================

async function createWidget(data) {
  const widget =
    new ListWidget()

  applyBackground(widget)

  widget.setPadding(
    15,
    17,
    14,
    17
  )

  // Tapping anywhere on the widget opens the Last.fm profile.
  widget.url =
    data.profileURL


  // Branding
  const header =
    widget.addStack()

  header.centerAlignContent()

  await addLastFMBrand(header)

  header.addSpacer()

  widget.addSpacer(10)


  // Profile
  const profile =
    widget.addStack()

  profile.centerAlignContent()

  const avatarImage =
    await getAvatar(
      data.imageURL
    )

  if (avatarImage) {
    const avatar =
      profile.addImage(
        avatarImage
      )

    avatar.imageSize =
      new Size(52, 52)

    avatar.cornerRadius = 26

    avatar.applyFillingContentMode()

  } else {
    addAvatarPlaceholder(
      profile,
      data.username
    )
  }

  profile.addSpacer(12)


  // Identity
  const identity =
    profile.addStack()

  identity.layoutVertically()

  const username =
    identity.addText(
      data.username
    )

  username.font =
    Font.boldSystemFont(18)

  username.textColor =
    CONFIG.primaryText

  username.lineLimit = 1
  username.minimumScaleFactor = 0.7

  identity.addSpacer(3)

  const since =
    identity.addText(
      registrationText(
        data.registered
      )
    )

  since.font =
    Font.systemFont(10)

  since.textColor =
    CONFIG.secondaryText

  since.lineLimit = 1


  // Flexible spacing keeps the lifetime statistics anchored
  // towards the bottom of the medium widget.
  widget.addSpacer()


  // Lifetime statistics
  const stats =
    widget.addStack()

  stats.centerAlignContent()

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
    data.loved,
    "Loved Tracks"
  )


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
    widget.addText("last.fm")

  title.font =
    Font.boldSystemFont(13)

  title.textColor =
    CONFIG.lastfmRed

  widget.addSpacer(10)

  const heading =
    widget.addText(
      "Unable to update"
    )

  heading.font =
    Font.boldSystemFont(16)

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

  detail.minimumScaleFactor = 0.6

  return widget
}


// ============================================================
// RUN
// ============================================================

let widget

try {
  const data =
    await getData()

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