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
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "SAKHA AI Live Backend",
    version: "2.0",
    status: "running",
    features: [
      "AI",
      "Weather",
      "Location",
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "SAKHA",
    status: "online",
    time: new Date().toISOString()
  });
});

// =====================================================
// AI
// =====================================================

app.post("/api/ai", async (req, res) => {
  try {
    const {
      message = "",
      question = "",
      category = "Daily Life AI",
      language = "or",
      context = []
    } = req.body || {};

    const userMessage = String(message || question).trim();

    if (!userMessage) {
      return res.status(400).json({
        ok: false,
        error: "Message is required"
      });
    }

    if (!AI_KEY) {
      return res.status(503).json({
        ok: false,
        error:
          "AI key is not configured. Add SUPABASE_PUBLISHABLE_KEY in Render Environment Variables."
      });
    }

    const payload = {
      message: userMessage,
      question: userMessage,
      category,
      language,
      context
    };

    const response = await fetch(AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: AI_KEY,
        Authorization: `Bearer ${AI_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        answer: text
      };
    }

    if (!response.ok) {
      return res.status(response.status).json({
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
    console.error("AI ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "SAKHA AI connection failed"
    });
  }
});

// =====================================================
// WEATHER
// Open-Meteo — no API key required
// =====================================================

app.get("/api/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        ok: false,
        error: "Valid latitude and longitude are required"
      });
    }

    const url = new URL(
      "https://api.open-meteo.com/v1/forecast"
    );

    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);

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
        "rain"
      ].join(",")
    );

    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "auto");

    const response = await fetch(url);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "Weather provider error"
      });
    }

    let maxRainProbability = 0;

    if (
      data.hourly &&
      Array.isArray(data.hourly.precipitation_probability)
    ) {
      maxRainProbability = Math.max(
        ...data.hourly.precipitation_probability
          .slice(0, 24)
          .filter((x) => Number.isFinite(x))
      );
    }

    res.json({
      ok: true,
      location: {
        latitude: lat,
        longitude: lon
      },
      current: data.current || {},
      hourly: data.hourly || {},
      rain_probability_next_24h: maxRainProbability,
      provider: "Open-Meteo"
    });
  } catch (error) {
    console.error("WEATHER ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Live weather unavailable"
    });
  }
});

// =====================================================
// WEATHER BY PLACE
// Example: /api/weather/place?city=Baripada
// =====================================================

app.get("/api/weather/place", async (req, res) => {
  try {
    const city = String(req.query.city || "").trim();

    if (!city) {
      return res.status(400).json({
        ok: false,
        error: "City is required"
      });
    }

    const geoURL = new URL(
      "https://geocoding-api.open-meteo.com/v1/search"
    );

    geoURL.searchParams.set("name", city);
    geoURL.searchParams.set("count", "1");
    geoURL.searchParams.set("language", "en");
    geoURL.searchParams.set("format", "json");

    const geoResponse = await fetch(geoURL);
    const geoData = await geoResponse.json();

    if (
      !geoData.results ||
      geoData.results.length === 0
    ) {
      return res.status(404).json({
        ok: false,
        error: `Location not found: ${city}`
      });
    }

    const place = geoData.results[0];

    const weatherURL = new URL(
      "https://api.open-meteo.com/v1/forecast"
    );

    weatherURL.searchParams.set(
      "latitude",
      place.latitude
    );

    weatherURL.searchParams.set(
      "longitude",
      place.longitude
    );

    weatherURL.searchParams.set(
      "current",
      [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "precipitation",
        "rain",
        "weather_code",
        "wind_speed_10m"
      ].join(",")
    );

    weatherURL.searchParams.set(
      "hourly",
      "precipitation_probability,rain"
    );

    weatherURL.searchParams.set("forecast_days", "2");
    weatherURL.searchParams.set("timezone", "auto");

    const weatherResponse =
      await fetch(weatherURL);

    const weatherData =
      await weatherResponse.json();

    let rainProbability = 0;

    if (
      weatherData.hourly &&
      Array.isArray(
        weatherData.hourly.precipitation_probability
      )
    ) {
      rainProbability = Math.max(
        ...weatherData.hourly.precipitation_probability
          .slice(0, 24)
          .filter((x) => Number.isFinite(x))
      );
    }

    res.json({
      ok: true,
      place: {
        name: place.name,
        country: place.country,
        latitude: place.latitude,
        longitude: place.longitude
      },
      current: weatherData.current || {},
      rain_probability_next_24h: rainProbability
    });
  } catch (error) {
    console.error("PLACE WEATHER ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Place weather unavailable"
    });
  }
});

// =====================================================
// SAKHA SECTION ROUTER
// =====================================================

app.post("/api/section", async (req, res) => {
  try {
    const {
      section = "Daily Life AI",
      message = "",
      language = "or"
    } = req.body || {};

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
        "Answer weather questions using live weather data when available. Never invent current weather.",

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
      `${systemInstruction}\n\nUser language: ${language}\n\nUser request:\n${message}`;

    const response = await fetch(
      `${req.protocol}://${req.get("host")}/api/ai`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: combinedMessage,
          category: section,
          language
        })
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("SECTION ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Section service failed"
    });
  }
});

// =====================================================
// VIDEO STUDIO — CAPTION GENERATOR
// =====================================================

app.post("/api/video/caption", async (req, res) => {
  try {
    const {
      topic = "",
      style = "engaging",
      language = "or"
    } = req.body || {};

    if (!topic.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Video topic is required"
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

    const response = await fetch(
      `${req.protocol}://${req.get("host")}/api/ai`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: prompt,
          category: "Video Studio",
          language
        })
      }
    );

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("VIDEO ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Video caption service failed"
    });
  }
});

// =====================================================
// SEARCH HELPER
// This creates a safe search URL; it does not pretend
// that external live results were fetched.
// =====================================================

app.get("/api/search-url", (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({
      ok: false,
      error: "Search query required"
    });
  }

  res.json({
    ok: true,
    query: q,
    google: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    bing: `https://www.bing.com/search?q=${encodeURIComponent(q)}`
  });
});

// =====================================================
// 404
// =====================================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "SAKHA API route not found",
    path: req.path
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    ok: false,
    error: "Internal SAKHA server error"
  });
});

// =====================================================
// START
// =====================================================

app.listen(PORT, () => {
  console.log(
    `🚀 SAKHA Live Backend running on port ${PORT}`
  );
});
