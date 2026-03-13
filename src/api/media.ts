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
    uploadUrl?: string;
    image?: string;
    video?: string;
    uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
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
  // Use v2/assets API (compatible with v2/ugcPosts for publishing)
  // The /rest/images API returns urn:li:image: URNs which do NOT work with ugcPosts
  try {
    return await uploadImageV2Assets(personUrn, buffer, ext);
  } catch (err) {
    log("warn", `v2/assets image upload failed: ${err}, trying /rest/images`);
    return await uploadImageRest(personUrn, buffer, ext);
  }
}

/** v2/assets flow — compatible with v2/ugcPosts (w_member_social scope) */
async function uploadImageV2Assets(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  const register = await linkedinRequest<RegisterUploadResponse>(
    "POST",
    "/assets?action=registerUpload",
    {
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: personUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
        supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      },
    },
    { apiBase: "v2" },
  );

  const uploadMech = register.value.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  if (!uploadMech?.uploadUrl) throw new Error("No upload URL returned from v2/assets for image");
  const assetUrn = register.value.asset || "";

  log("info", `Image registered: ${assetUrn}, uploading binary...`);

  const contentType = IMAGE_MIME[ext] || "application/octet-stream";
  await linkedinUploadBinary(uploadMech.uploadUrl, buffer, contentType);

  log("info", `Image uploaded via v2/assets: ${assetUrn}`);

  return {
    media_urn: assetUrn,
    media_type: "IMAGE",
    upload_status: "READY",
  };
}

/** /rest/images flow — for use with /rest/posts API (requires Community Management) */
async function uploadImageRest(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  const init = await linkedinRequest<InitializeUploadResponse>(
    "POST",
    "/images?action=initializeUpload",
    { initializeUploadRequest: { owner: personUrn } },
  );

  const uploadUrl = init.value.uploadUrl || init.value.uploadInstructions?.[0]?.uploadUrl;
  if (!uploadUrl) throw new Error("No upload URL returned from LinkedIn image API");
  const imageUrn = init.value.image || "";

  const contentType = IMAGE_MIME[ext] || "application/octet-stream";
  await linkedinUploadBinary(uploadUrl, buffer, contentType);

  log("info", `Image uploaded via /rest/images: ${imageUrn}`);

  return {
    media_urn: imageUrn,
    media_type: "IMAGE",
    upload_status: "READY",
  };
}

interface RegisterUploadResponse {
  value: {
    asset: string;
    mediaArtifact?: string;
    uploadMechanism: {
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": {
        uploadUrl: string;
        headers: Record<string, string>;
      };
    };
  };
}

async function uploadVideo(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  // Use v2/assets API (compatible with v2/ugcPosts for publishing)
  // The /rest/videos API returns urn:li:video: URNs which do NOT work with ugcPosts
  try {
    return await uploadVideoV2Assets(personUrn, buffer, ext);
  } catch (err) {
    log("warn", `v2/assets video upload failed: ${err}, trying /rest/videos`);
    return await uploadVideoRest(personUrn, buffer, ext);
  }
}

/** v2/assets flow — compatible with v2/ugcPosts (w_member_social scope) */
async function uploadVideoV2Assets(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
  // Step 1: Register upload via v2/assets
  const register = await linkedinRequest<RegisterUploadResponse>(
    "POST",
    "/assets?action=registerUpload",
    {
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-video"],
        owner: personUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
        supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      },
    },
    { apiBase: "v2" },
  );

  const uploadMech = register.value.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
  if (!uploadMech?.uploadUrl) throw new Error("No upload URL returned from v2/assets");
  const assetUrn = register.value.asset || "";

  log("info", `Video registered: ${assetUrn}, uploading binary...`);

  // Step 2: PUT binary to upload URL
  const contentType = VIDEO_MIME[ext] || "video/mp4";
  await linkedinUploadBinary(uploadMech.uploadUrl, buffer, contentType);

  log("info", `Video uploaded via v2/assets: ${assetUrn}`);

  return {
    media_urn: assetUrn,
    media_type: "VIDEO",
    upload_status: "READY",
  };
}

/** /rest/videos flow — for use with /rest/posts API (requires Community Management) */
async function uploadVideoRest(
  personUrn: string,
  buffer: Buffer,
  ext: string,
): Promise<{ media_urn: string; media_type: string; upload_status: string }> {
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

  const uploadUrl = init.value.uploadUrl || init.value.uploadInstructions?.[0]?.uploadUrl;
  if (!uploadUrl) throw new Error("No upload URL returned from LinkedIn video API");
  const videoUrn = init.value.video || "";

  const contentType = VIDEO_MIME[ext] || "video/mp4";
  await linkedinUploadBinary(uploadUrl, buffer, contentType);

  log("info", `Video uploaded via /rest/videos: ${videoUrn}`);

  return {
    media_urn: videoUrn,
    media_type: "VIDEO",
    upload_status: "PROCESSING",
  };
}
