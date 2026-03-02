# linkedin-mcp-server

The most complete LinkedIn MCP server. Create posts, schedule content, generate AI images, manage comments.

**The only LinkedIn MCP with write operations.**

[![npm version](https://badge.fury.io/js/linkedin-mcp-server.svg)](https://www.npmjs.com/package/linkedin-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why This Exists

Every existing LinkedIn MCP server is **read-only**. None of them can post, comment, schedule, or upload media. This one can.

| Feature | linkedin-mcp-server | stickerdaniel | rugvedp | felipfr |
|---------|:------------------:|:-------------:|:-------:|:-------:|
| Create posts | **Yes** | No | No | No |
| Schedule posts | **Yes** | No | No | No |
| Upload images/video | **Yes** | No | No | No |
| AI image generation | **Yes** | No | No | No |
| Comments & reactions | **Yes** | No | No | No |
| Content templates | **Yes** | No | No | No |
| Brand voice config | **Yes** | No | No | No |
| Read profiles | Planned | Yes | No | Yes |
| Search jobs | Planned | Yes | No | Yes |

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

Once connected, ask Claude:
> "Connect my LinkedIn account"

Claude will use `linkedin_auth_start` to generate an authorization URL. Open it in your browser, approve, and tokens are saved automatically.

### 5. Start Posting!

> "Post on LinkedIn: Just shipped the world's first LinkedIn MCP server with write operations. The future of AI-powered social media management is here. #MCP #AI #LinkedIn"

## Features

### 24 MCP Tools

#### Authentication
- `linkedin_auth_start` — Start OAuth 2.0 flow
- `linkedin_auth_status` — Check auth status and token expiry

#### Post Management
- `linkedin_post_create` — Create text, image, video, or article posts
- `linkedin_post_update` — Edit existing posts
- `linkedin_post_delete` — Delete posts
- `linkedin_post_repost` — Reshare with optional commentary
- `linkedin_post_get` — Get post details
- `linkedin_posts_list` — List your recent posts

#### Comments & Reactions
- `linkedin_comment_create` — Comment or reply to comments
- `linkedin_comments_list` — List post comments
- `linkedin_comment_delete` — Delete your comments
- `linkedin_reaction_add` — React (LIKE, CELEBRATE, SUPPORT, LOVE, INSIGHTFUL, FUNNY)
- `linkedin_reaction_remove` — Remove reaction

#### Media
- `linkedin_media_upload` — Upload images/videos from files or URLs
- `linkedin_gemini_image` — Generate AI images with Google Gemini Imagen 4

#### Scheduling
- `linkedin_schedule_create` — Schedule posts for future publication
- `linkedin_schedule_list` — View scheduled posts
- `linkedin_schedule_update` — Modify scheduled posts
- `linkedin_schedule_cancel` — Cancel scheduled posts

#### Content Templates
- `linkedin_template_list` — Browse built-in and custom templates
- `linkedin_template_get` — View template details
- `linkedin_template_save` — Create custom templates

#### Profile & Brand
- `linkedin_profile_me` — Get your profile info
- `linkedin_brand_voice` — Configure tone, emoji, hashtag preferences

## Post Scheduling

LinkedIn has no native scheduling API. This server implements its own scheduler:

1. When you schedule a post, it's stored in a local SQLite database
2. A background daemon checks every 30 seconds for due posts
3. Posts are published automatically at the scheduled time
4. Failed posts retry up to 3 times with 5-minute intervals
5. On startup, overdue posts (up to 24h) are published immediately

### Standalone Scheduler

Run the scheduler independently (e.g., as a system service):

```bash
npx linkedin-mcp-server --scheduler
```

### macOS launchd

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.linkedin-mcp.scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>npx</string>
        <string>-y</string>
        <string>linkedin-mcp-server</string>
        <string>--scheduler</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>LINKEDIN_ACCESS_TOKEN</key>
        <string>your_token</string>
        <key>LINKEDIN_PERSON_URN</key>
        <string>urn:li:person:your_id</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

## AI Image Generation

Generate images with Google Gemini Imagen 4 and post them directly to LinkedIn.

### Setup

Get a free API key at [Google AI Studio](https://aistudio.google.com) and set `GEMINI_API_KEY`.

### Usage

> "Generate a professional banner image about AI automation and post it on LinkedIn with the text: AI is transforming how we manage social media..."

The server will:
1. Generate an image using Imagen 4
2. Upload it to LinkedIn
3. Create the post with the image attached

Scheduled posts can also auto-generate images at publish time using the `gemini_prompt` parameter.

## Content Templates

7 built-in templates for consistent, high-quality posts:

| Template | Format |
|----------|--------|
| Thought Leadership | Hook → Insights → CTA |
| Case Study | Problem → Solution → Results |
| Announcement | Headline → Details → Features → CTA |
| Engagement Hook | Question → Context → Options |
| Behind the Scenes | Intro → Story → Lesson |
| Lesson Learned | Confession → Mistake → Lesson → Advice |
| Carousel Text | Title → Slides → CTA |

Create custom templates with `{{variable}}` syntax.

## Manual Token Mode

If you already have a LinkedIn access token (e.g., from another tool):

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

## Data Storage

All data is stored locally at `~/.linkedin-mcp/`:

```
~/.linkedin-mcp/
├── auth.json           # OAuth tokens (file permissions: 0600)
├── scheduler.db        # SQLite database for scheduled posts
├── brand-voice.json    # Brand voice configuration
├── templates/          # Custom content templates
└── images/             # Generated Gemini images
```

## Development

```bash
git clone https://github.com/bartoszgaca/linkedin-mcp-server.git
cd linkedin-mcp-server
npm install
npm run dev   # Run with tsx (hot reload)
npm run build # Compile TypeScript
```

## License

MIT — [Bartosz Gaca](https://bartoszgaca.pl)
