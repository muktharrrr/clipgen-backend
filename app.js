const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 4000;

/* ============================
   MEMORY STORES
============================ */
const progressMap = {};
const resultMap = {};
const stepMap = {};

/* ============================
   MIDDLEWARE
============================ */
app.use(cors());
app.use(express.json());
app.use("/clips", express.static(path.join(__dirname, "public/clips")));

app.get("/", (req, res) => {
  res.send("Backend running ✅");
});

/* ============================
   PROGRESS ENDPOINT
============================ */
app.get("/progress/:jobId", (req, res) => {
  const { jobId } = req.params;

  res.json({
    progress: progressMap[jobId] ?? 0,
    step: stepMap[jobId] ?? "Preparing…",
    clips: resultMap[jobId] ?? null,
  });
});

/* ============================
   START PROCESSING
============================ */
app.post("/process-video", async (req, res) => {
  const { youtubeUrl } = req.body;

  if (!youtubeUrl || !youtubeUrl.startsWith("http")) {
    return res.status(400).json({
      success: false,
      error: "Invalid YouTube URL",
    });
  }

  const jobId = uuidv4();
  progressMap[jobId] = 0;
  stepMap[jobId] = "Starting…";

  res.json({ success: true, jobId });

  try {
    const videoPath = path.join(__dirname, `${jobId}.mp4`);
    const clipsDir = path.join(__dirname, "public/clips");

    if (!fs.existsSync(clipsDir)) {
      fs.mkdirSync(clipsDir, { recursive: true });
    }

    /* =======================
       1️⃣ Download (0–30%)
    ======================== */
    stepMap[jobId] = "Downloading video…";

    await ytdlp(youtubeUrl, {
      output: videoPath,
      format: "mp4",
      noCheckCertificates: true,
    });

    progressMap[jobId] = 30;

    /* =======================
       2️⃣ Generate Clips
    ======================== */
    stepMap[jobId] = "Generating clips…";

    const clipTimes = [
      { start: 10, duration: 20 },
      { start: 40, duration: 20 },
      { start: 70, duration: 20 },
    ];

    const clips = [];

    for (let i = 0; i < clipTimes.length; i++) {
      const clipId = uuidv4();
      const clipName = `clip-${clipId}.mp4`;
      const clipPath = path.join(clipsDir, clipName);

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(clipTimes[i].start)
          .setDuration(clipTimes[i].duration)
          .outputOptions("-movflags faststart")
          .output(clipPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      progressMap[jobId] =
        30 + Math.floor(((i + 1) / clipTimes.length) * 60);

      const baseUrl =
        process.env.RENDER_EXTERNAL_URL ||
        `http://localhost:${PORT}`;

      clips.push({
        id: clipId,
        title: `Highlight ${i + 1}`,
        duration: "00:20",
        previewUrl: `${baseUrl}/clips/${clipName}`,
        downloadUrl: `${baseUrl}/clips/${clipName}`,
      });
    }

    /* =======================
       3️⃣ Finish
    ======================== */
    stepMap[jobId] = "Finalizing…";
    progressMap[jobId] = 100;
    resultMap[jobId] = clips;

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    // auto cleanup after 5 minutes
    setTimeout(() => {
      delete progressMap[jobId];
      delete resultMap[jobId];
      delete stepMap[jobId];
    }, 300000);

  } catch (err) {
    console.error("Processing Error:", err);
    progressMap[jobId] = -1;
    stepMap[jobId] = "Processing failed";
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
