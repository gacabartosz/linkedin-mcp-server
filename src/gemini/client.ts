import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../utils/config.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { log } from "../utils/logger.js";

interface GeminiPrediction {
  bytesBase64Encoded: string;
  mimeType: string;
}

interface GeminiResponse {
  predictions: GeminiPrediction[];
}

export async function generateImage(options: {
  prompt: string;
  aspect_ratio?: string;
  save_path?: string;
}): Promise<{
  file_path: string;
  aspect_ratio: string;
}> {
  if (!config.geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY not set. Get a free API key at https://aistudio.google.com and set the GEMINI_API_KEY environment variable."
    );
  }

  const model = "imagen-4.0-generate-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${config.geminiApiKey}`;

  const aspectRatio = options.aspect_ratio || "1:1";

  log("info", `Generating image: "${options.prompt.substring(0, 50)}..." (${aspectRatio})`);

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: options.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
      },
    }),
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errorText}`);
  }

  const data = await response.json() as GeminiResponse;

  if (!data.predictions || data.predictions.length === 0) {
    throw new Error("Gemini returned no images. The prompt may have been blocked by safety filters.");
  }

  const imageData = data.predictions[0];
  const buffer = Buffer.from(imageData.bytesBase64Encoded, "base64");

  // Save to disk
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const slug = options.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .substring(0, 40)
    .replace(/-$/, "");
  const fileName = `${timestamp}-${slug}.png`;
  const filePath = options.save_path || join(config.imagesDir, fileName);

  writeFileSync(filePath, buffer);
  log("info", `Image saved: ${filePath} (${buffer.length} bytes)`);

  return {
    file_path: filePath,
    aspect_ratio: aspectRatio,
  };
}
