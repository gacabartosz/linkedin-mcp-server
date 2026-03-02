import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { linkedinRequest, linkedinUploadBinary, getPersonUrn } from "./client.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { log } from "../utils/logger.js";

const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
};

interface InitializeUploadResponse {
  value: {
    uploadUrl: string;
    image?: string;
    video?: string;
  };
}

export async function uploadMedia(options: {
  file_path?: string;
  url?: string;
  media_type: "IMAGE" | "VIDEO";
  alt_text?: string;
}): Promise<{
  media_urn: string;
  media_type: string;
  upload_status: string;
}> {
  const personUrn = getPersonUrn();

  // Get the file buffer
  let buffer: Buffer;
  let fileName: string;

  if (options.file_path) {
    buffer = readFileSync(options.file_path);
    fileName = basename(options.file_path);
  } else if (options.url) {
    const response = await fetchWithTimeout(options.url, { timeoutMs: 120_000 });
    if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
    fileName = options.url.split("/").pop() || "media";
  } else {
    throw new Error("Either file_path or url must be provided.");
  }

  const ext = extname(fileName).toLowerCase();

  if (options.media_type === "IMAGE") {
    return uploadImage(personUrn, buffer, ext);
  } else {
    return uploadVideo(personUrn, buffer, ext);
  }
}

async function uploadImage(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  // Step 1: Initialize upload
  const init = await linkedinRequest<InitializeUploadResponse>(
    "POST",
    "/images?action=initializeUpload",
    { initializeUploadRequest: { owner: personUrn } },
  );

  const uploadUrl = init.value.uploadUrl;
  const imageUrn = init.value.image || "";

  // Step 2: PUT binary
  const contentType = IMAGE_MIME[ext] || "application/octet-stream";
  await linkedinUploadBinary(uploadUrl, buffer, contentType);

  log("info", `Image uploaded: ${imageUrn}`);

  return {
    media_urn: imageUrn,
    media_type: "IMAGE",
    upload_status: "READY",
  };
}

async function uploadVideo(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  // Step 1: Initialize upload
  const init = await linkedinRequest<InitializeUploadResponse>(
    "POST",
    "/videos?action=initializeUpload",
    {
      initializeUploadRequest: {
        owner: personUrn,
        fileSizeBytes: buffer.length,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    },
  );

  const uploadUrl = init.value.uploadUrl;
  const videoUrn = init.value.video || "";

  // Step 2: PUT binary
  const contentType = VIDEO_MIME[ext] || "video/mp4";
  await linkedinUploadBinary(uploadUrl, buffer, contentType);

  log("info", `Video uploaded: ${videoUrn}`);

  return {
    media_urn: videoUrn,
    media_type: "VIDEO",
    upload_status: "PROCESSING",
  };
}
