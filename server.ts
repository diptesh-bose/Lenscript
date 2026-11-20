import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import type { LiveServerMessage } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function formatGeminiError(err: unknown): string {
  console.error("[Lenscript Gemini Error]", err);
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("API_KEY_INVALID") || raw.includes("PERMISSION_DENIED") || raw.includes("403")) {
    return "Your Gemini API key appears invalid or lacks permission. Please verify it in Settings > Secrets.";
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return "Rate limit reached on the Gemini API. Please wait a moment and try again.";
  }
  return raw || "An unexpected error occurred while calling the Gemini API.";
}

const SAMPLE_SCRIPTS: Record<
  string,
  { title: string; filename: string; suggestedDirective: string; text: string; voice: string }
> = {
  physics: {
    title: "Quantum Entanglement & Non-Locality",
    filename: "quantum_entanglement_lecture.wav",
    suggestedDirective: "Help me understand the meaning as if I am a 10 year old kid",
    voice: "Charon",
    text: "Quantum entanglement occurs when two or more subatomic particles interact in such a way that the quantum state of each particle cannot be described independently of the others, regardless of the spatial separation between them. When we measure the spin projection of one entangled fermion along an arbitrary axis, its wavefunction collapses instantaneously, deterministically dictating the correlated eigenvalue of its distant partner. This non-local correlation violates Bell's inequality, proving that no local hidden-variable theory can account for quantum mechanical predictions, yet it strictly preserves relativistic causality because no usable information propagates faster than the speed of light.",
  },
  biology: {
    title: "CRISPR-Cas9 Programmable Gene Editing",
    filename: "crispr_molecular_lecture.wav",
    suggestedDirective: "Help me understand the meaning as if I am a 10 year old kid",
    voice: "Kore",
    text: "The CRISPR-Cas9 ribonucleoprotein complex functions as an RNA-guided endonuclease originally evolved as a prokaryotic adaptive immune defense against bacteriophages. A synthetic single-guide RNA directs the Cas9 enzyme to scan double-stranded genomic DNA for a protospacer adjacent motif, initiating R-loop formation and Watson-Crick base pairing. Upon precise sequence complementarity, the HNH and RuvC nuclease domains induce a site-specific double-strand break, prompting eukaryotic cellular repair machinery to execute either error-prone non-homologous end joining or precise homology-directed repair.",
  },
  economics: {
    title: "Quantitative Tightening & Yield Curve Dynamics",
    filename: "macro_yield_curve_brief.wav",
    suggestedDirective: "Extract the 4 sharpest takeaways in plain, practical language",
    voice: "Puck",
    text: "When a central bank accelerates quantitative tightening by allowing maturing sovereign treasury securities to roll off its balance sheet without reinvestment, the net supply of duration risk absorbed by private market participants expands. Simultaneously, elevated policy rates anchor the front end of the yield curve, compressing term premia and frequently inducing an inverted spread between two-year and ten-year yields. Institutional credit creation subsequently moderates as commercial banks reprice wholesale funding costs and tighten underwriting standards across corporate lending facilities.",
  },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit for inline multimodal transcription
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
    if (pathname === "/ws/live-transcribe") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  // Helper: wrap raw 16kHz mono 16-bit LE PCM chunks into a valid WAV buffer for multimodal transcription
  const wrapPcm16AsWav = (pcmBuffer: Buffer, sampleRate = 16000): Buffer => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcmBuffer.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32); // block align
    header.writeUInt16LE(16, 34); // bits per sample
    header.write("data", 36);
    header.writeUInt32LE(pcmBuffer.length, 40);
    return Buffer.concat([header, pcmBuffer]);
  };

  // WebSocket bridge for real-time 16kHz PCM microphone transcription
  wss.on("connection", async (clientWs) => {
    let closed = false;
    let liveReady = false;
    let session: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null = null;
    let useChunkedFallback = false;
    let pcmChunks: Buffer[] = [];
    let pcmBytes = 0;
    let flushingChunk = false;

    let ai: GoogleGenAI;
    try {
      ai = getGenAI();
    } catch (err) {
      clientWs.send(JSON.stringify({ type: "error", message: formatGeminiError(err) }));
      clientWs.close();
      return;
    }

    const activateChunkedFallback = () => {
      if (useChunkedFallback || closed) return;
      useChunkedFallback = true;
      session = null;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "ready", mode: "chunked" }));
      }
    };

    const flushPcmBuffer = async () => {
      if (flushingChunk || pcmBytes < 16000 * 2 * 1.5) return; // wait for >= 1.5s audio
      flushingChunk = true;
      const combined = Buffer.concat(pcmChunks);
      pcmChunks = [];
      pcmBytes = 0;

      // Check RMS energy to skip pure silence
      let sumSq = 0;
      const sampleCount = Math.floor(combined.length / 2);
      for (let i = 0; i < sampleCount; i++) {
        const s = combined.readInt16LE(i * 2) / 32768;
        sumSq += s * s;
      }
      const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0;

      if (rms < 0.008) {
        flushingChunk = false;
        return;
      }

      try {
        const wavBase64 = wrapPcm16AsWav(combined, 16000).toString("base64");
        const resp = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: {
            parts: [
              { inlineData: { mimeType: "audio/wav", data: wavBase64 } },
              {
                text: "Transcribe only the spoken words verbatim. Do not add timestamps, labels, or commentary. If there is no intelligible speech, return an empty string.",
              },
            ],
          },
        });
        const text = (resp.text || "").trim();
        if (text && !closed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "final", text }));
        }
      } catch (err) {
        if (!closed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "error", message: formatGeminiError(err) }));
        }
      } finally {
        flushingChunk = false;
      }
    };

    const connectLive = async () => {
      try {
        const s = await ai.live.connect({
          model: "gemini-3.5-transcribe-live",
          config: {
            responseModalities: [Modality.TEXT],
            inputAudioTranscription: {
              languageCodes: [],
            },
          },
          callbacks: {
            onopen: () => {
              liveReady = true;
              if (!closed && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "ready" }));
              }
            },
            onmessage: (message: LiveServerMessage) => {
              if (closed || clientWs.readyState !== WebSocket.OPEN) return;
              const content = message.serverContent;
              if (content?.interimInputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({
                    type: "interim",
                    text: content.interimInputTranscription.text,
                  })
                );
              }
              if (content?.inputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({
                    type: "final",
                    text: content.inputTranscription.text,
                  })
                );
              }
            },
            onerror: () => {
              if (!liveReady) {
                activateChunkedFallback();
              }
            },
            onclose: () => {
              if (!liveReady) {
                activateChunkedFallback();
                return;
              }
              if (!useChunkedFallback && !closed && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "closed" }));
              }
            },
          },
        });
        if (!useChunkedFallback) {
          session = s;
        }
        return s;
      } catch {
        activateChunkedFallback();
        return null;
      }
    };

    const sessionPromise = connectLive();

    const fallbackInterval = setInterval(() => {
      if (useChunkedFallback && !closed) {
        void flushPcmBuffer();
      }
    }, 2200);

    clientWs.on("message", async (raw) => {
      if (closed) return;
      try {
        const payload = JSON.parse(raw.toString()) as { type: string; data?: string };
        if (payload.type === "stop") {
          clearInterval(fallbackInterval);
          if (useChunkedFallback && pcmBytes > 0) {
            await flushPcmBuffer();
          }
          closed = true;
          const active = session || (await sessionPromise);
          active?.close();
          return;
        }
        if (payload.type === "audio" && payload.data) {
          if (useChunkedFallback) {
            const buf = Buffer.from(payload.data, "base64");
            pcmChunks.push(buf);
            pcmBytes += buf.length;
            return;
          }
          const active = session || (await sessionPromise);
          if (active && !closed) {
            active.sendRealtimeInput({
              audio: {
                data: payload.data,
                mimeType: "audio/pcm;rate=16000",
              },
            });
          } else if (useChunkedFallback) {
            const buf = Buffer.from(payload.data, "base64");
            pcmChunks.push(buf);
            pcmBytes += buf.length;
          }
        }
      } catch (err) {
        if (!closed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: "error",
              message: formatGeminiError(err),
            })
          );
        }
      }
    });

    clientWs.on("close", async () => {
      closed = true;
      clearInterval(fallbackInterval);
      try {
        const active = session || (await sessionPromise);
        active?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Real-time streaming directive interpreter: supports single live segment OR re-aligning all timed segments
  app.post("/api/interpret-stream", async (req, res) => {
    const { mode, segmentText, recentContext, segments, directive } = req.body as {
      mode?: "segment" | "realign";
      segmentText?: string;
      recentContext?: string;
      segments?: Array<{ timestamp: string; speech: string }>;
      directive?: string;
    };

    const activeDirective =
      directive?.trim() || "Explain the core meaning clearly in plain language.";

    if (mode === "segment") {
      if (!segmentText || !segmentText.trim()) {
        res.status(400).json({ error: "Segment text is required." });
        return;
      }
    } else if (!segments || segments.length === 0) {
      res.status(400).json({ error: "Transcript segments are required." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(": stream-open\n\n");

    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        aborted = true;
      }
    });

    try {
      const ai = getGenAI();

      if (mode === "segment") {
        const systemInstruction = `You are a real-time speech-to-meaning interpreter.
Translate the latest spoken phrase into its timed meaning strictly according to the user's directive.

USER DIRECTIVE:
"${activeDirective}"

Rules:
1. Respond with ONLY 1 to 2 crisp, natural sentences explaining what this specific spoken phrase means under the user's directive.
2. Match the tone, vocabulary, and depth requested by the directive (e.g., kid-friendly analogies if asked to explain to a 10-year-old).
3. Do NOT repeat the directive, do NOT add headers, bullets, timestamps, or meta-commentary.`;

        const prompt = recentContext?.trim()
          ? `Prior spoken context (for coherence only):\n${recentContext}\n\nLatest spoken phrase to translate now:\n${segmentText}`
          : `Spoken phrase to translate now:\n${segmentText}`;

        const stream = await ai.models.generateContentStream({
          model: "gemini-3.1-flash-lite",
          contents: prompt,
          config: { systemInstruction },
        });

        for await (const chunk of stream) {
          if (aborted) break;
          if (chunk.text) {
            res.write(`event: meaning_delta\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
          }
        }
      } else {
        const formattedSegments = segments!
          .map((s) => `[${s.timestamp}] ${s.speech}`)
          .join("\n");

        const systemInstruction = `You are a real-time speech-to-meaning interpreter.
For EACH timestamped spoken segment below, produce a 1-to-1 aligned meaning strictly according to the user's directive.

USER DIRECTIVE:
"${activeDirective}"

STRICT OUTPUT FORMAT (stream chronologically, one block per input timestamp):
@@SEG MM:SS
MEANING: <1 to 2 crisp sentences translating ONLY what is spoken in this specific timed segment, following the user's directive>

Rules:
- Preserve the EXACT timestamp from each input segment.
- Stream one @@SEG block for every single input segment in exact order.
- Do not combine segments or skip any timestamp.
- Do not output any intro or outro text outside @@SEG blocks.`;

        const stream = await ai.models.generateContentStream({
          model: "gemini-3.1-flash-lite",
          contents: `Generate the aligned timed meanings for these segments:\n\n${formattedSegments}`,
          config: { systemInstruction },
        });

        for await (const chunk of stream) {
          if (aborted) break;
          if (chunk.text) {
            res.write(`event: aligned_delta\ndata: ${JSON.stringify({ text: chunk.text })}\n\n`);
          }
        }
      }

      if (!aborted) {
        res.write(`event: complete\ndata: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (err) {
      if (!aborted) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ message: formatGeminiError(err) })}\n\n`
        );
        res.end();
      }
    }
  });

  // Upload audio or video file -> single-pass real-time aligned [MM:SS] SPEECH + MEANING SSE stream
  app.post("/api/transcribe-media", upload.single("file"), async (req, res) => {
    const file = req.file;
    const directive =
      (req.body?.directive as string | undefined)?.trim() ||
      "Explain the core meaning clearly in plain language.";

    if (!file) {
      res.status(400).json({ error: "Please upload an audio or video file." });
      return;
    }

    const inferMimeFromName = (name: string): string => {
      const ext = path.extname(name).toLowerCase();
      const map: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".aac": "audio/aac",
        ".flac": "audio/flac",
        ".webm": "video/webm",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
      };
      return map[ext] || "";
    };

    const rawMime = file.mimetype || "";
    const mimeType =
      rawMime && rawMime !== "application/octet-stream"
        ? rawMime
        : inferMimeFromName(file.originalname) || "audio/webm";
    const isVideo = mimeType.startsWith("video/");
    const isAudio = mimeType.startsWith("audio/");

    if (!isVideo && !isAudio) {
      res.status(400).json({
        error: `Unsupported file type (${mimeType}). Please upload an audio or video file.`,
      });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        aborted = true;
      }
    });

    const sendEvent = (event: string, data: unknown) => {
      if (!aborted) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const ai = getGenAI();
      const base64Media = file.buffer.toString("base64");

      sendEvent("phase", {
        phase: "streaming",
        message: isVideo
          ? "Streaming synced speech & directive meaning from video..."
          : "Streaming synced speech & directive meaning...",
      });

      const mediaPart = {
        inlineData: {
          mimeType,
          data: base64Media,
        },
      };

      const alignedPrompt = `Listen chronologically from start to finish${
        isVideo ? " while observing the video frames" : ""
      }. Break the spoken audio into short, natural sentence or clause segments (roughly every 4 to 8 seconds) with exact MM:SS start timestamps.

For EVERY timed segment in chronological order, immediately output its verbatim speech paired with its directive-guided meaning:

USER DIRECTIVE:
"${directive}"

STRICT STREAMING FORMAT (repeat this exact 3-line block for each timed segment):
@@SEG MM:SS
SPEECH: <exact verbatim words spoken at this timestamp${
        isVideo ? "; include a brief parenthetical visual note only if a diagram or slide is directly referenced" : ""
      }>
MEANING: <1 to 2 crisp sentences translating what THAT specific timed segment means, strictly following the user's directive>

Rules:
- Always output SPEECH first, then MEANING immediately after for that same timestamp before moving to the next timestamp.
- Never group the whole recording into a single summary—every timed segment must have its own aligned MEANING.
- Do not output any intro, outro, or Markdown headers outside the @@SEG blocks.`;

      const stream = await ai.models.generateContentStream({
        model: "gemini-3.1-flash-lite",
        contents: {
          parts: [mediaPart, { text: alignedPrompt }],
        },
      });

      let fullOutput = "";
      for await (const chunk of stream) {
        if (aborted) break;
        if (chunk.text) {
          fullOutput += chunk.text;
          sendEvent("aligned_delta", { text: chunk.text });
        }
      }

      if (aborted) return;

      if (!fullOutput.trim()) {
        sendEvent("error", {
          message: "No audible speech was detected in the uploaded media file.",
        });
        res.end();
        return;
      }

      sendEvent("complete", { done: true });
      res.end();
    } catch (err) {
      sendEvent("error", { message: formatGeminiError(err) });
      res.end();
    }
  });

  // Generate real spoken sample audio using Gemini TTS (gemini-3.8-flash-lite-tts)
  app.post("/api/sample-audio", async (req, res) => {
    const { topicId } = req.body as { topicId?: string };
    const sample = SAMPLE_SCRIPTS[topicId || "physics"] || SAMPLE_SCRIPTS.physics;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error(
          "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets."
        );
      }

      let base64Audio: string | undefined;

      // Try v1beta/v1alpha with speechConfig first; fallback to clean AUDIO modality if endpoint rejects speechConfig
      try {
        const aiAlpha = new GoogleGenAI({
          apiKey,
          apiVersion: "v1alpha",
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        const response = await aiAlpha.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: sample.text,
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: sample.voice },
              },
            },
          },
        });
        base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } catch {
        const ai = getGenAI();
        const fallbackResp = await ai.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: sample.text,
          config: {
            responseModalities: ["AUDIO"],
          },
        });
        base64Audio = fallbackResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      }

      if (!base64Audio) {
        res.status(502).json({ error: "Speech synthesis did not return audio data." });
        return;
      }

      res.json({
        title: sample.title,
        filename: sample.filename,
        mimeType: "audio/wav",
        suggestedDirective: sample.suggestedDirective,
        base64Audio,
      });
    } catch (err) {
      res.status(500).json({ error: formatGeminiError(err) });
    }
  });

  // Mount Vite in development or serve built static files in production
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Lenscript server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
