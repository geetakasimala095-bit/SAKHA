const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "SAKHA Auto Post Backend",
    message: "SAKHA backend is running 🚀"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    service: "SAKHA"
  });
});

/*
  Instagram publishing endpoint

  IMPORTANT:
  Do NOT put your Meta access token in this file.
  Add it later in Render Environment Variables.
*/

app.post("/instagram/publish", async (req, res) => {
  try {
    const { video_url, caption } = req.body;

    if (!video_url) {
      return res.status(400).json({
        ok: false,
        error: "video_url is required"
      });
    }

    const accessToken = process.env.META_ACCESS_TOKEN;
    const instagramUserId = process.env.INSTAGRAM_USER_ID;

    if (!accessToken || !instagramUserId) {
      return res.status(500).json({
        ok: false,
        error: "Meta credentials are not configured on the server"
      });
    }

    const apiVersion = process.env.META_API_VERSION || "v23.0";

    // Create Instagram Reel container
    const createUrl =
      `https://graph.facebook.com/${apiVersion}/${instagramUserId}/media`;

    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        media_type: "REELS",
        video_url: video_url,
        caption: caption || "",
        access_token: accessToken
      })
    });

    const createData = await createResponse.json();

    if (!createResponse.ok || !createData.id) {
      return res.status(400).json({
        ok: false,
        step: "create_container",
        error: createData
      });
    }

    // Publish the container
    const publishUrl =
      `https://graph.facebook.com/${apiVersion}/${instagramUserId}/media_publish`;

    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        creation_id: createData.id,
        access_token: accessToken
      })
    });

    const publishData = await publishResponse.json();

    if (!publishResponse.ok) {
      return res.status(400).json({
        ok: false,
        step: "publish",
        error: publishData
      });
    }

    return res.json({
      ok: true,
      message: "Instagram publish request completed",
      result: publishData
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`SAKHA backend running on port ${PORT}`);
});
