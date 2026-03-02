#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { ensureDataDirs, config } from "./utils/config.js";
import { log } from "./utils/logger.js";
import { toolError, toolResult } from "./utils/errors.js";
import { startAuth } from "./api/auth.js";
import { loadTokens } from "./api/client.js";
import { getMyProfile } from "./api/profile.js";
import { createPost, updatePost, deletePost, getPost, listPosts, repost } from "./api/posts.js";
import { uploadMedia } from "./api/media.js";
import { createComment, listComments, deleteComment } from "./api/comments.js";
import { addReaction, removeReaction } from "./api/reactions.js";
import { createSchedule, listSchedules, cancelSchedule, updateScheduleFields, getSchedule } from "./scheduler/store.js";
import { startSchedulerDaemon } from "./scheduler/daemon.js";
import { listTemplates, getTemplate, saveTemplate, applyTemplate } from "./content/templates.js";
import { getBrandVoice, setBrandVoice } from "./content/brand-voice.js";
import { generateImage } from "./gemini/client.js";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const AuthStartInput = z.object({
  scopes: z.array(z.string()).optional(),
});

const PostCreateInput = z.object({
  text: z.string(),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
  media_ids: z.array(z.string()).optional(),
  article_url: z.string().optional(),
  article_title: z.string().optional(),
  article_description: z.string().optional(),
  template_id: z.string().optional(),
  template_vars: z.record(z.string()).optional(),
});

const PostUrnInput = z.object({ post_urn: z.string() });

const PostUpdateInput = z.object({
  post_urn: z.string(),
  text: z.string(),
});

const PostRepostInput = z.object({
  post_urn: z.string(),
  commentary: z.string().optional(),
});

const PostsListInput = z.object({
  count: z.number().int().min(1).max(50).optional(),
  start: z.number().int().min(0).optional(),
});

const CommentCreateInput = z.object({
  post_urn: z.string(),
  text: z.string(),
  parent_comment_urn: z.string().optional(),
});

const CommentsListInput = z.object({
  post_urn: z.string(),
  count: z.number().int().min(1).max(50).optional(),
  start: z.number().int().min(0).optional(),
});

const CommentDeleteInput = z.object({ comment_urn: z.string() });

const ReactionAddInput = z.object({
  entity_urn: z.string(),
  reaction_type: z.enum(["LIKE", "CELEBRATE", "SUPPORT", "LOVE", "INSIGHTFUL", "FUNNY"]),
});

const ReactionRemoveInput = z.object({ entity_urn: z.string() });

const MediaUploadInput = z.object({
  file_path: z.string().optional(),
  url: z.string().optional(),
  media_type: z.enum(["IMAGE", "VIDEO"]),
  alt_text: z.string().optional(),
});

const GeminiImageInput = z.object({
  prompt: z.string(),
  aspect_ratio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]).optional(),
  upload_to_linkedin: z.boolean().optional(),
  save_path: z.string().optional(),
  alt_text: z.string().optional(),
});

const ScheduleCreateInput = z.object({
  text: z.string(),
  publish_at: z.string(),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
  media_ids: z.array(z.string()).optional(),
  article_url: z.string().optional(),
  template_id: z.string().optional(),
  template_vars: z.record(z.string()).optional(),
  gemini_prompt: z.string().optional(),
  gemini_aspect_ratio: z.string().optional(),
});

const ScheduleListInput = z.object({
  status: z.enum(["scheduled", "published", "failed", "cancelled"]).optional(),
});

const ScheduleIdInput = z.object({ schedule_id: z.string() });

const ScheduleUpdateInput = z.object({
  schedule_id: z.string(),
  text: z.string().optional(),
  publish_at: z.string().optional(),
  visibility: z.string().optional(),
  media_ids: z.array(z.string()).optional(),
});

const TemplateListInput = z.object({ category: z.string().optional() });
const TemplateGetInput = z.object({ template_id: z.string() });
const TemplateSaveInput = z.object({
  name: z.string(),
  category: z.string().optional(),
  body: z.string(),
  variables: z.array(z.object({
    name: z.string(),
    description: z.string(),
    required: z.boolean().optional(),
    default: z.string().optional(),
  })).optional(),
});

const BrandVoiceInput = z.object({
  action: z.enum(["get", "set"]),
  config: z.object({
    tone: z.string().optional(),
    emoji_style: z.enum(["none", "minimal", "moderate", "heavy"]).optional(),
    hashtag_strategy: z.string().optional(),
    post_structure: z.string().optional(),
    language: z.string().optional(),
    max_length: z.number().optional(),
    avoid_words: z.array(z.string()).optional(),
    signature_phrases: z.array(z.string()).optional(),
    line_spacing: z.string().optional(),
  }).optional(),
});

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "linkedin-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Auth
    {
      name: "linkedin_auth_start",
      description: "Start LinkedIn OAuth 2.0 authorization. Returns a URL to open in your browser. After authorizing, tokens are saved automatically.",
      inputSchema: {
        type: "object",
        properties: {
          scopes: { type: "array", items: { type: "string" }, description: "OAuth scopes (default: openid, profile, w_member_social)" },
        },
      },
    },
    {
      name: "linkedin_auth_status",
      description: "Check current LinkedIn authentication status — token validity, expiry, authenticated user.",
      inputSchema: { type: "object", properties: {} },
    },
    // Profile
    {
      name: "linkedin_profile_me",
      description: "Get the authenticated user's LinkedIn profile (name, person URN, profile picture).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "linkedin_brand_voice",
      description: "Get or set brand voice configuration (tone, emoji style, hashtag strategy, post structure, language preferences).",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set"], description: "get or set brand voice config" },
          config: {
            type: "object",
            description: "Brand voice settings (only for action=set)",
            properties: {
              tone: { type: "string" },
              emoji_style: { type: "string", enum: ["none", "minimal", "moderate", "heavy"] },
              hashtag_strategy: { type: "string" },
              post_structure: { type: "string" },
              language: { type: "string" },
              max_length: { type: "number" },
              avoid_words: { type: "array", items: { type: "string" } },
              signature_phrases: { type: "array", items: { type: "string" } },
              line_spacing: { type: "string" },
            },
          },
        },
        required: ["action"],
      },
    },
    // Posts — Write
    {
      name: "linkedin_post_create",
      description: "Create a new LinkedIn post. Supports text-only, text with image/video (use linkedin_media_upload first), or text with article link. Optionally apply a content template.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post body text" },
          visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"], description: "Post visibility (default: PUBLIC)" },
          media_ids: { type: "array", items: { type: "string" }, description: "Media URNs from linkedin_media_upload" },
          article_url: { type: "string", description: "Share an article link" },
          article_title: { type: "string", description: "Article title" },
          article_description: { type: "string", description: "Article description" },
          template_id: { type: "string", description: "Content template ID to apply" },
          template_vars: { type: "object", description: "Variables for template substitution" },
        },
        required: ["text"],
      },
    },
    {
      name: "linkedin_post_update",
      description: "Edit the text of an existing LinkedIn post. Only the post author can edit.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN to edit" },
          text: { type: "string", description: "New post text" },
        },
        required: ["post_urn", "text"],
      },
    },
    {
      name: "linkedin_post_delete",
      description: "Delete a LinkedIn post by its URN. This action is irreversible.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN to delete" },
        },
        required: ["post_urn"],
      },
    },
    {
      name: "linkedin_post_repost",
      description: "Repost (share) an existing LinkedIn post to your feed, with optional commentary.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN to repost" },
          commentary: { type: "string", description: "Optional commentary to add" },
        },
        required: ["post_urn"],
      },
    },
    // Posts — Read
    {
      name: "linkedin_post_get",
      description: "Get details of a specific LinkedIn post by URN.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN" },
        },
        required: ["post_urn"],
      },
    },
    {
      name: "linkedin_posts_list",
      description: "List your recent LinkedIn posts with pagination.",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "number", description: "Number of posts to return (default: 10, max: 50)" },
          start: { type: "number", description: "Pagination offset (default: 0)" },
        },
      },
    },
    // Comments
    {
      name: "linkedin_comment_create",
      description: "Add a comment to a LinkedIn post. Supports top-level comments and replies to existing comments.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN to comment on" },
          text: { type: "string", description: "Comment text" },
          parent_comment_urn: { type: "string", description: "Parent comment URN for replies" },
        },
        required: ["post_urn", "text"],
      },
    },
    {
      name: "linkedin_comments_list",
      description: "List comments on a LinkedIn post.",
      inputSchema: {
        type: "object",
        properties: {
          post_urn: { type: "string", description: "Post URN" },
          count: { type: "number", description: "Number of comments (default: 10)" },
          start: { type: "number", description: "Pagination offset" },
        },
        required: ["post_urn"],
      },
    },
    {
      name: "linkedin_comment_delete",
      description: "Delete a comment you authored.",
      inputSchema: {
        type: "object",
        properties: {
          comment_urn: { type: "string", description: "Comment URN to delete" },
        },
        required: ["comment_urn"],
      },
    },
    // Reactions
    {
      name: "linkedin_reaction_add",
      description: "React to a LinkedIn post or comment (LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY).",
      inputSchema: {
        type: "object",
        properties: {
          entity_urn: { type: "string", description: "Post or comment URN" },
          reaction_type: { type: "string", enum: ["LIKE", "CELEBRATE", "SUPPORT", "LOVE", "INSIGHTFUL", "FUNNY"], description: "Type of reaction" },
        },
        required: ["entity_urn", "reaction_type"],
      },
    },
    {
      name: "linkedin_reaction_remove",
      description: "Remove your reaction from a LinkedIn post or comment.",
      inputSchema: {
        type: "object",
        properties: {
          entity_urn: { type: "string", description: "Post or comment URN" },
        },
        required: ["entity_urn"],
      },
    },
    // Media
    {
      name: "linkedin_media_upload",
      description: "Upload an image or video to LinkedIn for use in posts. Returns a media URN. Supports local file paths and URLs.",
      inputSchema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Local file path to image/video" },
          url: { type: "string", description: "URL to download the media from" },
          media_type: { type: "string", enum: ["IMAGE", "VIDEO"], description: "Type of media" },
          alt_text: { type: "string", description: "Accessibility description" },
        },
        required: ["media_type"],
      },
    },
    {
      name: "linkedin_gemini_image",
      description: "Generate an image using Google Gemini Imagen 4 AI. Optionally upload it directly to LinkedIn. Requires GEMINI_API_KEY env var.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Image generation prompt (English)" },
          aspect_ratio: { type: "string", enum: ["1:1", "4:3", "3:4", "16:9", "9:16"], description: "Image aspect ratio (default: 1:1)" },
          upload_to_linkedin: { type: "boolean", description: "Upload to LinkedIn after generating (default: false)" },
          save_path: { type: "string", description: "Custom local save path" },
          alt_text: { type: "string", description: "Accessibility description for LinkedIn" },
        },
        required: ["prompt"],
      },
    },
    // Scheduling
    {
      name: "linkedin_schedule_create",
      description: "Schedule a LinkedIn post for future publication. The background daemon auto-publishes at the specified time. Supports Gemini image generation at publish time.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post text" },
          publish_at: { type: "string", description: "ISO 8601 datetime (e.g., 2026-03-15T09:00:00+01:00)" },
          visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"] },
          media_ids: { type: "array", items: { type: "string" }, description: "Pre-uploaded media URNs" },
          article_url: { type: "string" },
          template_id: { type: "string", description: "Content template to apply" },
          template_vars: { type: "object", description: "Template variables" },
          gemini_prompt: { type: "string", description: "Generate image at publish time with this prompt" },
          gemini_aspect_ratio: { type: "string", description: "Aspect ratio for Gemini image" },
        },
        required: ["text", "publish_at"],
      },
    },
    {
      name: "linkedin_schedule_list",
      description: "List all scheduled LinkedIn posts with optional status filter.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["scheduled", "published", "failed", "cancelled"], description: "Filter by status" },
        },
      },
    },
    {
      name: "linkedin_schedule_cancel",
      description: "Cancel a scheduled post before publication.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Schedule ID to cancel" },
        },
        required: ["schedule_id"],
      },
    },
    {
      name: "linkedin_schedule_update",
      description: "Update a scheduled post's text, time, or other properties before publication.",
      inputSchema: {
        type: "object",
        properties: {
          schedule_id: { type: "string", description: "Schedule ID to update" },
          text: { type: "string", description: "New post text" },
          publish_at: { type: "string", description: "New publish datetime" },
          visibility: { type: "string" },
          media_ids: { type: "array", items: { type: "string" } },
        },
        required: ["schedule_id"],
      },
    },
    // Templates
    {
      name: "linkedin_template_list",
      description: "List available content templates (built-in + custom). Templates help structure posts with consistent formats.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "Filter by category" },
        },
      },
    },
    {
      name: "linkedin_template_get",
      description: "Get the full content of a template including its body, variables, and example output.",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "string", description: "Template ID" },
        },
        required: ["template_id"],
      },
    },
    {
      name: "linkedin_template_save",
      description: "Create or update a custom content template. Templates use {{variable}} syntax for dynamic content.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Template name" },
          category: { type: "string", description: "Category (e.g., thought-leadership, case-study)" },
          body: { type: "string", description: "Template body with {{variable}} placeholders" },
          variables: {
            type: "array",
            description: "Variable definitions",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                required: { type: "boolean" },
                default: { type: "string" },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["name", "body"],
      },
    },
  ],
}));

// ─── Tool Execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      // ── Auth ──────────────────────────────────────────────────────────
      case "linkedin_auth_start": {
        const input = AuthStartInput.parse(args);
        const scopes = input.scopes || ["openid", "profile", "w_member_social"];
        const result = startAuth(scopes);
        return toolResult(result);
      }
      case "linkedin_auth_status": {
        const tokens = loadTokens();
        if (!tokens) {
          return toolResult({
            authenticated: false,
            instructions: "Run linkedin_auth_start to authenticate, or set LINKEDIN_ACCESS_TOKEN env var.",
          });
        }
        const expiresAt = new Date(tokens.expires_at);
        const daysRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 86400000));
        return toolResult({
          authenticated: true,
          user_name: tokens.user_name,
          person_urn: tokens.person_urn,
          token_expires_at: tokens.expires_at,
          days_remaining: daysRemaining,
          mode: config.linkedinAccessToken ? "manual_token" : "oauth",
          scopes: tokens.scopes,
        });
      }

      // ── Profile ───────────────────────────────────────────────────────
      case "linkedin_profile_me": {
        const profile = await getMyProfile();
        return toolResult(profile);
      }
      case "linkedin_brand_voice": {
        const input = BrandVoiceInput.parse(args);
        if (input.action === "get") {
          return toolResult(getBrandVoice());
        }
        if (!input.config) return toolError("config is required for action=set");
        const updated = setBrandVoice(input.config);
        return toolResult({ saved: true, config: updated });
      }

      // ── Posts — Write ─────────────────────────────────────────────────
      case "linkedin_post_create": {
        const input = PostCreateInput.parse(args);
        let text = input.text;

        // Apply template if specified
        if (input.template_id) {
          const templateText = applyTemplate(input.template_id, input.template_vars || {});
          if (templateText) text = templateText;
        }

        const result = await createPost({
          text,
          visibility: input.visibility,
          media_ids: input.media_ids,
          article_url: input.article_url,
          article_title: input.article_title,
          article_description: input.article_description,
        });
        return toolResult(result);
      }
      case "linkedin_post_update": {
        const input = PostUpdateInput.parse(args);
        const result = await updatePost(input.post_urn, input.text);
        return toolResult(result);
      }
      case "linkedin_post_delete": {
        const input = PostUrnInput.parse(args);
        const result = await deletePost(input.post_urn);
        return toolResult(result);
      }
      case "linkedin_post_repost": {
        const input = PostRepostInput.parse(args);
        const result = await repost(input.post_urn, input.commentary);
        return toolResult(result);
      }

      // ── Posts — Read ──────────────────────────────────────────────────
      case "linkedin_post_get": {
        const input = PostUrnInput.parse(args);
        const result = await getPost(input.post_urn);
        return toolResult(result);
      }
      case "linkedin_posts_list": {
        const input = PostsListInput.parse(args);
        const result = await listPosts(input.count, input.start);
        return toolResult(result);
      }

      // ── Comments ──────────────────────────────────────────────────────
      case "linkedin_comment_create": {
        const input = CommentCreateInput.parse(args);
        const result = await createComment(input.post_urn, input.text, input.parent_comment_urn);
        return toolResult(result);
      }
      case "linkedin_comments_list": {
        const input = CommentsListInput.parse(args);
        const result = await listComments(input.post_urn, input.count, input.start);
        return toolResult(result);
      }
      case "linkedin_comment_delete": {
        const input = CommentDeleteInput.parse(args);
        const result = await deleteComment(input.comment_urn);
        return toolResult(result);
      }

      // ── Reactions ─────────────────────────────────────────────────────
      case "linkedin_reaction_add": {
        const input = ReactionAddInput.parse(args);
        const result = await addReaction(input.entity_urn, input.reaction_type);
        return toolResult(result);
      }
      case "linkedin_reaction_remove": {
        const input = ReactionRemoveInput.parse(args);
        const result = await removeReaction(input.entity_urn);
        return toolResult(result);
      }

      // ── Media ─────────────────────────────────────────────────────────
      case "linkedin_media_upload": {
        const input = MediaUploadInput.parse(args);
        if (!input.file_path && !input.url) {
          return toolError("Either file_path or url must be provided.");
        }
        const result = await uploadMedia(input);
        return toolResult(result);
      }
      case "linkedin_gemini_image": {
        const input = GeminiImageInput.parse(args);
        const imageResult = await generateImage({
          prompt: input.prompt,
          aspect_ratio: input.aspect_ratio,
          save_path: input.save_path,
        });

        let mediaUrn: string | undefined;
        if (input.upload_to_linkedin) {
          const uploadResult = await uploadMedia({
            file_path: imageResult.file_path,
            media_type: "IMAGE",
            alt_text: input.alt_text,
          });
          mediaUrn = uploadResult.media_urn;
        }

        return toolResult({
          file_path: imageResult.file_path,
          aspect_ratio: imageResult.aspect_ratio,
          media_urn: mediaUrn,
        });
      }

      // ── Scheduling ────────────────────────────────────────────────────
      case "linkedin_schedule_create": {
        const input = ScheduleCreateInput.parse(args);
        const schedule = createSchedule(input);
        return toolResult({
          schedule_id: schedule.id,
          publish_at: schedule.publish_at,
          status: schedule.status,
          text_preview: schedule.text.substring(0, 100),
        });
      }
      case "linkedin_schedule_list": {
        const input = ScheduleListInput.parse(args);
        const schedules = listSchedules(input.status);
        return toolResult({
          schedules: schedules.map((s) => ({
            id: s.id,
            text_preview: s.text.substring(0, 100),
            publish_at: s.publish_at,
            status: s.status,
            created_at: s.created_at,
            published_at: s.published_at,
            error: s.error,
          })),
          total: schedules.length,
        });
      }
      case "linkedin_schedule_cancel": {
        const input = ScheduleIdInput.parse(args);
        const cancelled = cancelSchedule(input.schedule_id);
        return toolResult({ cancelled, schedule_id: input.schedule_id });
      }
      case "linkedin_schedule_update": {
        const input = ScheduleUpdateInput.parse(args);
        const updated = updateScheduleFields(input.schedule_id, {
          text: input.text,
          publish_at: input.publish_at,
          visibility: input.visibility,
          media_ids: input.media_ids,
        });
        if (!updated) return toolError(`Schedule ${input.schedule_id} not found or not in 'scheduled' status.`);
        const schedule = getSchedule(input.schedule_id);
        return toolResult({ updated: true, schedule });
      }

      // ── Templates ────────────────────────────────────────────────────
      case "linkedin_template_list": {
        const input = TemplateListInput.parse(args);
        const templates = listTemplates(input.category);
        return toolResult({ templates, total: templates.length });
      }
      case "linkedin_template_get": {
        const input = TemplateGetInput.parse(args);
        const template = getTemplate(input.template_id);
        if (!template) return toolError(`Template '${input.template_id}' not found.`);
        return toolResult(template);
      }
      case "linkedin_template_save": {
        const input = TemplateSaveInput.parse(args);
        const result = saveTemplate(input);
        return toolResult(result);
      }

      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", `Tool ${name} failed`, message);
    return toolError(message);
  }
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDataDirs();

  // Check for standalone scheduler mode
  if (process.argv.includes("--scheduler")) {
    log("info", "Starting in standalone scheduler mode");
    startSchedulerDaemon();
    // Keep process alive
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
    return;
  }

  if (process.argv.includes("--version")) {
    process.stdout.write("linkedin-mcp-server 1.0.0\n");
    process.exit(0);
  }

  if (process.argv.includes("--help")) {
    process.stdout.write(
      "linkedin-mcp-server — MCP server for LinkedIn\n\n" +
      "Usage:\n" +
      "  linkedin-mcp-server            Start MCP server (stdio transport)\n" +
      "  linkedin-mcp-server --scheduler  Start standalone scheduler daemon\n" +
      "  linkedin-mcp-server --version    Print version\n" +
      "  linkedin-mcp-server --help       Print this help\n\n" +
      "Environment variables:\n" +
      "  LINKEDIN_CLIENT_ID      LinkedIn app Client ID\n" +
      "  LINKEDIN_CLIENT_SECRET  LinkedIn app Client Secret\n" +
      "  LINKEDIN_ACCESS_TOKEN   Manual access token (skips OAuth)\n" +
      "  LINKEDIN_PERSON_URN     Person URN (with manual token)\n" +
      "  GEMINI_API_KEY          Google Gemini API key for image generation\n" +
      "  LINKEDIN_CALLBACK_PORT  OAuth callback port (default: 8585)\n" +
      "  LINKEDIN_DATA_DIR       Data directory (default: ~/.linkedin-mcp)\n" +
      "  LINKEDIN_API_VERSION    LinkedIn API version (default: 202503)\n\n" +
      "More info: https://github.com/bartoszgaca/linkedin-mcp-server\n"
    );
    process.exit(0);
  }

  // Start scheduler daemon alongside MCP server
  startSchedulerDaemon();

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "LinkedIn MCP server started (stdio transport)");
}

main().catch((err) => {
  console.error("LinkedIn MCP server failed:", err);
  process.exit(1);
});
