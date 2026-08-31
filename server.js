import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;

// =====================================================
// SAKHA CONFIG
// =====================================================

const AI_URL =
  process.env.SAKHA_AI_URL ||
  "https://hsexaatuacdnumxnkehx.supabase.co/functions/v1/smart-endpoint";

const AI_KEY =
  process.env.SAKHA_AI_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "";

// =====================================================
// WEATHER CACHE
// =====================================================

const WEATHER_CACHE = new Map();
const WEATHER_CACHE_MS = 60 * 1000;

// =====================================================
// WEATHER CONDITION
// =====================================================

function weatherCondition(code) {
  const n = Number(code);

  if (n === 0) return "ଆକାଶ ସଫା";
  if ([1, 2, 3].includes(n)) return "ଆଂଶିକ ମେଘୁଆ";
  if ([45, 48].includes(n)) return "କୁହୁଡ଼ି";
  if ([51, 53, 55, 56, 57].includes(n))
    return "ହାଲୁକା ଝିପିଝିପି ବର୍ଷା";
  if ([61, 63, 65, 66, 67].includes(n))
    return "ବର୍ଷା";
  if ([71, 73, 75, 77].includes(n))
    return "ତୁଷାରପାତ";
  if ([80, 81, 82].includes(n))
    return "ବର୍ଷାର ସମ୍ଭାବନା";
  if ([95, 96, 99].includes(n))
    return "ବଜ୍ରପାତ ସହିତ ବର୍ଷା";

  return "ପାଗ ପରିବର୍ତ୍ତନଶୀଳ";
}

// =====================================================
// WEATHER CACHE FUNCTIONS
// =====================================================

function getWeatherCache(key) {
  const item = WEATHER_CACHE.get(key);

  if (!item) return null;

  if (Date.now() - item.time > WEATHER_CACHE_MS) {
    WEATHER_CACHE.delete(key);
    return null;
  }

  return item.data;
}

function setWeatherCache(key, data) {
  WEATHER_CACHE.set(key, {
    time: Date.now(),
    data
  });

  return data;
}

// =====================================================
// LIVE WEATHER
// =====================================================

async function fetchLiveWeather(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new Error("Invalid coordinates");
  }

  const cacheKey =
    `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

  const cached = getWeatherCache(cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL(
    "https://api.open-meteo.com/v1/forecast"
  );

  url.searchParams.set(
    "latitude",
    latitude
  );

  url.searchParams.set(
    "longitude",
    longitude
  );

  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "rain",
      "weather_code",
      "wind_speed_10m"
    ].join(",")
  );

  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "rain",
      "weather_code"
    ].join(",")
  );

  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "rain_sum"
    ].join(",")
  );

  url.searchParams.set(
    "forecast_days",
    "3"
  );

  url.searchParams.set(
    "timezone",
    "auto"
  );

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Weather provider HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.current || !data.daily) {
    throw new Error(
      "Incomplete weather data"
    );
  }

  return setWeatherCache(
    cacheKey,
    data
  );
}

// =====================================================
// PLACE SEARCH
// =====================================================

async function geocodePlace(placeName) {
  const query =
    String(placeName || "").trim();

  if (!query) {
    throw new Error(
      "Place name is required"
    );
  }

  const url = new URL(
    "https://geocoding-api.open-meteo.com/v1/search"
  );

  url.searchParams.set(
    "name",
    query
  );

  url.searchParams.set(
    "count",
    "10"
  );

  url.searchParams.set(
    "language",
    "en"
  );

  url.searchParams.set(
    "format",
    "json"
  );

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Geocoding HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    !Array.isArray(data.results) ||
    data.results.length === 0
  ) {
    throw new Error(
      `Location not found: ${query}`
    );
  }

  const wanted =
    query.toLowerCase();

  function score(place) {
    let score = 0;

    const name =
      String(place.name || "")
        .toLowerCase();

    const country =
      String(place.country || "")
        .toLowerCase();

    const countryCode =
      String(place.country_code || "")
        .toLowerCase();

    const admin1 =
      String(place.admin1 || "")
        .toLowerCase();

    const admin2 =
      String(place.admin2 || "")
        .toLowerCase();

    if (name === wanted)
      score += 100;

    if (countryCode === "in")
      score += 80;

    if (country === "india")
      score += 30;

    if (
      admin1.includes("odisha") ||
      admin1.includes("orissa")
    ) {
      score += 60;
    }

    if (
      admin2.includes("mayurbhanj")
    ) {
      score += 30;
    }

    return score;
  }

  return [...data.results].sort(
    (a, b) => score(b) - score(a)
  )[0];
}

// =====================================================
// WEATHER QUESTION DETECTION
// =====================================================

function isWeatherRequest(message) {
  const text =
    String(message || "")
      .toLowerCase();

  const words = [
    "weather",
    "wather",
    "weater",
    "forecast",
    "rain",
    "rainfall",
    "temperature",
    "temp",
    "paga",
    "pag",
    "barsa",
    "barsha",
    "brusti",
    "today weather",
    "tomorrow weather",
    "ବର୍ଷା",
    "ପାଗ",
    "ଖରା",
    "ତାପମାତ୍ରା"
  ];

  return words.some(
    word => text.includes(word)
  );
}

// =====================================================
// TOMORROW DETECTION
// =====================================================

function wantsTomorrow(message) {
  const text =
    String(message || "")
      .toLowerCase();

  return (
    text.includes("tomorrow") ||
    text.includes("kali") ||
    text.includes("କାଲି")
  );
}

// =====================================================
// WEATHER PLACE EXTRACTION
// =====================================================

function extractWeatherPlace(message) {
  const text =
    String(message || "").trim();

  const knownPlaces = [
    "Karanjia",
    "Baripada",
    "Mayurbhanj",
    "Rairangpur",
    "Udala",
    "Jashipur",
    "Bangriposi",
    "Keonjhar",
    "Balasore",
    "Baleswar",
    "Bhadrak",
    "Cuttack",
    "Bhubaneswar",
    "Rourkela",
    "Sambalpur",
    "Puri",
    "Berhampur",
    "Barbil",
    "Joda",
    "Anandapur",
    "Basta",
    "Nilagiri",
    "Soro",
    "Jaleswar",
    "Remuna",
    "Betnoti",
    "Khunta",
    "Bisoi",
    "Kaptipada",
    "Kusumi",
    "Thakurmunda"
  ];

  const lower =
    text.toLowerCase();

  for (const place of knownPlaces) {
    if (
      lower.includes(
        place.toLowerCase()
      )
    ) {
      return place;
    }
  }

  const patterns = [
    /\b(?:in|at|near)\s+([A-Za-z][A-Za-z .'-]{1,60})/i,

    /\b([A-Za-z][A-Za-z .'-]{1,60})\s+(?:re|ra|weather|wather|paga|pag)\b/i
  ];

  for (const pattern of patterns) {
    const match =
      text.match(pattern);

    if (!match || !match[1])
      continue;

    const candidate =
      match[1]
        .replace(
          /\b(today|tomorrow|weather|wather|weater|paga|pag|rain|temperature)\b/gi,
          ""
        )
        .trim();

    if (candidate.length >= 2) {
      return candidate;
    }
  }

  return null;
}

// =====================================================
// NATURAL WEATHER ANSWER
// =====================================================

function naturalWeatherAnswer(
  placeName,
  data,
  tomorrow = false
) {
  const daily =
    data.daily || {};

  const current =
    data.current || {};

  const index =
    tomorrow ? 1 : 0;

  const when =
    tomorrow ? "କାଲି" : "ଆଜି";

  const rainChance =
    Number(
      daily
        .precipitation_probability_max?.[
        index
      ] ?? 0
    );

  const rainAmount =
    Number(
      daily.rain_sum?.[index] ??
      daily.precipitation_sum?.[index] ??
      0
    );

  const minTemp =
    Number(
      daily.temperature_2m_min?.[index]
    );

  const maxTemp =
    Number(
      daily.temperature_2m_max?.[index]
    );

  const currentTemp =
    Number(
      current.temperature_2m
    );

  const code =
    Number(
      daily.weather_code?.[index] ??
      current.weather_code
    );

  let answer = "";

  if (
    rainChance >= 70 ||
    rainAmount >= 3
  ) {
    answer =
      `🌧️ ${placeName}ରେ ${when} ବର୍ଷା ହେବାର ସମ୍ଭାବନା ଅଧିକ ଅଛି।`;
  } else if (
    rainChance >= 40 ||
    rainAmount > 0
  ) {
    answer =
      `🌦️ ${placeName}ରେ ${when} ବର୍ଷା ହୋଇପାରେ।`;
  } else {
    answer =
      `☀️ ${placeName}ରେ ${when} ବର୍ଷା ହେବାର ସମ୍ଭାବନା କମ୍।`;
  }

  answer +=
    ` ପାଗ ${weatherCondition(code)} ରହିପାରେ।`;

  if (
    Number.isFinite(minTemp) &&
    Number.isFinite(maxTemp)
  ) {
    answer +=
      ` ତାପମାତ୍ରା ପ୍ରାୟ ${minTemp} ରୁ ${maxTemp} ଡିଗ୍ରୀ ସେଲସିୟସ ମଧ୍ୟରେ ରହିପାରେ।`;
  } else if (
    Number.isFinite(currentTemp)
  ) {
    answer +=
      ` ବର୍ତ୍ତମାନ ତାପମାତ୍ରା ପ୍ରାୟ ${currentTemp} ଡିଗ୍ରୀ ସେଲସିୟସ।`;
  }

  if (rainChance >= 60) {
    answer +=
      " ବାହାରକୁ ଯିବାକୁ ଥିଲେ ଛତା ନେଇଯିବା ଭଲ।";
  }

  return answer;
}

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service:
      "SAKHA AI Live Backend",
    version:
      "3.0-live-weather",
    status: "running",
    features: [
      "AI",
      "Live Weather",
      "Location Weather",
      "GPS Weather",
      "Jobs",
      "Market",
      "Movies",
      "Video Studio",
      "Reminder",
      "Health Check"
    ]
  });
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "SAKHA",
      status: "online",
      time:
        new Date().toISOString()
    });
  }
);

// =====================================================
// AI
// =====================================================

app.post(
  "/api/ai",
  async (req, res) => {
    try {
      const {
        message = "",
        question = "",
        category = "Daily Life AI",
        language = "or",
        context = [],
        latitude,
        longitude
      } = req.body || {};

      const userMessage =
        String(
          message || question
        ).trim();

      if (!userMessage) {
        return res.status(400).json({
          ok: false,
          error:
            "Message is required"
        });
      }

      // =================================================
      // WEATHER-FIRST
      // =================================================
      //
      // Weather question never goes directly to AI.
      // First fetch actual live data.
      //

      if (
        isWeatherRequest(
          userMessage
        )
      ) {
        try {
          let weatherData;
          let placeName;

          const lat =
            Number(latitude);

          const lon =
            Number(longitude);

          // GPS weather
          if (
            Number.isFinite(lat) &&
            Number.isFinite(lon)
          ) {
            weatherData =
              await fetchLiveWeather(
                lat,
                lon
              );

            placeName =
              "ଆପଣଙ୍କ ନିକଟସ୍ଥ ସ୍ଥାନ";
          }

          // Place weather
          else {
            const requestedPlace =
              extractWeatherPlace(
                userMessage
              );

            if (!requestedPlace) {
              return res.json({
                ok: true,
                live: false,
                needs_location: true,
                answer:
                  "ଆପଣ କେଉଁ ଗାଁ କିମ୍ବା ସହରର weather ଜାଣିବାକୁ ଚାହୁଁଛନ୍ତି? ନାମଟି କହନ୍ତୁ।"
              });
            }

            const place =
              await geocodePlace(
                requestedPlace
              );

            weatherData =
              await fetchLiveWeather(
                place.latitude,
                place.longitude
              );

            placeName =
              place.name;
          }

          return res.json({
            ok: true,
            live: true,

            answer:
              naturalWeatherAnswer(
                placeName,
                weatherData,
                wantsTomorrow(
                  userMessage
                )
              ),

            weather: {
              place: placeName,
              current:
                weatherData.current ||
                {},
              daily:
                weatherData.daily ||
                {}
            },

            provider:
              "Open-Meteo"
          });

        } catch (weatherError) {
          console.error(
            "LIVE WEATHER ERROR:",
            weatherError
          );

          return res.status(502).json({
            ok: false,
            live: false,
            error:
              "Live weather data is temporarily unavailable.",
            details:
              weatherError.message
          });
        }
      }

      // =================================================
      // NORMAL AI
      // =================================================

      if (!AI_KEY) {
        return res.status(503).json({
          ok: false,
          error:
            "AI key is not configured. Add SUPABASE_PUBLISHABLE_KEY in Render Environment Variables."
        });
      }

      const understandingInstruction =
        language === "or"
          ? `
Understand Odia, Romanized Odia,
English and mixed Odia-English.

The user may make spelling mistakes
or phonetic spellings such as:

wather
paga
barsa
kemti
kana
kan
kemiti

Silently understand the intended meaning.

Do not complain about spelling.

Answer naturally in Odia when the
user communicates in Odia.
`
          : `
Understand spelling mistakes,
phonetic typing and mixed language.

Silently understand the intended
meaning and answer naturally.
`;

      const payload = {
        message:
          `${understandingInstruction}

User message:
${userMessage}`,

        question:
          userMessage,

        category,

        language,

        context
      };

      const response =
        await fetch(
          AI_URL,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              apikey:
                AI_KEY,

              Authorization:
                `Bearer ${AI_KEY}`
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const text =
        await response.text();

      let data;

      try {
        data =
          JSON.parse(text);
      } catch {
        data = {
          answer: text
        };
      }

      if (!response.ok) {
        return res
          .status(response.status)
          .json({
            ok: false,
            error:
              data?.error ||
              data?.message ||
              "SAKHA AI service returned an error"
          });
      }

      return res.json({
        ok: true,

        answer:
          data?.answer ||
          data?.response ||
          data?.message ||
          data?.text ||
          data?.output ||
          text,

        raw: data
      });

    } catch (error) {
      console.error(
        "AI ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "SAKHA AI connection failed"
      });
    }
  }
);

// =====================================================
// WEATHER BY GPS
// =====================================================

app.get(
  "/api/weather",
  async (req, res) => {
    try {
      const lat =
        Number(req.query.lat);

      const lon =
        Number(req.query.lon);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        return res.status(400).json({
          ok: false,
          error:
            "Valid latitude and longitude are required"
        });
      }

      const data =
        await fetchLiveWeather(
          lat,
          lon
        );

      return res.json({
        ok: true,
        live: true,

        location: {
          latitude: lat,
          longitude: lon
        },

        current:
          data.current || {},

        hourly:
          data.hourly || {},

        daily:
          data.daily || {},

        provider:
          "Open-Meteo"
      });

    } catch (error) {
      console.error(
        "WEATHER ERROR:",
        error
      );

      return res.status(502).json({
        ok: false,
        live: false,
        error:
          "Live weather unavailable",
        details:
          error.message
      });
    }
  }
);

// =====================================================
// WEATHER BY PLACE
// =====================================================

app.get(
  "/api/weather/place",
  async (req, res) => {
    try {
      const city =
        String(
          req.query.city || ""
        ).trim();

      if (!city) {
        return res.status(400).json({
          ok: false,
          error:
            "City or village name is required"
        });
      }

      const place =
        await geocodePlace(
          city
        );

      const data =
        await fetchLiveWeather(
          place.latitude,
          place.longitude
        );

      return res.json({
        ok: true,
        live: true,

        place: {
          name:
            place.name,

          country:
            place.country,

          country_code:
            place.country_code,

          admin1:
            place.admin1 || "",

          admin2:
            place.admin2 || "",

          latitude:
            place.latitude,

          longitude:
            place.longitude
        },

        current:
          data.current || {},

        hourly:
          data.hourly || {},

        daily:
          data.daily || {},

        answer:
          naturalWeatherAnswer(
            place.name,
            data,
            false
          ),

        provider:
          "Open-Meteo"
      });

    } catch (error) {
      console.error(
        "PLACE WEATHER ERROR:",
        error
      );

      return res.status(502).json({
        ok: false,
        live: false,
        error:
          "Live place weather unavailable",
        details:
          error.message
      });
    }
  }
);

// =====================================================
// WEATHER ASK
// =====================================================

app.post(
  "/api/weather/ask",
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message ||
          req.body?.question ||
          ""
        ).trim();

      const lat =
        Number(
          req.body?.latitude
        );

      const lon =
        Number(
          req.body?.longitude
        );

      let weatherData;
      let placeName;

      // GPS
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        weatherData =
          await fetchLiveWeather(
            lat,
            lon
          );

        placeName =
          "ଆପଣଙ୍କ ନିକଟସ୍ଥ ସ୍ଥାନ";
      }

      // Place name
      else {
        const requestedPlace =
          extractWeatherPlace(
            message
          );

        if (!requestedPlace) {
          return res.json({
            ok: true,
            live: false,
            needs_location: true,
            answer:
              "ଆପଣ କେଉଁ ଗାଁ କିମ୍ବା ସହରର weather ଜାଣିବାକୁ ଚାହୁଁଛନ୍ତି? ନାମଟି କହନ୍ତୁ।"
          });
        }

        const place =
          await geocodePlace(
            requestedPlace
          );

        weatherData =
          await fetchLiveWeather(
            place.latitude,
            place.longitude
          );

        placeName =
          place.name;
      }

      return res.json({
        ok: true,
        live: true,

        place:
          placeName,

        answer:
          naturalWeatherAnswer(
            placeName,
            weatherData,
            wantsTomorrow(
              message
            )
          ),

        current:
          weatherData.current ||
          {},

        daily:
          weatherData.daily ||
          {},

        provider:
          "Open-Meteo"
      });

    } catch (error) {
      console.error(
        "WEATHER ASK ERROR:",
        error
      );

      return res.status(502).json({
        ok: false,
        live: false,
        error:
          "Live weather data could not be fetched",
        details:
          error.message
      });
    }
  }
);

// =====================================================
// SAKHA SECTION ROUTER
// =====================================================

app.post(
  "/api/section",
  async (req, res) => {
    try {
      const {
        section =
          "Daily Life AI",

        message = "",

        language = "or",

        context = [],

        latitude,

        longitude
      } = req.body || {};

      // -------------------------------------------------
      // WEATHER SECTION DIRECTLY USES LIVE WEATHER
      // -------------------------------------------------

      if (
        section === "Weather" ||
        isWeatherRequest(message)
      ) {
        const response =
          await fetch(
            `${req.protocol}://${req.get("host")}/api/ai`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  message,
                  category:
                    "Weather",
                  language,
                  context,
                  latitude,
                  longitude
                })
            }
          );

        const data =
          await response.json();

        return res
          .status(response.status)
          .json(data);
      }

      const prompts = {

        "Student AI":
          "Act as a helpful study assistant. Explain topics simply, create practice questions, quizzes and short revision notes.",

        "Farmer AI":
          "Act as a general farming assistant. Ask about crop, soil, location and season before giving useful and safe farming guidance.",

        "Animal Care":
          "Give general animal care information. For serious symptoms advise contacting a qualified veterinarian.",

        "Animal Rescue":
          "Give safe animal rescue guidance. Avoid dangerous handling and recommend local animal rescue or veterinary services when needed.",

        "Baby Care":
          "Give general baby hygiene, feeding and safety information. For urgent symptoms recommend a pediatric professional.",

        "Kitchen & Recipes":
          "Create simple recipes from available ingredients and include basic food-safety reminders.",

        "Buy & Sell":
          "Help create safe buy-and-sell listings, descriptions, pricing questions and scam-awareness tips.",

        "Lost & Found":
          "Help create privacy-safe lost and found notices without exposing sensitive personal information.",

        "Jobs & Career":
          "Help with job search, career planning, CV preparation, interview preparation and skill development.",

        "Maps & Places":
          "Help users formulate location searches and identify useful nearby categories. Use live map services when connected.",

        "Weather":
          "Answer weather questions using live weather data. Never invent current weather.",

        "Smart Market":
          "Help compare products, features and buying considerations. Do not invent current prices.",

        "Vehicle Help":
          "Provide basic vehicle troubleshooting and safety guidance. Recommend a qualified mechanic for dangerous or uncertain issues.",

        "Mobile Help":
          "Provide step-by-step troubleshooting for phone, battery, network, Wi-Fi and basic settings.",

        "Smart Home":
          "Help configure and troubleshoot supported smart-home devices.",

        "Video Studio":
          "Create social-media captions, descriptions and hashtags for user-provided videos. Do not claim a video was posted unless publishing succeeds.",

        "Smart Reminder":
          "Help turn natural-language requests into clear reminder titles, dates and times.",

        "Emergency Help":
          "Give calm, general emergency guidance and encourage contacting local emergency services immediately when appropriate.",

        "Camera AI":
          "Help interpret information the user provides about an image. Do not invent visual details.",

        "Movie & Ticket":
          "Help find current movie/show information using official sources when available. Never invent showtimes or ticket availability.",

        "Daily Life AI":
          "Help with everyday planning, organization, explanations and practical tasks."
      };

      const systemInstruction =
        prompts[section] ||
        prompts["Daily Life AI"];

      const combinedMessage =
        `${systemInstruction}

User language:
${language}

User request:
${message}`;

      const response =
        await fetch(
          `${req.protocol}://${req.get("host")}/api/ai`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                message:
                  combinedMessage,

                category:
                  section,

                language,

                context,

                latitude,

                longitude
              })
          }
        );

      const data =
        await response.json();

      return res
        .status(response.status)
        .json(data);

    } catch (error) {
      console.error(
        "SECTION ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Section service failed"
      });
    }
  }
);

// =====================================================
// VIDEO STUDIO
// =====================================================

app.post(
  "/api/video/caption",
  async (req, res) => {
    try {
      const {
        topic = "",
        style = "engaging",
        language = "or"
      } = req.body || {};

      if (!topic.trim()) {
        return res.status(400).json({
          ok: false,
          error:
            "Video topic is required"
        });
      }

      const prompt = `
Create social media content for this video.

Topic:
${topic}

Style:
${style}

Language:
${language}

Return:

1. Short caption
2. 10 relevant hashtags
3. Short description

Do not claim that the video has been posted.
`;

      const response =
        await fetch(
          `${req.protocol}://${req.get("host")}/api/ai`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                message:
                  prompt,

                category:
                  "Video Studio",

                language
              })
          }
        );

      const data =
        await response.json();

      return res
        .status(response.status)
        .json(data);

    } catch (error) {
      console.error(
        "VIDEO ERROR:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Video caption service failed"
      });
    }
  }
);

// =====================================================
// SEARCH URL
// =====================================================

app.get(
  "/api/search-url",
  (req, res) => {
    const q =
      String(
        req.query.q || ""
      ).trim();

    if (!q) {
      return res.status(400).json({
        ok: false,
        error:
          "Search query required"
      });
    }

    res.json({
      ok: true,

      query: q,

      google:
        `https://www.google.com/search?q=${encodeURIComponent(q)}`,

      bing:
        `https://www.bing.com/search?q=${encodeURIComponent(q)}`
    });
  }
);

// =====================================================
// 404
// =====================================================

app.use(
  (req, res) => {
    res.status(404).json({
      ok: false,
      error:
        "SAKHA API route not found",
      path:
        req.path
    });
  }
);

// =====================================================
// ERROR HANDLER
// =====================================================

app.use(
  (err, req, res, next) => {
    console.error(
      "SERVER ERROR:",
      err
    );

    res.status(500).json({
      ok: false,
      error:
        "Internal SAKHA server error"
    });
  }
);

// =====================================================
// START
// =====================================================

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 SAKHA Live Backend v3 running on port ${PORT}`
    );
  }
);
