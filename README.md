# linkedin-mcp-server

A full-featured LinkedIn MCP server for Claude. Post content, schedule publications, generate AI images, manage comments and reactions — all from your AI assistant.

[![npm version](https://badge.fury.io/js/linkedin-mcp-server.svg)](https://www.npmjs.com/package/linkedin-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What It Does

Connect your LinkedIn account to Claude and manage your professional presence with natural language:

> "Schedule a thought leadership post about AI automation for Monday 9am with a Gemini-generated banner image"

> "Reply to the latest comments on my posts"

> "Create a case study post about our MCP server launch using the case-study template"

### 25 MCP Tools

**Post Management** — Create, edit, delete, repost, read your posts
**Scheduling** — Schedule posts for future publication with automatic background publishing
**Media** — Upload images and videos from local files or URLs
**AI Images** — Generate images with Google Gemini Imagen 4 and post them directly
**Comments & Reactions** — Comment, reply, react (LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY)
**Content Templates** — 12 built-in templates (Thought Leadership, Case Study, Viral Trend, Lead Magnet, and more) plus custom ones
**Brand Voice** — Configure tone, emoji style, hashtag strategy, post structure, and LinkedIn algorithm settings
**Algorithm Guidelines** — Built-in LinkedIn algorithm knowledge: ranking factors, copywriting rules, hooks, CTAs, timing, checklist

## Quick Start

### 1. Create a LinkedIn App

1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Create a new app
3. Under **Products**, enable:
   - "Share on LinkedIn"
   - "Sign In with LinkedIn using OpenID Connect"
4. Under **Auth**, add redirect URL: `http://localhost:8585/callback`
5. Note your **Client ID** and **Client Secret**

### 2. Configure for Claude Code

```bash
claude mcp add --scope user linkedin npx -- -y linkedin-mcp-server \
  -e LINKEDIN_CLIENT_ID=your_client_id \
  -e LINKEDIN_CLIENT_SECRET=your_client_secret \
  -e GEMINI_API_KEY=your_gemini_key
```

### 3. Configure for Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "linkedin": {
      "command": "npx",
      "args": ["-y", "linkedin-mcp-server"],
      "env": {
        "LINKEDIN_CLIENT_ID": "your_client_id",
        "LINKEDIN_CLIENT_SECRET": "your_client_secret",
        "GEMINI_API_KEY": "your_gemini_key"
      }
    }
  }
}
```

### 4. Authenticate

Ask Claude:
> "Connect my LinkedIn account"

Claude will generate an authorization URL. Open it in your browser, approve access, and tokens are saved automatically (valid for 60 days with auto-refresh).

### 5. Start Posting!

> "Post on LinkedIn: Just shipped a LinkedIn MCP server with 24 tools. The future of AI-powered content management is here. #MCP #AI #LinkedIn"

## Tools Reference

| Tool | Description |
|------|-------------|
| `linkedin_auth_start` | Start OAuth 2.0 authorization flow |
| `linkedin_auth_status` | Check auth status and token expiry |
| `linkedin_profile_me` | Get your profile info and person URN |
| `linkedin_brand_voice` | Get/set brand voice preferences |
| `linkedin_post_create` | Create a post (text, image, video, article) |
| `linkedin_post_update` | Edit an existing post |
| `linkedin_post_delete` | Delete a post |
| `linkedin_post_repost` | Reshare with optional commentary |
| `linkedin_post_get` | Get post details |
| `linkedin_posts_list` | List your recent posts |
| `linkedin_comment_create` | Add a comment or reply |
| `linkedin_comments_list` | List post comments |
| `linkedin_comment_delete` | Delete your comment |
| `linkedin_reaction_add` | React to a post or comment |
| `linkedin_reaction_remove` | Remove your reaction |
| `linkedin_media_upload` | Upload image/video from file or URL |
| `linkedin_gemini_image` | Generate AI image with Gemini Imagen 4 |
| `linkedin_schedule_create` | Schedule a post for future publication |
| `linkedin_schedule_list` | View all scheduled posts |
| `linkedin_schedule_update` | Modify a scheduled post |
| `linkedin_schedule_cancel` | Cancel a scheduled post |
| `linkedin_template_list` | Browse content templates |
| `linkedin_template_get` | View template details and variables |
| `linkedin_template_save` | Create or update a custom template |
| `linkedin_guidelines` | LinkedIn algorithm strategy and best practices |

## Post Scheduling

The server includes a built-in scheduler that runs alongside the MCP server:

1. Schedule a post with a target datetime (ISO 8601)
2. Background daemon checks every 30 seconds for due posts
3. Posts are published automatically at the scheduled time
4. Failed posts retry up to 3 times with 5-minute intervals
5. On startup, overdue posts (up to 24h) are caught up automatically

You can also run the scheduler as a standalone daemon:

```bash
npx linkedin-mcp-server --scheduler
```

## AI Image Generation

Generate images with Google Gemini Imagen 4 and post them directly to LinkedIn.

Get a free API key at [Google AI Studio](https://aistudio.google.com) and set `GEMINI_API_KEY`.

Scheduled posts can auto-generate images at publish time using the `gemini_prompt` parameter — the image is created fresh right before publishing.

## Content Templates

12 built-in templates for consistent, high-quality posts:

| Template | Structure |
|----------|-----------|
| Thought Leadership | Hook → Insights → CTA |
| Thought Leadership (PL) | Hook → Kontekst → Insighty → CTA |
| Case Study | Problem → Solution → Results |
| Announcement | Headline → Details → Features → CTA |
| Engagement Hook | Question → Context → Options |
| Behind the Scenes | Intro → Story → Lesson |
| Lesson Learned | Confession → Mistake → Lesson → Advice |
| Carousel Text | Title → Slides → CTA |
| Carousel Edu | Hook → Steps → Summary → CTA |
| Viral Trend | Hook → Trend → Stat → Your Take → CTA |
| Community Question | Hook → Context → Question → CTA |
| Lead Magnet | Hook → Problem → What You Get → CTA |

Create your own templates with `{{variable}}` syntax using `linkedin_template_save`.

## Manual Token Mode

If you already have a LinkedIn access token (e.g., from n8n or another tool):

```json
{
  "env": {
    "LINKEDIN_ACCESS_TOKEN": "AQVxxx...",
    "LINKEDIN_PERSON_URN": "urn:li:person:your_id"
  }
}
```

This skips OAuth entirely. Useful for CI/CD or existing integrations.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINKEDIN_CLIENT_ID` | Yes* | LinkedIn app Client ID |
| `LINKEDIN_CLIENT_SECRET` | Yes* | LinkedIn app Client Secret |
| `LINKEDIN_ACCESS_TOKEN` | Alt* | Manual token (skips OAuth) |
| `LINKEDIN_PERSON_URN` | With manual | `urn:li:person:xxx` |
| `GEMINI_API_KEY` | No | For AI image generation |
| `LINKEDIN_CALLBACK_PORT` | No | OAuth port (default: 8585) |
| `LINKEDIN_DATA_DIR` | No | Data dir (default: ~/.linkedin-mcp) |
| `LINKEDIN_API_VERSION` | No | API version (default: 202503) |

\*Either Client ID + Secret OR Access Token is required.

## Development

```bash
git clone https://github.com/gacabartosz/linkedin-mcp-server.git
cd linkedin-mcp-server
npm install
npm run dev   # Run with tsx (hot reload)
npm run build # Compile TypeScript
```

## Built With

This project was built using the [Model Context Protocol](https://modelcontextprotocol.io/) and follows patterns from the [Anthropic MCP Builder Skill](https://github.com/anthropics/skills/tree/main/skills/mcp-builder).

Architecture and code patterns were informed by studying existing LinkedIn MCP projects — thanks to the community for the inspiration:
- [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server) — great work on LinkedIn profile scraping and the Patchright-based session approach
- [rugvedp/linkedin-mcp](https://github.com/rugvedp/linkedin-mcp) — useful reference for post data structures
- [felipfr/linkedin-mcpserver](https://github.com/felipfr/linkedin-mcpserver) — TypeScript MCP patterns and OAuth architecture ideas

Development was accelerated by [Ralph](https://github.com/frankbria/ralph-claude-code) — an autonomous AI dev loop that runs Claude Code in iterative cycles for automated implementation, testing, and code polish.

## Author

**Bartosz Gaca** — [bartoszgaca.pl](https://bartoszgaca.pl) — [kontakt@bartoszgaca.pl](mailto:kontakt@bartoszgaca.pl)

## License

MIT
