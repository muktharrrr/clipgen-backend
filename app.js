const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ytdlp = require("yt-dlp-exec");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

ffmpeg.setFfmpegPath(ffmpegPath);

/* ================================
   GLOBAL STORES (in-memory)
================================ */
const progressMap = {}; // jobId -> progress %
const resultMap = {};   // jobId -> clips[]
const stepMap = {};     // jobId -> current step text

const app = express();
const PORT = process.env.PORT || 4000;


app.use(cors());
app.use(express.json());

// Serve generated clips
app.use("/clips", express.static(path.join(__dirname, "public", "clips")));

// Health check
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

/* ================================
   PROGRESS API (polling)
================================ */
app.get("/progress/:jobId", (req, res) => {
  const { jobId } = req.params;

  res.json({
    progress: progressMap[jobId] ?? 0,
    step: stepMap[jobId] ?? "Preparing…",
    clips: resultMap[jobId] ?? null,
  });
});

/* ================================
   MAIN API: START PROCESS
================================ */
app.post("/process-video", async (req, res) => {
  const { youtubeUrl } = req.body;

  if (!youtubeUrl || !youtubeUrl.startsWith("http")) {
    return res.status(400).json({
      success: false,
      error: "Invalid or missing YouTube URL",
    });
  }

  const jobId = uuidv4();

  // init state
  progressMap[jobId] = 0;
  stepMap[jobId] = "Starting…";

  // 🔥 respond immediately
  res.json({
    success: true,
    jobId,
  });

  try {
    console.log("🎬 Processing:", youtubeUrl);

    const videoPath = path.join(__dirname, `${jobId}.mp4`);
    const clipsDir = path.join(__dirname, "public", "clips");

    if (!fs.existsSync(clipsDir)) {
      fs.mkdirSync(clipsDir, { recursive: true });
    }

    /* ---------------------------
       1️⃣ Download video (0–30%)
    ---------------------------- */
    stepMap[jobId] = "Downloading video…";

    await ytdlp(youtubeUrl, {
      output: videoPath,
      format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4",
      mergeOutputFormat: "mp4",
    });

    progressMap[jobId] = 30;

    /* ---------------------------
       2️⃣ Cut highlight clips (30–90%)
    ---------------------------- */
    stepMap[jobId] = "Cutting highlight clips…";

    const clips = [];
    const clipDurations = [
      { start: 10, duration: 20 },
      { start: 40, duration: 20 },
      { start: 70, duration: 20 },
    ];

    for (let i = 0; i < clipDurations.length; i++) {
      const clipId = uuidv4();
      const clipName = `clip-${clipId}.mp4`;
      const clipPath = path.join(clipsDir, clipName);

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(clipDurations[i].start)
          .setDuration(clipDurations[i].duration)
          .outputOptions("-movflags faststart")
          .output(clipPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });

      progressMap[jobId] =
        30 + Math.floor(((i + 1) / clipDurations.length) * 60);

      clips.push({
        id: clipId,
        title: `Highlight ${i + 1}`,
        duration: "00:20",
        previewUrl: `http://localhost:${PORT}/clips/${clipName}`,
        downloadUrl: `http://localhost:${PORT}/clips/${clipName}`,
      });
    }

    /* ---------------------------
       3️⃣ Finalize (90–100%)
    ---------------------------- */
    stepMap[jobId] = "Finalizing clips…";
    progressMap[jobId] = 100;
    resultMap[jobId] = clips;

    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }

    console.log("✅ Job completed:", jobId);
  } catch (err) {
    console.error("❌ ERROR:", err);
    progressMap[jobId] = -1;
    stepMap[jobId] = "Processing failed";
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
