// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-gray; icon-glyph: magic;
// Last.fm Decade History Collector
// Development version v0.5
//
// SAFE / GENTLE COLLECTOR
// ------------------------------------------------------------
//
// One network request maximum per execution.
//
// Important change from v0.4:
//   - NO custom browser headers
//   - NO User-Agent
//   - NO Accept headers
//   - NO fabricated Safari request
//
// This deliberately uses Scriptable's plain Request behaviour,
// matching the earlier requests which successfully returned
// Last.fm annual listening reports.
//
// WORKFLOW
// ------------------------------------------------------------
//
// 1. Select one unresolved year.
// 2. If HTML for that year has already been saved:
//      -> make ZERO network requests
//      -> parse the saved copy locally.
// 3. Otherwise:
//      -> request that ONE annual report.
// 4. If HTTP 200:
//      -> save raw HTML immediately.
//      -> then attempt parsing.
// 5. If parsing fails:
//      -> keep HTML.
//      -> future development can re-parse it locally.
// 6. If HTTP 404:
//      -> mark that year unavailable.
// 7. Any other response:
//      -> preserve everything.
//      -> stop.
//      -> retry on a later execution.
//
// Existing successful decade-history-v1.json data is retained.


const CONFIG = {

  username: "YOUR_LASTFM_USERNAME",

  firstYear: 2006,

  // Last complete annual report.
  lastYear: 2025,


  // ----------------------------------------------------------
  // DEVELOPMENT TARGET ORDER
  // ----------------------------------------------------------
  //
  // We deliberately start with years we KNOW previously
  // returned HTTP 200.
  //
  // 2016 is first because it previously returned a valid
  // annual report but our parser didn't understand its format.
  //
  // 2025 is already cached successfully and will normally
  // therefore be skipped.

  preferredYears: [
    2016,
    2017,
    2018,
    2019,
    2020,
    2022,
    2023,
    2024,
    2025
  ],


  // ----------------------------------------------------------
  // STORAGE
  // ----------------------------------------------------------

  cacheDirectory:
    "LastFMDecadeHistory",

  cacheFile:
    "decade-history-v1.json",

  rawDirectory:
    "RawReports"
}


// ============================================================
// FILE SYSTEM
// ============================================================

const fm =
  FileManager.local()

const cacheDirectory =
  fm.joinPath(
    fm.documentsDirectory(),
    CONFIG.cacheDirectory
  )

if (
  !fm.fileExists(
    cacheDirectory
  )
) {

  fm.createDirectory(
    cacheDirectory,
    true
  )
}


const rawDirectory =
  fm.joinPath(
    cacheDirectory,
    CONFIG.rawDirectory
  )

if (
  !fm.fileExists(
    rawDirectory
  )
) {

  fm.createDirectory(
    rawDirectory,
    true
  )
}


const cachePath =
  fm.joinPath(
    cacheDirectory,
    CONFIG.cacheFile
  )


// ============================================================
// HELPERS
// ============================================================

function formatNumber(value) {

  return Number(
    value || 0
  ).toLocaleString()
}


function rawPath(year) {

  return fm.joinPath(
    rawDirectory,
    `${year}.html`
  )
}


function reportURL(year) {

  return (
    "https://www.last.fm/user/" +
    encodeURIComponent(
      CONFIG.username
    ) +
    "/listening-report/year/" +
    year
  )
}


function decodeHTML(value) {

  return String(
    value || ""
  )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      "\""
    )

    .replace(
      /&#39;/g,
      "'"
    )

    .replace(
      /&apos;/g,
      "'"
    )

    .replace(
      /&lt;/g,
      "<"
    )

    .replace(
      /&gt;/g,
      ">"
    )

    .replace(
      /&nbsp;/g,
      " "
    )

    .trim()
}


function stripTags(value) {

  return decodeHTML(

    String(
      value || ""
    )

      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )

      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )

      .replace(
        /<[^>]+>/g,
        " "
      )

      .replace(
        /\s+/g,
        " "
      )
  )
}


function escapeRegExp(value) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )
}


// ============================================================
// CACHE
// ============================================================

function createEmptyCache() {

  return {

    version: 1,

    username:
      CONFIG.username,

    years: {},

    createdAt:
      Date.now(),

    updatedAt:
      Date.now()
  }
}


function loadCache() {

  if (
    !fm.fileExists(
      cachePath
    )
  ) {

    return createEmptyCache()
  }


  try {

    const cache =
      JSON.parse(
        fm.readString(
          cachePath
        )
      )


    if (
      !cache ||
      cache.username !==
        CONFIG.username
    ) {

      console.log(
        "Existing cache belongs to another user."
      )

      return createEmptyCache()
    }


    if (
      typeof cache.years !==
        "object"
    ) {

      cache.years = {}
    }


    return cache

  } catch (error) {

    console.log(
      `Cache read error: ${error}`
    )

    return createEmptyCache()
  }
}


function saveCache(cache) {

  cache.updatedAt =
    Date.now()


  fm.writeString(
    cachePath,
    JSON.stringify(
      cache
    )
  )
}


// ============================================================
// RAW HTML STORAGE
// ============================================================

function hasRawReport(year) {

  return fm.fileExists(
    rawPath(year)
  )
}


function loadRawReport(year) {

  if (
    !hasRawReport(year)
  ) {

    return null
  }


  try {

    return fm.readString(
      rawPath(year)
    )

  } catch (_) {

    return null
  }
}


function saveRawReport(
  year,
  html
) {

  // Save first.
  //
  // Parsing happens only AFTER this succeeds.

  fm.writeString(
    rawPath(year),
    html
  )


  console.log(
    `✓ Raw ${year} HTML saved`
  )

  console.log(
    rawPath(year)
  )
}


// ============================================================
// PAGE TITLE
// ============================================================

function extractTitle(html) {

  const match =
    String(html).match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )


  return match
    ? stripTags(
        match[1]
      )
    : ""
}


// ============================================================
// DECADE DEFINITIONS
// ============================================================

const DECADES = [

  {
    label: "Pre-1960",
    key: "pre-1960"
  },

  {
    label: "1960s",
    key: "1960s"
  },

  {
    label: "1970s",
    key: "1970s"
  },

  {
    label: "1980s",
    key: "1980s"
  },

  {
    label: "1990s",
    key: "1990s"
  },

  {
    label: "2000s",
    key: "2000s"
  },

  {
    label: "2010s",
    key: "2010s"
  },

  {
    label: "2020s",
    key: "2020s"
  }
]


// ============================================================
// PARSER 1
//
// 2025 FORMAT:
//
// <table class="... js-music-decade-data">
// ...
// <td data-decade="1960s">1960s</td>
// <td>10</td>
// ...
// ============================================================

function parseKnownTableFormat(html) {

  const tableMatch =
    String(html).match(
      /<table[^>]*class=["'][^"']*js-music-decade-data[^"']*["'][^>]*>([\s\S]*?)<\/table>/i
    )


  if (!tableMatch) {

    return null
  }


  const tableHTML =
    tableMatch[1]


  const result = {}


  for (
    const decade
    of DECADES
  ) {

    const pattern =
      new RegExp(

        "<td[^>]*data-decade=[\"']" +
        escapeRegExp(
          decade.key
        ) +
        "[\"'][^>]*>" +

        "[\\s\\S]*?<\\/td>" +

        "\\s*" +

        "<td[^>]*>" +
        "\\s*([0-9,]+)\\s*" +
        "<\\/td>",

        "i"
      )


    const match =
      tableHTML.match(
        pattern
      )


    if (match) {

      result[
        decade.label
      ] =
        Number(
          match[1]
            .replace(
              /,/g,
              ""
            )
        )
    }
  }


  if (
    Object.keys(
      result
    ).length === 0
  ) {

    return null
  }


  return {

    parser:
      "js-music-decade-data",

    decades:
      result
  }
}


// ============================================================
// PARSER 2
//
// GENERIC DATA-DECADE FORMAT
//
// Older report layouts may retain data-decade attributes even
// if the surrounding table class differs.
// ============================================================

function parseGenericDataDecade(
  html
) {

  const source =
    String(html)


  const result = {}


  for (
    const decade
    of DECADES
  ) {

    // Find data-decade marker, then inspect a conservative
    // amount of HTML immediately following it.

    const marker =
      new RegExp(

        "data-decade=[\"']" +
        escapeRegExp(
          decade.key
        ) +
        "[\"']",

        "i"
      )


    const markerMatch =
      marker.exec(
        source
      )


    if (!markerMatch) {

      continue
    }


    const start =
      markerMatch.index


    const fragment =
      source.slice(
        start,
        start + 1500
      )


    // Prefer the first numeric TD following the decade cell.

    const numericCell =
      fragment.match(
        /<\/td>\s*<td[^>]*>\s*([0-9,]+)\s*<\/td>/i
      )


    if (
      numericCell
    ) {

      result[
        decade.label
      ] =
        Number(
          numericCell[1]
            .replace(
              /,/g,
              ""
            )
        )
    }
  }


  if (
    Object.keys(
      result
    ).length === 0
  ) {

    return null
  }


  return {

    parser:
      "generic-data-decade",

    decades:
      result
  }
}


// ============================================================
// PARSER 3
//
// LABEL-BASED FALLBACK
//
// Deliberately conservative.
//
// We only accept this parser if ALL eight decade labels can be
// associated with plausible nearby numbers.
//
// This prevents random dates/counts elsewhere on the report
// being mistaken for decade values.
// ============================================================

function parseLabelFallback(html) {

  const source =
    String(html)


  const result = {}


  for (
    const decade
    of DECADES
  ) {

    const labelPattern =
      new RegExp(
        escapeRegExp(
          decade.label
        ),
        "i"
      )


    const match =
      labelPattern.exec(
        source
      )


    if (!match) {

      return null
    }


    const fragment =
      source.slice(
        match.index,
        match.index + 800
      )


    // Look for the next table cell containing only a number.

    const numberMatch =
      fragment.match(
        /<td[^>]*>\s*([0-9][0-9,]*)\s*<\/td>/i
      )


    if (!numberMatch) {

      return null
    }


    result[
      decade.label
    ] =
      Number(
        numberMatch[1]
          .replace(
            /,/g,
            ""
          )
      )
  }


  return {

    parser:
      "label-fallback",

    decades:
      result
  }
}


// ============================================================
// MASTER PARSER
// ============================================================

function parseDecades(html) {

  const parsers = [

    parseKnownTableFormat,

    parseGenericDataDecade,

    parseLabelFallback
  ]


  for (
    const parser
    of parsers
  ) {

    try {

      const result =
        parser(html)


      if (
        result &&
        result.decades
      ) {

        return result
      }

    } catch (error) {

      console.log(
        `Parser error: ${error}`
      )
    }
  }


  return null
}


// ============================================================
// VALIDATION
// ============================================================

function validateDecades(
  decades
) {

  if (!decades) {

    return {
      valid: false,
      reason: "No decade data"
    }
  }


  const labels =
    DECADES.map(
      item => item.label
    )


  // For a full Last.fm decade report we expect all eight
  // categories.

  for (
    const label
    of labels
  ) {

    if (
      decades[label] ===
        undefined ||
      decades[label] ===
        null
    ) {

      return {
        valid: false,
        reason:
          `Missing ${label}`
      }
    }


    const value =
      Number(
        decades[label]
      )


    if (
      !Number.isFinite(
        value
      ) ||
      value < 0
    ) {

      return {
        valid: false,
        reason:
          `Invalid ${label}`
      }
    }
  }


  const total =
    labels.reduce(
      (
        sum,
        label
      ) =>
        sum +
        Number(
          decades[label]
        ),
      0
    )


  if (
    total <= 0
  ) {

    return {
      valid: false,
      reason:
        "Classified total is zero"
    }
  }


  return {

    valid: true,

    total
  }
}


// ============================================================
// CACHE SUCCESS
// ============================================================

function storeParsedYear(
  cache,
  year,
  parsed,
  source
) {

  const validation =
    validateDecades(
      parsed.decades
    )


  if (
    !validation.valid
  ) {

    throw new Error(
      validation.reason
    )
  }


  const existing =
    cache.years[
      String(year)
    ] || {}


  cache.years[
    String(year)
  ] = {

    ...existing,

    year,

    status:
      "available",

    httpStatus:
      200,

    parser:
      parsed.parser,

    decades:
      parsed.decades,

    classified:
      validation.total,

    source,

    rawSaved:
      hasRawReport(year),

    parsedAt:
      Date.now(),

    updatedAt:
      Date.now()
  }


  saveCache(
    cache
  )


  return validation.total
}


// ============================================================
// LOCAL PARSE
// ============================================================

function trySavedReport(
  cache,
  year
) {

  const html =
    loadRawReport(
      year
    )


  if (!html) {

    return {
      found: false
    }
  }


  console.log(
    ""
  )

  console.log(
    `Raw ${year} report already exists.`
  )

  console.log(
    "No network request will be made."
  )


  console.log(
    `HTML size: ` +
    `${formatNumber(
      html.length
    )} chars`
  )


  const parsed =
    parseDecades(
      html
    )


  if (!parsed) {

    console.log(
      "Saved HTML still cannot be parsed."
    )


    return {

      found: true,

      parsed: false,

      html
    }
  }


  const validation =
    validateDecades(
      parsed.decades
    )


  if (
    !validation.valid
  ) {

    console.log(
      `Parser produced invalid data: ` +
      validation.reason
    )


    return {

      found: true,

      parsed: false,

      html
    }
  }


  const total =
    storeParsedYear(
      cache,
      year,
      parsed,
      "saved-html"
    )


  console.log(
    `✓ Parsed locally using ` +
    `${parsed.parser}`
  )


  printDecades(
    parsed.decades
  )


  console.log(
    ""
  )

  console.log(
    `Classified: ` +
    formatNumber(total)
  )


  return {

    found: true,

    parsed: true,

    total,

    parser:
      parsed.parser
  }
}


// ============================================================
// TARGET SELECTION
// ============================================================

function isAvailable(
  cache,
  year
) {

  return (
    cache.years[
      String(year)
    ]?.status ===
      "available"
  )
}


function isUnavailable(
  cache,
  year
) {

  return (
    cache.years[
      String(year)
    ]?.status ===
      "unavailable"
  )
}


function chooseTarget(
  cache
) {

  // ----------------------------------------------------------
  // FIRST:
  // Any saved HTML which has not yet been successfully parsed.
  //
  // This costs zero network requests.
  // ----------------------------------------------------------

  for (
    const year
    of CONFIG.preferredYears
  ) {

    if (
      hasRawReport(year) &&
      !isAvailable(
        cache,
        year
      )
    ) {

      return {

        year,

        localOnly: true
      }
    }
  }


  // ----------------------------------------------------------
  // SECOND:
  // Preferred known-report years.
  // ----------------------------------------------------------

  for (
    const year
    of CONFIG.preferredYears
  ) {

    if (
      !isAvailable(
        cache,
        year
      ) &&
      !isUnavailable(
        cache,
        year
      )
    ) {

      return {

        year,

        localOnly: false
      }
    }
  }


  // ----------------------------------------------------------
  // THIRD:
  // Any remaining year.
  // ----------------------------------------------------------

  for (
    let year =
      CONFIG.firstYear;

    year <=
      CONFIG.lastYear;

    year++
  ) {

    if (
      !isAvailable(
        cache,
        year
      ) &&
      !isUnavailable(
        cache,
        year
      )
    ) {

      return {

        year,

        localOnly:
          hasRawReport(
            year
          )
      }
    }
  }


  return null
}


// ============================================================
// NETWORK
// ============================================================

async function fetchReport(
  year
) {

  const url =
    reportURL(year)


  console.log(
    ""
  )

  console.log(
    "NETWORK REQUEST"
  )

  console.log(
    url
  )


  // ----------------------------------------------------------
  // IMPORTANT
  //
  // Deliberately minimal Request.
  //
  // Do NOT add:
  //   User-Agent
  //   Accept
  //   Accept-Language
  //   Referer
  //   Cache-Control
  //
  // We want Scriptable's normal request behaviour.
  // ----------------------------------------------------------

  const request =
    new Request(url)


  request.timeoutInterval =
    30


  const html =
    await request.loadString()


  const response =
    request.response


  const status =
    Number(
      response?.statusCode || 0
    )


  return {

    url,

    status,

    html,

    title:
      extractTitle(html)
  }
}


// ============================================================
// OUTPUT
// ============================================================

function printDecades(
  decades
) {

  console.log(
    ""
  )


  for (
    const item
    of DECADES
  ) {

    const value =
      Number(
        decades[
          item.label
        ] || 0
      )


    console.log(
      item.label
        .padEnd(12) +
      formatNumber(value)
        .padStart(8)
    )
  }
}


function printCacheSummary(
  cache
) {

  const available = []
  const unavailable = []
  const unresolved = []
  const rawSaved = []


  for (
    let year =
      CONFIG.firstYear;

    year <=
      CONFIG.lastYear;

    year++
  ) {

    if (
      hasRawReport(year)
    ) {

      rawSaved.push(
        year
      )
    }


    const status =
      cache.years[
        String(year)
      ]?.status


    if (
      status ===
        "available"
    ) {

      available.push(
        year
      )

    } else if (
      status ===
        "unavailable"
    ) {

      unavailable.push(
        year
      )

    } else {

      unresolved.push(
        year
      )
    }
  }


  console.log(
    ""
  )

  console.log(
    "========================================"
  )

  console.log(
    "CACHE SUMMARY"
  )

  console.log(
    "========================================"
  )


  console.log(
    `Parsed reports: ` +
    (
      available.length
        ? available.join(", ")
        : "None"
    )
  )


  console.log(
    `Raw HTML saved: ` +
    (
      rawSaved.length
        ? rawSaved.join(", ")
        : "None"
    )
  )


  console.log(
    `Unavailable: ` +
    (
      unavailable.length
        ? unavailable.join(", ")
        : "None"
    )
  )


  console.log(
    `Unresolved: ` +
    (
      unresolved.length
        ? unresolved.join(", ")
        : "None"
    )
  )
}


// ============================================================
// ALERTS
// ============================================================

async function showLocalSuccess(
  year,
  result
) {

  const alert =
    new Alert()


  alert.title =
    `${year} Parsed Locally`


  alert.message =

    `${formatNumber(
      result.total
    )} scrobbles classified.\n\n` +

    `Parser: ${result.parser}\n\n` +

    "No Last.fm network request was made."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


async function showSavedButUnparsed(
  year
) {

  const alert =
    new Alert()


  alert.title =
    `${year} Saved Locally`


  alert.message =

    "The raw Last.fm report is safely cached, " +
    "but the current parser still cannot extract " +
    "its Music by Decade data.\n\n" +

    "No network request was made.\n\n" +

    "We can now improve the parser entirely offline."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


async function showNetworkSuccess(
  year,
  total,
  parser
) {

  const alert =
    new Alert()


  alert.title =
    `${year} Report Captured`


  alert.message =

    `HTTP 200\n\n` +

    `Raw HTML saved permanently.\n\n` +

    `${formatNumber(
      total
    )} scrobbles classified.\n\n` +

    `Parser: ${parser}\n\n` +

    "Exactly one Last.fm request was made."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


async function showCapturedUnparsed(
  year
) {

  const alert =
    new Alert()


  alert.title =
    `${year} Report Captured`


  alert.message =

    "HTTP 200\n\n" +

    "The complete report HTML has been saved locally, " +
    "but its decade format is different from the current parser.\n\n" +

    "Do NOT keep requesting this year. " +
    "We can now analyse the saved page locally."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


async function showUnavailable(
  year
) {

  const alert =
    new Alert()


  alert.title =
    `${year} Report Unavailable`


  alert.message =

    "Last.fm returned HTTP 404.\n\n" +

    "This year has been marked unavailable.\n\n" +

    "Exactly one request was made."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


async function showTransient(
  year,
  status,
  title
) {

  const alert =
    new Alert()


  alert.title =
    "Transient Last.fm Response"


  alert.message =

    `${year} returned HTTP ${status}.` +

    (
      title
        ? `\n${title}`
        : ""
    ) +

    "\n\nNothing has been discarded. " +

    "No further requests were made.\n\n" +

    "Leave it for a while before running again."


  alert.addAction(
    "OK"
  )


  await alert.present()
}


// ============================================================
// MAIN
// ============================================================

const cache =
  loadCache()


console.log(
  ""
)

console.log(
  "========================================"
)

console.log(
  "LAST.FM DECADE COLLECTOR v0.5"
)

console.log(
  "========================================"
)

console.log(
  `User: ${CONFIG.username}`
)

console.log(
  "Maximum network requests this run: 1"
)


printCacheSummary(
  cache
)


const target =
  chooseTarget(
    cache
  )


if (!target) {

  console.log(
    ""
  )

  console.log(
    "No unresolved years remain."
  )


  const alert =
    new Alert()


  alert.title =
    "Decade Collection Complete"


  alert.message =
    "There are no unresolved annual reports."


  alert.addAction(
    "OK"
  )


  await alert.present()


  Script.complete()

} else {

  console.log(
    ""
  )

  console.log(
    `Target year: ${target.year}`
  )


  // ==========================================================
  // LOCAL-FIRST
  // ==========================================================

  const local =
    trySavedReport(
      cache,
      target.year
    )


  if (
    local.found
  ) {

    printCacheSummary(
      cache
    )


    if (
      local.parsed
    ) {

      await showLocalSuccess(
        target.year,
        local
      )

    } else {

      await showSavedButUnparsed(
        target.year
      )
    }


    Script.complete()

  } else {

    // ========================================================
    // EXACTLY ONE NETWORK REQUEST
    // ========================================================

    try {

      const result =
        await fetchReport(
          target.year
        )


      console.log(
        ""
      )

      console.log(
        `HTTP ${result.status}`
      )

      console.log(
        `Title: ${result.title || "(none)"}`
      )

      console.log(
        `HTML size: ` +
        `${formatNumber(
          result.html?.length || 0
        )} chars`
      )


      // ======================================================
      // HTTP 200
      // ======================================================

      if (
        result.status === 200
      ) {

        // ----------------------------------------------------
        // SAVE BEFORE PARSING
        // ----------------------------------------------------

        saveRawReport(
          target.year,
          result.html
        )


        // Record capture immediately.

        const existing =
          cache.years[
            String(
              target.year
            )
          ] || {}


        cache.years[
          String(
            target.year
          )
        ] = {

          ...existing,

          year:
            target.year,

          httpStatus:
            200,

          rawSaved:
            true,

          capturedAt:
            Date.now(),

          status:
            existing.status ===
              "available"
              ? "available"
              : "captured"
        }


        saveCache(
          cache
        )


        console.log(
          ""
        )

        console.log(
          "Raw page safely persisted."
        )


        const parsed =
          parseDecades(
            result.html
          )


        if (parsed) {

          const validation =
            validateDecades(
              parsed.decades
            )


          if (
            validation.valid
          ) {

            const total =
              storeParsedYear(
                cache,
                target.year,
                parsed,
                "network-capture"
              )


            console.log(
              ""
            )

            console.log(
              `✓ Parser: ${parsed.parser}`
            )


            printDecades(
              parsed.decades
            )


            console.log(
              ""
            )

            console.log(
              `Classified: ` +
              formatNumber(total)
            )


            printCacheSummary(
              cache
            )


            await showNetworkSuccess(
              target.year,
              total,
              parsed.parser
            )

          } else {

            console.log(
              ""
            )

            console.log(
              "Parser output failed validation:"
            )

            console.log(
              validation.reason
            )


            printCacheSummary(
              cache
            )


            await showCapturedUnparsed(
              target.year
            )
          }

        } else {

          console.log(
            ""
          )

          console.log(
            "No current parser matched this report."
          )

          console.log(
            ""
          )

          console.log(
            "THIS IS SAFE:"
          )

          console.log(
            "The complete HTTP 200 response is now cached."
          )

          console.log(
            "Future parser work requires no further request " +
            `for ${target.year}.`
          )


          printCacheSummary(
            cache
          )


          await showCapturedUnparsed(
            target.year
          )
        }


      // ======================================================
      // HTTP 404
      // ======================================================

      } else if (
        result.status === 404
      ) {

        const existing =
          cache.years[
            String(
              target.year
            )
          ] || {}


        cache.years[
          String(
            target.year
          )
        ] = {

          ...existing,

          year:
            target.year,

          status:
            "unavailable",

          httpStatus:
            404,

          checkedAt:
            Date.now()
        }


        saveCache(
          cache
        )


        console.log(
          "Marked as genuinely unavailable."
        )


        printCacheSummary(
          cache
        )


        await showUnavailable(
          target.year
        )


      // ======================================================
      // EVERYTHING ELSE
      // ======================================================

      } else {

        console.log(
          ""
        )

        console.log(
          "Transient / rejected response."
        )

        console.log(
          "Cache has NOT been changed."
        )

        console.log(
          "No further request will be made."
        )


        await showTransient(
          target.year,
          result.status,
          result.title
        )
      }


    } catch (error) {

      console.log(
        ""
      )

      console.log(
        "NETWORK ERROR"
      )

      console.log(
        String(
          error?.message ||
          error
        )
      )


      const alert =
        new Alert()


      alert.title =
        "Last.fm Request Failed"


      alert.message =

        `${target.year} could not be retrieved.\n\n` +

        String(
          error?.message ||
          error
        ) +

        "\n\nNothing has been discarded. " +

        "No further requests were made."


      alert.addAction(
        "OK"
      )


      await alert.present()
    }


    Script.complete()
  }
}