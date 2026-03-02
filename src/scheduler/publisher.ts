import { type ScheduledPost, updateScheduleStatus } from "./store.js";
import { createPost } from "../api/posts.js";
import { generateImage } from "../gemini/client.js";
import { uploadMedia } from "../api/media.js";
import { applyTemplate } from "../content/templates.js";
import { log } from "../utils/logger.js";

export async function publishScheduledPost(post: ScheduledPost): Promise<void> {
  try {
    updateScheduleStatus(post.id, "publishing");

    let text = post.text;
    let mediaIds: string[] = post.media_ids ? JSON.parse(post.media_ids) : [];

    // Apply template if specified
    if (post.template_id) {
      const vars = post.template_vars ? JSON.parse(post.template_vars) : {};
      const templateText = applyTemplate(post.template_id, vars);
      if (templateText) text = templateText;
    }

    // Generate Gemini image if specified
    if (post.gemini_prompt) {
      try {
        const imageResult = await generateImage({
          prompt: post.gemini_prompt,
          aspect_ratio: (post.gemini_aspect_ratio as "1:1") || "1:1",
        });

        const uploadResult = await uploadMedia({
          file_path: imageResult.file_path,
          media_type: "IMAGE",
        });

        mediaIds.push(uploadResult.media_urn);
      } catch (err) {
        log("warn", `Gemini image generation failed for schedule ${post.id}`, err);
        // Continue without image
      }
    }

    // Publish to LinkedIn
    const result = await createPost({
      text,
      visibility: post.visibility as "PUBLIC" | "CONNECTIONS",
      media_ids: mediaIds.length > 0 ? mediaIds : undefined,
      article_url: post.article_url || undefined,
      article_title: post.article_title || undefined,
      article_description: post.article_description || undefined,
    });

    updateScheduleStatus(post.id, "published", {
      post_urn: result.post_urn,
      published_at: new Date().toISOString(),
    });

    log("info", `Published scheduled post ${post.id} → ${result.post_urn}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const newRetryCount = post.retry_count + 1;

    if (newRetryCount < 3) {
      // Retry in 5 minutes
      const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      updateScheduleStatus(post.id, "scheduled", {
        error: errorMsg,
        retry_count: newRetryCount,
      });
      log("warn", `Scheduled post ${post.id} failed (attempt ${newRetryCount}/3), retrying at ${retryAt}`, errorMsg);
    } else {
      updateScheduleStatus(post.id, "failed", {
        error: errorMsg,
        retry_count: newRetryCount,
      });
      log("error", `Scheduled post ${post.id} permanently failed after 3 attempts`, errorMsg);
    }
  }
}
