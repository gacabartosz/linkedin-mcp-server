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
import { loadGuidelines } from "./content/guidelines.js";
import { generateImage, generateText } from "./gemini/client.js";
import { generateBanner, generateCarousel, captureScreenshot, listPresets, GRADIENTS } from "./banner/index.js";
import { generateCaseStudy } from "./casestudy/index.js";
import { loadScraperAuth, saveScraperAuth, getRateLimitStats, COMPLIANCE_DISCLAIMER } from "./scraper/voyager.js";
import { searchPeople, searchCompanies, getCompanyPeople, getCompanyInfo, extractCompanyId } from "./scraper/search.js";
import { getPersonPosts, getPersonComments, extractPublicId } from "./scraper/activity.js";
import { addCompany, listCompanies, removeCompany, addProspect, listProspects, getProspect, removeProspect, updateProspectScanTime, addActivity, getNewActivities, markActivitiesReviewed, getStats } from "./scraper/store.js";
import { classifyIntent, quickClassify } from "./scraper/classify.js";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const AuthStartInput = z.object({
  scopes: z.array(z.string()).optional(),
});

const PostCreateInput = z.object({
  text: z.string(),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
  media_ids: z.array(z.string()).optional(),
  media_category: z.enum(["IMAGE", "VIDEO", "ARTICLE", "NONE"]).optional(),
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
  banner_preset: z.string().optional(),
  banner_config: z.string().optional(),
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

const BannerGenerateInput = z.object({
  preset: z.string().optional(),
  template: z.enum(["hero", "split", "numbers", "vs", "infographic", "quote"]).optional(),
  gradient: z.enum(["ocean", "sunset", "purple", "emerald", "fire", "midnight", "teal", "rose"]).optional(),
  headline: z.string().optional(),
  subline: z.string().optional(),
  stat: z.string().optional(),
  stat_label: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  numbers: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  before: z.object({ title: z.string(), items: z.array(z.string()) }).optional(),
  after: z.object({ title: z.string(), items: z.array(z.string()) }).optional(),
  data_points: z.array(z.object({ label: z.string(), value: z.number(), max: z.number().optional() })).optional(),
  quote: z.string().optional(),
  quote_author: z.string().optional(),
  cta: z.string().optional(),
  save_path: z.string().optional(),
  upload_to_linkedin: z.boolean().optional(),
  alt_text: z.string().optional(),
});

const CarouselGenerateInput = z.object({
  slides: z.array(z.object({
    template: z.enum(["hero", "split", "numbers", "vs", "infographic", "quote"]),
    gradient: z.string().optional(),
    headline: z.string().optional(),
    subline: z.string().optional(),
    stat: z.string().optional(),
    stat_label: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    numbers: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    before: z.object({ title: z.string(), items: z.array(z.string()) }).optional(),
    after: z.object({ title: z.string(), items: z.array(z.string()) }).optional(),
    data_points: z.array(z.object({ label: z.string(), value: z.number() })).optional(),
    quote: z.string().optional(),
    quote_author: z.string().optional(),
    cta: z.string().optional(),
  })),
  gradient: z.string().optional(),
  save_path: z.string().optional(),
  upload_to_linkedin: z.boolean().optional(),
});

const ScreenshotInput = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  selector: z.string().optional(),
  full_page: z.boolean().optional(),
  save_path: z.string().optional(),
  upload_to_linkedin: z.boolean().optional(),
});

const CaseStudyInput = z.object({
  project_name: z.string(),
  project_url: z.string().optional(),
  problem: z.string(),
  solution: z.string(),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  screenshots: z.array(z.string()).optional(),
  tech_stack: z.array(z.string()).optional(),
  brand: z.enum(["bartoszgaca", "beecommerce", "neutral"]).optional(),
  generate_cover: z.boolean().optional(),
  generate_banner: z.boolean().optional(),
  language: z.enum(["pl", "en"]).optional(),
  save_path: z.string().optional(),
});

const CommentClassifyInput = z.object({
  comment_text: z.string().describe("The comment text to classify"),
  post_text: z.string().describe("The original post text (first 400 chars is enough)"),
  comment_author: z.string().optional().describe("Name of the comment author"),
});

const CommentReplyInput = z.object({
  comment_text: z.string().describe("The comment to reply to"),
  post_text: z.string().describe("The original post text for context"),
  language: z.enum(["pl", "en"]).describe("Reply language"),
  sentiment: z.enum(["positive", "negative", "neutral", "question"]).describe("Comment sentiment"),
  project_name: z.string().optional().describe("Project name for context"),
  project_repo: z.string().optional().describe("GitHub repo URL"),
  persona_profile: z.string().optional().describe("Author persona profile text"),
  persona_work_style: z.string().optional().describe("Author work style text"),
  thread_context: z.string().optional().describe("Previous replies in thread"),
});

const GuidelinesInput = z.object({
  topic: z.enum(["all", "algorithm", "copywriting", "formats", "timing", "hooks", "ctas", "checklist", "dos_donts", "links", "ab_testing"]).optional(),
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
    hook_max_chars: z.number().optional(),
    optimal_post_length: z.object({ min: z.number(), max: z.number() }).optional(),
    link_in_comment: z.boolean().optional(),
    max_hashtags: z.number().optional(),
    posting_times: z.array(z.string()).optional(),
    posting_days: z.array(z.string()).optional(),
    min_gap_hours: z.number().optional(),
    golden_hour_minutes: z.number().optional(),
    first_comment_delay_minutes: z.number().optional(),
  }).optional(),
});

// ─── Scraper Zod Schemas ─────────────────────────────────────────────────────

const ScraperAuthInput = z.object({
  li_at: z.string().describe("Your LinkedIn li_at session cookie from browser DevTools"),
});

const SearchPeopleInput = z.object({
  keywords: z.string().optional().describe("Search keywords (e.g., 'e-commerce manager')"),
  title: z.string().optional().describe("Job title filter (e.g., 'Head of Growth')"),
  company_id: z.string().optional().describe("LinkedIn company ID or universal name"),
  location: z.string().optional().describe("Location filter (e.g., 'poland', 'warsaw', or geo URN)"),
  count: z.number().int().min(1).max(25).optional().describe("Results per page (default: 10, max: 25)"),
  start: z.number().int().min(0).optional().describe("Pagination offset"),
});

const SearchCompaniesInput = z.object({
  keywords: z.string().describe("Company name or keywords"),
  count: z.number().int().min(1).max(25).optional(),
  start: z.number().int().min(0).optional(),
});

const CompanyPeopleInput = z.object({
  company: z.string().describe("Company URL (linkedin.com/company/...) or company ID/name"),
  role_keywords: z.string().optional().describe("Filter by role (e.g., 'sales', 'growth', 'business development')"),
  count: z.number().int().min(1).max(25).optional(),
  start: z.number().int().min(0).optional(),
});

const PersonActivityInput = z.object({
  profile: z.string().describe("LinkedIn profile URL (linkedin.com/in/...) or public ID"),
  type: z.enum(["posts", "comments", "all"]).optional().describe("Activity type to fetch (default: all)"),
  count: z.number().int().min(1).max(20).optional(),
  start: z.number().int().min(0).optional(),
});

const IntentClassifyInput = z.object({
  text: z.string().describe("Text to classify (post or comment content)"),
  person_name: z.string().optional(),
  person_headline: z.string().optional(),
  activity_type: z.enum(["post", "comment"]).optional(),
  original_post: z.string().optional().describe("If classifying a comment, the original post text"),
});

const ProspectSaveInput = z.object({
  name: z.string(),
  public_id: z.string().describe("LinkedIn public ID (from URL)"),
  headline: z.string().optional(),
  profile_url: z.string().optional(),
  company_name: z.string().optional(),
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  source_company_id: z.string().optional(),
});

const ProspectListInput = z.object({
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  source_company_id: z.string().optional(),
  has_new_activity: z.boolean().optional(),
});

const CompanySaveInput = z.object({
  name: z.string(),
  company: z.string().describe("Company URL or ID"),
  type: z.enum(["direct_competitor", "indirect_competitor", "target_segment", "other"]).optional(),
  notes: z.string().optional(),
});

const ProspectScanInput = z.object({
  prospect_id: z.string().optional().describe("Scan specific prospect (public_id or ID). Omit to scan all."),
  category: z.enum(["competitor_sales", "target_buyer", "influencer", "other"]).optional(),
  classify: z.boolean().optional().describe("Run AI classification on new activities (default: true)"),
});

const ActivitiesListInput = z.object({
  classification: z.enum(["sales_pitch", "buying_signal", "job_posting", "networking", "irrelevant"]).optional(),
  prospect_id: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  mark_reviewed: z.boolean().optional().describe("Mark returned activities as reviewed (default: false)"),
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
      description: "Get or set brand voice configuration — tone, emoji style, hashtag strategy, post structure, language, and LinkedIn algorithm settings (hook length, optimal post length, posting times, golden hour).",
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
      description: "Create a new LinkedIn post. Best practices: keep text 1300-1600 chars for highest engagement, put hook in first 210 chars (before 'see more'), max 3 hashtags at end, NO external links in post body (use linkedin_comment_create after 15 min). Use linkedin_guidelines first for full strategy.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post body text" },
          visibility: { type: "string", enum: ["PUBLIC", "CONNECTIONS"], description: "Post visibility (default: PUBLIC)" },
          media_ids: { type: "array", items: { type: "string" }, description: "Media URNs from linkedin_media_upload" },
          media_category: { type: "string", enum: ["IMAGE", "VIDEO", "ARTICLE", "NONE"], description: "Media category override (auto-detected if omitted, use VIDEO for video posts)" },
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
    // Banner Generation
    {
      name: "linkedin_banner_generate",
      description: "Generate a professional LinkedIn banner image (1200×627, 2x retina). 6 templates: hero (stat + headline), split (bullets + icon), numbers (3 stats), vs (before/after), infographic (bar chart), quote (pull-quote). 8 gradient themes. Visual complexity for max dwell time. Optionally upload to LinkedIn.",
      inputSchema: {
        type: "object",
        properties: {
          preset: { type: "string", description: "Built-in preset name (post5-post17)" },
          template: { type: "string", enum: ["hero", "split", "numbers", "vs", "infographic", "quote"], description: "Template type" },
          gradient: { type: "string", enum: ["ocean", "sunset", "purple", "emerald", "fire", "midnight", "teal", "rose"] },
          headline: { type: "string", description: "Main headline text (required for custom)" },
          subline: { type: "string", description: "Subtitle text (hero template)" },
          stat: { type: "string", description: "Big stat number (hero template)" },
          stat_label: { type: "string", description: "Label under the stat (hero template)" },
          bullets: { type: "array", items: { type: "string" }, description: "Bullet points (split template, max 5)" },
          numbers: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } }, required: ["value", "label"] }, description: "Number items (numbers template)" },
          before: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } }, description: "Before section (vs template)" },
          after: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } }, description: "After section (vs template)" },
          data_points: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" }, max: { type: "number" } }, required: ["label", "value"] }, description: "Data points (infographic template)" },
          quote: { type: "string", description: "Quote text (quote template)" },
          quote_author: { type: "string", description: "Quote author (quote template)" },
          cta: { type: "string", description: "CTA text on bottom bar" },
          save_path: { type: "string" },
          upload_to_linkedin: { type: "boolean" },
          alt_text: { type: "string" },
        },
      },
    },
    // Carousel Generation
    {
      name: "linkedin_carousel_generate",
      description: "Generate a LinkedIn carousel (multi-slide PDF). Carousels get 303% more engagement than single images. Each slide uses the banner template system (1080×1080 square). Output: PDF file ready for upload as LinkedIn document.",
      inputSchema: {
        type: "object",
        properties: {
          slides: {
            type: "array",
            description: "Array of slides, each using a template",
            items: {
              type: "object",
              properties: {
                template: { type: "string", enum: ["hero", "split", "numbers", "vs", "infographic", "quote"] },
                gradient: { type: "string" },
                headline: { type: "string" },
                subline: { type: "string" },
                stat: { type: "string" },
                stat_label: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                numbers: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" } } } },
                before: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } } },
                after: { type: "object", properties: { title: { type: "string" }, items: { type: "array", items: { type: "string" } } } },
                data_points: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "number" } } } },
                quote: { type: "string" },
                quote_author: { type: "string" },
                cta: { type: "string" },
              },
              required: ["template"],
            },
          },
          gradient: { type: "string", description: "Default gradient for all slides" },
          save_path: { type: "string" },
          upload_to_linkedin: { type: "boolean" },
        },
        required: ["slides"],
      },
    },
    // Screenshot Capture
    {
      name: "linkedin_screenshot_capture",
      description: "Capture a screenshot of any web page. Useful for creating visual content from GitHub repos, dashboards, or project pages. Returns PNG image path. Can auto-upload to LinkedIn.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to screenshot" },
          width: { type: "number", description: "Viewport width (default: 1280)" },
          height: { type: "number", description: "Viewport height (default: 800)" },
          selector: { type: "string", description: "CSS selector to capture specific element" },
          full_page: { type: "boolean", description: "Capture full page (default: false)" },
          save_path: { type: "string" },
          upload_to_linkedin: { type: "boolean" },
        },
        required: ["url"],
      },
    },
    // Case Study
    {
      name: "linkedin_casestudy_generate",
      description: "Generate a professional case study PDF with branding, screenshots, metrics, and optional AI cover image. Outputs: branded PDF (A4), LinkedIn banner, and cover image. Perfect for showcasing projects on LinkedIn.",
      inputSchema: {
        type: "object",
        properties: {
          project_name: { type: "string", description: "Name of the project" },
          project_url: { type: "string", description: "GitHub/website URL (also used for screenshots)" },
          problem: { type: "string", description: "What problem does it solve" },
          solution: { type: "string", description: "How it solves the problem" },
          metrics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"] }, description: "Key results/metrics" },
          screenshots: { type: "array", items: { type: "string" }, description: "URLs to screenshot for the PDF" },
          tech_stack: { type: "array", items: { type: "string" }, description: "Technologies used" },
          brand: { type: "string", enum: ["bartoszgaca", "beecommerce", "neutral"], description: "Brand profile (default: bartoszgaca)" },
          generate_cover: { type: "boolean", description: "Generate AI cover image with Gemini (default: true)" },
          generate_banner: { type: "boolean", description: "Generate LinkedIn banner (default: true)" },
          language: { type: "string", enum: ["pl", "en"], description: "Language (default: en)" },
          save_path: { type: "string", description: "Custom save path for PDF" },
        },
        required: ["project_name", "problem", "solution"],
      },
    },
    // AI Classification & Reply (Gemini-powered)
    {
      name: "linkedin_comment_classify",
      description: "Classify a LinkedIn comment using Gemini AI. Returns decision (reply/like_only/skip_troll/skip_spam) and sentiment (positive/negative/neutral/question). Used by auto-engage daemon.",
      inputSchema: {
        type: "object",
        properties: {
          comment_text: { type: "string", description: "The comment text to classify" },
          post_text: { type: "string", description: "The original post text (first 400 chars)" },
          comment_author: { type: "string", description: "Comment author name" },
        },
        required: ["comment_text", "post_text"],
      },
    },
    {
      name: "linkedin_comment_reply_generate",
      description: "Generate an intelligent reply to a LinkedIn comment using Gemini AI with persona, socjotechnika, and context-awareness. Used by auto-engage daemon.",
      inputSchema: {
        type: "object",
        properties: {
          comment_text: { type: "string", description: "The comment to reply to" },
          post_text: { type: "string", description: "Original post text for context" },
          language: { type: "string", enum: ["pl", "en"], description: "Reply language" },
          sentiment: { type: "string", enum: ["positive", "negative", "neutral", "question"], description: "Comment sentiment" },
          project_name: { type: "string", description: "Project name" },
          project_repo: { type: "string", description: "GitHub repo URL" },
          persona_profile: { type: "string", description: "Author persona profile" },
          persona_work_style: { type: "string", description: "Author work style" },
          thread_context: { type: "string", description: "Previous replies in thread" },
        },
        required: ["comment_text", "post_text", "language", "sentiment"],
      },
    },
    // Scheduling
    {
      name: "linkedin_schedule_create",
      description: "Schedule a LinkedIn post for future publication. Optimal times: Tue-Thu at 8:00, 9:30, or 17:00. Min 12h gap between posts, max 1/day. The daemon auto-publishes and supports Gemini image generation or professional banner generation at publish time.",
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
          gemini_prompt: { type: "string", description: "Generate AI image at publish time with this prompt" },
          gemini_aspect_ratio: { type: "string", description: "Aspect ratio for Gemini image" },
          banner_preset: { type: "string", description: "Generate professional banner at publish time using preset (post5-post17)" },
          banner_config: { type: "string", description: "JSON config for custom banner generation at publish time" },
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
      name: "linkedin_guidelines",
      description: "Get LinkedIn algorithm strategy guidelines — ranking factors, copywriting rules, hooks, CTAs, posting checklist, dos & donts, optimal timing, format tips. Use before creating posts to follow best practices and maximize reach.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: ["all", "algorithm", "copywriting", "formats", "timing", "hooks", "ctas", "checklist", "dos_donts", "links", "ab_testing"],
            description: "Topic to get guidelines for (default: all)",
          },
        },
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

    // ── Scraper & Monitoring Tools ─────────────────────────────────────
    {
      name: "linkedin_scraper_auth",
      description: "Set LinkedIn research authentication. Requires li_at cookie from YOUR browser (your own account, no fake accounts). Uses LinkedIn's internal API for sales research — technically against LinkedIn ToS but protected by hiQ v. LinkedIn ruling for public data. Conservative rate limits (30/hr, 150/day). You acknowledge the risk to your account by using this.",
      inputSchema: {
        type: "object",
        properties: {
          li_at: { type: "string", description: "Your LinkedIn li_at session cookie" },
        },
        required: ["li_at"],
      },
    },
    {
      name: "linkedin_search_people",
      description: "Search LinkedIn for people by keywords, job title, company, and location. Uses LinkedIn's internal search API. Requires scraper auth (li_at cookie). Rate-limited for safety.",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "string", description: "Search keywords (e.g., 'e-commerce manager')" },
          title: { type: "string", description: "Job title filter" },
          company_id: { type: "string", description: "LinkedIn company ID or universal name" },
          location: { type: "string", description: "Location: 'poland', 'warsaw', 'europe', etc." },
          count: { type: "number", description: "Results per page (default: 10, max: 25)" },
          start: { type: "number", description: "Pagination offset" },
        },
      },
    },
    {
      name: "linkedin_search_companies",
      description: "Search for companies on LinkedIn by name or keywords. Returns company name, ID, description, and URL.",
      inputSchema: {
        type: "object",
        properties: {
          keywords: { type: "string", description: "Company name or keywords" },
          count: { type: "number", description: "Results (default: 10, max: 25)" },
          start: { type: "number" },
        },
        required: ["keywords"],
      },
    },
    {
      name: "linkedin_company_people",
      description: "List people at a specific company. Optionally filter by role keywords (e.g., 'sales', 'growth', 'business development'). Great for finding competitor salespeople.",
      inputSchema: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company URL (linkedin.com/company/...) or company ID" },
          role_keywords: { type: "string", description: "Filter by role (e.g., 'sales growth business development')" },
          count: { type: "number", description: "Results (default: 10)" },
          start: { type: "number" },
        },
        required: ["company"],
      },
    },
    {
      name: "linkedin_person_activity",
      description: "Get a person's recent LinkedIn activity — posts, comments, shares. Critical for monitoring competitor salespeople (their COMMENTS reveal RFPs) and target buyers (their POSTS reveal buying intent).",
      inputSchema: {
        type: "object",
        properties: {
          profile: { type: "string", description: "Profile URL (linkedin.com/in/...) or public ID" },
          type: { type: "string", enum: ["posts", "comments", "all"], description: "Activity type (default: all)" },
          count: { type: "number", description: "Number of activities (default: 10, max: 20)" },
          start: { type: "number" },
        },
        required: ["profile"],
      },
    },
    {
      name: "linkedin_intent_classify",
      description: "AI-powered classification of LinkedIn activity text. Categories: sales_pitch (competitor offering services), buying_signal (potential client seeking vendor), job_posting (hiring = growth signal), networking, irrelevant. Uses keyword matching + Gemini AI.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post or comment text to classify" },
          person_name: { type: "string" },
          person_headline: { type: "string" },
          activity_type: { type: "string", enum: ["post", "comment"] },
          original_post: { type: "string", description: "Original post text (if classifying a comment)" },
        },
        required: ["text"],
      },
    },
    {
      name: "linkedin_prospect_save",
      description: "Save a person to the prospect monitoring database. Categories: competitor_sales (monitor their comments for RFPs), target_buyer (monitor their posts for buying intent), influencer, other.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          public_id: { type: "string", description: "LinkedIn public ID (from URL)" },
          headline: { type: "string" },
          profile_url: { type: "string" },
          company_name: { type: "string" },
          category: { type: "string", enum: ["competitor_sales", "target_buyer", "influencer", "other"] },
          tags: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          source_company_id: { type: "string" },
        },
        required: ["name", "public_id"],
      },
    },
    {
      name: "linkedin_prospect_list",
      description: "List saved prospects with optional filters. Shows all monitored people from the prospect database.",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["competitor_sales", "target_buyer", "influencer", "other"] },
          source_company_id: { type: "string" },
          has_new_activity: { type: "boolean", description: "Only show prospects with unreviewed activities" },
        },
      },
    },
    {
      name: "linkedin_company_save",
      description: "Add a company to the monitoring list. Types: direct_competitor, indirect_competitor, target_segment, other.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Company display name" },
          company: { type: "string", description: "Company LinkedIn URL or ID" },
          type: { type: "string", enum: ["direct_competitor", "indirect_competitor", "target_segment", "other"] },
          notes: { type: "string" },
        },
        required: ["name", "company"],
      },
    },
    {
      name: "linkedin_company_list",
      description: "List all monitored companies.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["direct_competitor", "indirect_competitor", "target_segment", "other"] },
        },
      },
    },
    {
      name: "linkedin_prospect_scan",
      description: "Scan prospects for new activity. Fetches latest posts/comments from LinkedIn and optionally classifies them with AI. Can scan all prospects or a specific one. Rate-limited.",
      inputSchema: {
        type: "object",
        properties: {
          prospect_id: { type: "string", description: "Scan specific prospect (public_id). Omit to scan all." },
          category: { type: "string", enum: ["competitor_sales", "target_buyer", "influencer", "other"], description: "Filter which category to scan" },
          classify: { type: "boolean", description: "Run AI classification (default: true)" },
        },
      },
    },
    {
      name: "linkedin_activities_feed",
      description: "Get classified activities feed — new RFPs, buying signals, sales pitches detected by the monitoring system. Filter by classification type. Mark as reviewed.",
      inputSchema: {
        type: "object",
        properties: {
          classification: { type: "string", enum: ["sales_pitch", "buying_signal", "job_posting", "networking", "irrelevant"] },
          prospect_id: { type: "string" },
          limit: { type: "number", description: "Max results (default: 50)" },
          mark_reviewed: { type: "boolean", description: "Mark returned items as reviewed (default: false)" },
        },
      },
    },
    {
      name: "linkedin_monitor_stats",
      description: "Get monitoring system statistics — total prospects, companies, activities, classification breakdown.",
      inputSchema: { type: "object", properties: {} },
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
          media_category: input.media_category,
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

      // ── Banner Generation ─────────────────────────────────────────────
      case "linkedin_banner_generate": {
        const input = BannerGenerateInput.parse(args);

        // If no preset and no headline, list available options
        if (!input.preset && !input.headline && !input.quote && !input.data_points) {
          return toolResult({
            presets: listPresets(),
            templates: ["hero", "split", "numbers", "vs", "infographic", "quote"],
            gradients: Object.keys(GRADIENTS),
            usage: "Provide a 'preset' name OR 'template' + params for a custom banner.",
          });
        }

        const bannerResult = await generateBanner({
          preset: input.preset,
          template: input.template,
          gradient: input.gradient,
          headline: input.headline,
          subline: input.subline,
          stat: input.stat,
          stat_label: input.stat_label,
          bullets: input.bullets,
          numbers: input.numbers,
          before: input.before,
          after: input.after,
          data_points: input.data_points,
          quote: input.quote,
          quote_author: input.quote_author,
          cta: input.cta,
          save_path: input.save_path,
        });

        let mediaUrn: string | undefined;
        if (input.upload_to_linkedin) {
          const uploadResult = await uploadMedia({
            file_path: bannerResult.file_path,
            media_type: "IMAGE",
            alt_text: input.alt_text,
          });
          mediaUrn = uploadResult.media_urn;
        }

        return toolResult({
          ...bannerResult,
          media_urn: mediaUrn,
        });
      }

      case "linkedin_carousel_generate": {
        const input = CarouselGenerateInput.parse(args);
        const carouselResult = await generateCarousel({
          slides: input.slides,
          gradient: input.gradient,
          save_path: input.save_path,
        });

        let mediaUrn: string | undefined;
        if (input.upload_to_linkedin) {
          const uploadResult = await uploadMedia({
            file_path: carouselResult.file_path,
            media_type: "IMAGE",
          });
          mediaUrn = uploadResult.media_urn;
        }

        return toolResult({ ...carouselResult, media_urn: mediaUrn });
      }

      case "linkedin_screenshot_capture": {
        const input = ScreenshotInput.parse(args);
        const screenshotResult = await captureScreenshot({
          url: input.url,
          width: input.width,
          height: input.height,
          selector: input.selector,
          full_page: input.full_page,
          save_path: input.save_path,
        });

        let mediaUrn: string | undefined;
        if (input.upload_to_linkedin) {
          const uploadResult = await uploadMedia({
            file_path: screenshotResult.file_path,
            media_type: "IMAGE",
          });
          mediaUrn = uploadResult.media_urn;
        }

        return toolResult({ ...screenshotResult, media_urn: mediaUrn });
      }

      case "linkedin_casestudy_generate": {
        const input = CaseStudyInput.parse(args);
        const csResult = await generateCaseStudy({
          project_name: input.project_name,
          project_url: input.project_url,
          problem: input.problem,
          solution: input.solution,
          metrics: input.metrics,
          screenshots: input.screenshots,
          tech_stack: input.tech_stack,
          brand: input.brand,
          generate_cover: input.generate_cover,
          generate_banner: input.generate_banner,
          language: input.language,
          save_path: input.save_path,
        });
        return toolResult(csResult);
      }

      // ── AI Classification & Reply (Gemini) ──────────────────────────
      case "linkedin_comment_classify": {
        const input = CommentClassifyInput.parse(args);

        // Fast-path: emoji-only
        if (/^[\p{Emoji}\p{Emoji_Presentation}\s\u200d\ufe0f]+$/u.test(input.comment_text) && input.comment_text.length < 30) {
          return toolResult({ decision: "skip_emoji", sentiment: "positive" });
        }
        // Fast-path: very short
        if (input.comment_text.trim().length < 6) {
          return toolResult({ decision: "like_only", sentiment: "neutral" });
        }

        const classifySystem = `You classify LinkedIn comments. Return ONLY valid JSON.

Categories:
- "reply" — genuine comment deserving a personal reply (questions, thoughtful feedback, experience sharing, constructive criticism)
- "like_only" — positive but generic ("Great post!", "Thanks!", single word praise) — just like, don't reply
- "skip_troll" — hostile, trolling, bad-faith, personal attacks — ignore
- "skip_spam" — promotional spam, irrelevant self-promotion, link drops — ignore

Sentiment: "positive" | "negative" | "neutral" | "question"

Bias toward "reply" for questions and substantive comments. Bias toward "like_only" for short generic praise.

Return: {"decision":"...","sentiment":"..."}`;

        try {
          const raw = await generateText({
            system: classifySystem,
            prompt: `Post (first 400 chars): "${input.post_text.substring(0, 400)}"\n\nComment by ${input.comment_author || "someone"}: "${input.comment_text}"`,
            maxTokens: 100,
          });
          const jsonMatch = raw.match(/\{[^}]+\}/);
          const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { decision: "like_only", sentiment: "neutral" };
          return toolResult(result);
        } catch (err) {
          log("warn", `Comment classify failed: ${(err as Error).message}`);
          return toolResult({ decision: "like_only", sentiment: "neutral" });
        }
      }

      case "linkedin_comment_reply_generate": {
        const input = CommentReplyInput.parse(args);

        const replySystem = `You are ghostwriting LinkedIn comment replies as Bartosz Gaca. Your replies must sound EXACTLY like him — not like a bot, not like corporate LinkedIn.

${input.persona_profile ? `## WHO YOU ARE:\n${input.persona_profile.substring(0, 1200)}` : "## WHO YOU ARE:\nBartosz Gaca — Fractional Head of Automation. AI-first, action-oriented, direct, low formality."}

${input.persona_work_style ? `## HOW YOU COMMUNICATE:\n${input.persona_work_style.substring(0, 1200)}` : "## STYLE:\nShort messages, zero preamble. No corporate BS. Typical: 'daj znać', 'sprawdź repo'."}

## REPLY LANGUAGE: ${input.language === "pl" ? "Polish (use Polish characters: ą, ć, ę, ł, ń, ó, ś, ź, ż)" : "English"}

## REPLY RULES:
- MAX 1-3 sentences. Short. Direct. Like a real human reply.
- If question → answer directly, link to repo if relevant
- If compliment → don't just say thanks, add a nugget of value
- If criticism → be open, factual, "konstruktywna krytyka mile widziana"
- If hate/troll → brief ironic dismissal, never defensive

## SOCJOTECHNIKA (use naturally):
- Reciprocity: share something useful before asking anything
- Social proof: casually mention stats or results when relevant
- Authority: reference real experience ("I built this because...")
- Commitment: ask a small question ("have you tried X?")

## FORBIDDEN:
- "Great question!", "Thanks for your valuable insight!", "Appreciate your engagement"
- Hashtags in replies, more than 1 emoji, sycophantic LinkedIn-speak

## CONTEXT:
- Project: ${input.project_name || "LinkedIn MCP Server"} (${input.project_repo || "https://github.com/gacabartosz/linkedin-mcp-server"})
- Post about: ${input.post_text.substring(0, 600)}
${input.thread_context ? `\n## THREAD:\n${input.thread_context}` : ""}

## SENTIMENT: ${input.sentiment}
${input.sentiment === "question" ? "Be helpful, direct, give a real answer." : ""}
${input.sentiment === "positive" ? "Brief acknowledgment + add value." : ""}
${input.sentiment === "negative" ? "Stay calm, factual, brief." : ""}
${input.sentiment === "neutral" ? "Engage if substance, invite discussion." : ""}`;

        try {
          let reply = await generateText({
            system: replySystem,
            prompt: `Comment to reply to:\n"${input.comment_text}"\n\nGenerate ONE reply. No quotes, no prefix, just the reply text.`,
            maxTokens: 250,
          });
          reply = reply.replace(/^["']|["']$/g, "").replace(/^Reply:\s*/i, "");
          return toolResult({ reply });
        } catch (err) {
          const fallback = input.language === "pl"
            ? "Dzięki za komentarz! Daj znać jeśli masz pytania."
            : "Thanks! Let me know if you have questions.";
          log("warn", `Reply generation failed: ${(err as Error).message}`);
          return toolResult({ reply: fallback });
        }
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
      case "linkedin_guidelines": {
        const input = GuidelinesInput.parse(args);
        const guidelines = loadGuidelines(input.topic);
        return toolResult(guidelines);
      }
      case "linkedin_template_save": {
        const input = TemplateSaveInput.parse(args);
        const result = saveTemplate(input);
        return toolResult(result);
      }

      // ── Scraper & Monitoring ────────────────────────────────────────
      case "linkedin_scraper_auth": {
        const input = ScraperAuthInput.parse(args);
        saveScraperAuth({ li_at: input.li_at, tos_acknowledged: true });
        return toolResult({
          authenticated: true,
          disclaimer: COMPLIANCE_DISCLAIMER,
          message: "Scraper auth saved. ToS risk acknowledged. You can now use search, company, and activity tools.",
          safety: {
            max_requests_per_hour: 30,
            max_requests_per_day: 150,
            delay_between_requests: "3-7 seconds (randomized)",
            backoff_on_429: "exponential (60s, 120s, 240s...)",
          },
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_search_people": {
        const input = SearchPeopleInput.parse(args);
        const result = await searchPeople({
          keywords: input.keywords,
          title: input.title,
          company_id: input.company_id,
          location: input.location,
          count: input.count,
          start: input.start,
        });
        return toolResult({
          ...result,
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_search_companies": {
        const input = SearchCompaniesInput.parse(args);
        const result = await searchCompanies({
          keywords: input.keywords,
          count: input.count,
          start: input.start,
        });
        return toolResult({
          ...result,
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_company_people": {
        const input = CompanyPeopleInput.parse(args);
        const companyId = extractCompanyId(input.company);
        const result = await getCompanyPeople({
          company_id: companyId,
          role_keywords: input.role_keywords,
          count: input.count,
          start: input.start,
        });
        return toolResult({
          ...result,
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_person_activity": {
        const input = PersonActivityInput.parse(args);
        const publicId = extractPublicId(input.profile);
        const actType = input.type || "all";

        let result;
        if (actType === "comments") {
          result = await getPersonComments({ public_id: publicId, count: input.count, start: input.start });
        } else if (actType === "posts") {
          result = await getPersonPosts({ public_id: publicId, count: input.count, start: input.start });
        } else {
          result = await getPersonPosts({ public_id: publicId, count: input.count, start: input.start });
        }

        return toolResult({
          profile: publicId,
          activity_type: actType,
          ...result,
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_intent_classify": {
        const input = IntentClassifyInput.parse(args);
        const result = await classifyIntent(input.text, {
          person_name: input.person_name,
          person_headline: input.person_headline,
          activity_type: input.activity_type,
          original_post: input.original_post,
        });
        return toolResult(result);
      }

      case "linkedin_prospect_save": {
        const input = ProspectSaveInput.parse(args);
        const prospect = addProspect({
          name: input.name,
          public_id: input.public_id,
          headline: input.headline,
          profile_url: input.profile_url,
          company_name: input.company_name,
          category: input.category,
          tags: input.tags,
          notes: input.notes,
          source_company_id: input.source_company_id,
        });
        return toolResult({ saved: true, prospect });
      }

      case "linkedin_prospect_list": {
        const input = ProspectListInput.parse(args);
        const prospects = listProspects({
          category: input.category,
          source_company_id: input.source_company_id,
          has_new_activity: input.has_new_activity,
        });
        return toolResult({ prospects, total: prospects.length });
      }

      case "linkedin_company_save": {
        const input = CompanySaveInput.parse(args);
        const companyId = extractCompanyId(input.company);
        const company = addCompany({
          name: input.name,
          company_id: companyId,
          company_url: input.company.includes("linkedin.com") ? input.company : `https://www.linkedin.com/company/${companyId}`,
          type: input.type,
          notes: input.notes,
        });
        return toolResult({ saved: true, company });
      }

      case "linkedin_company_list": {
        const typeFilter = (args as Record<string, unknown>).type as string | undefined;
        const companies = listCompanies(typeFilter);
        return toolResult({ companies, total: companies.length });
      }

      case "linkedin_prospect_scan": {
        const input = ProspectScanInput.parse(args);
        const shouldClassify = input.classify !== false;

        // Get prospects to scan
        let prospects;
        if (input.prospect_id) {
          const p = getProspect(input.prospect_id);
          prospects = p ? [p] : [];
        } else {
          prospects = listProspects({ category: input.category });
        }

        if (prospects.length === 0) {
          return toolResult({ message: "No prospects to scan.", scanned: 0 });
        }

        const scanResults: Array<{
          prospect_name: string;
          public_id: string;
          new_activities: number;
          actionable: number;
        }> = [];

        for (const prospect of prospects) {
          try {
            // Fetch based on category
            const isSales = prospect.category === "competitor_sales";
            const activityResult = isSales
              ? await getPersonComments({ public_id: prospect.public_id, count: 10 })
              : await getPersonPosts({ public_id: prospect.public_id, count: 10 });

            let newCount = 0;
            let actionableCount = 0;

            for (const activity of activityResult.activities) {
              if (!activity.text) continue;

              let classification = "irrelevant";
              let confidence = 0;
              let reasoning = "";

              if (shouldClassify) {
                const classResult = await classifyIntent(activity.text, {
                  person_name: prospect.name,
                  person_headline: prospect.headline,
                  activity_type: activity.type,
                  original_post: activity.original_post_text,
                });
                classification = classResult.classification;
                confidence = classResult.confidence;
                reasoning = classResult.reasoning;
                if (classResult.is_actionable) actionableCount++;
              }

              addActivity({
                prospect_id: prospect.id,
                type: activity.type,
                text: activity.text,
                post_url: activity.post_url,
                post_urn: activity.post_urn || "",
                date: activity.date,
                classification,
                confidence,
                reasoning,
              });
              newCount++;
            }

            updateProspectScanTime(prospect.public_id);

            scanResults.push({
              prospect_name: prospect.name,
              public_id: prospect.public_id,
              new_activities: newCount,
              actionable: actionableCount,
            });
          } catch (err) {
            log("warn", `Failed to scan ${prospect.name}: ${(err as Error).message}`);
            scanResults.push({
              prospect_name: prospect.name,
              public_id: prospect.public_id,
              new_activities: 0,
              actionable: 0,
            });
          }
        }

        const totalNew = scanResults.reduce((s, r) => s + r.new_activities, 0);
        const totalActionable = scanResults.reduce((s, r) => s + r.actionable, 0);

        return toolResult({
          scanned: scanResults.length,
          total_new_activities: totalNew,
          total_actionable: totalActionable,
          results: scanResults,
          rate_limit: getRateLimitStats(),
        });
      }

      case "linkedin_activities_feed": {
        const input = ActivitiesListInput.parse(args);
        const activities = getNewActivities({
          classification: input.classification,
          prospect_id: input.prospect_id,
          limit: input.limit,
        });

        // Enrich with prospect info
        const enriched = activities.map((a) => {
          const prospect = getProspect(a.prospect_id);
          return {
            ...a,
            prospect_name: prospect?.name,
            prospect_headline: prospect?.headline,
            prospect_category: prospect?.category,
            prospect_company: prospect?.company_name,
          };
        });

        if (input.mark_reviewed && activities.length > 0) {
          markActivitiesReviewed(activities.map((a) => a.id));
        }

        return toolResult({
          activities: enriched,
          total: enriched.length,
          unreviewed_remaining: input.mark_reviewed
            ? getNewActivities({}).length
            : undefined,
        });
      }

      case "linkedin_monitor_stats": {
        const stats = getStats();
        const scraperAuth = loadScraperAuth();
        return toolResult({
          ...stats,
          scraper_authenticated: !!scraperAuth?.li_at,
          scraper_auth_updated: scraperAuth?.updated_at,
          rate_limit: getRateLimitStats(),
        });
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
