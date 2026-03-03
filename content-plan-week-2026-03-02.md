# LinkedIn Content Plan — Week of March 3, 2026

## Schedule Overview

| Day | Time | Language | Topic | Status |
|-----|------|----------|-------|--------|
| Tue Mar 3 | 09:30 CET | PL | Facebook Automation — auto posts + groups tracking | TO PUBLISH |
| Wed Mar 4 | 08:00 CET | EN | LinkedIn MCP Server — How I Built It A to Z | PUBLISHED (urn:li:share:7434488115160899584) |
| Thu Mar 5 | 09:30 CET | EN | LinkedIn MCP — Scheduling & Smart Posting | SCHEDULED |
| Fri Mar 6 | 08:00 CET | EN | LinkedIn MCP — Auto-Commenting via MCP | SCHEDULED |

---

## Post 1 — Tuesday 3.03, 09:30 CET (PL)

### Topic: Facebook Automation with Claude Code

Claude Code sie rozpedzil...

W ciagu 2 dni zbudowalem pelna automatyzacje Facebooka:

👉 Automatyczne publikowanie postow — zbudowalem panel admina, ktory sam planuje i wystawia posty na Facebooka. Zero recznej roboty.

👉 System monitorowania grup — 31 grup tematycznych (nieruchomosci, hale, gorzow) z tagami i statusami. Recznie udostepniam posty do max 9 grup na raz, a panel odznacza postep.

Kontekst: Wystawiam hale 400m2 pod Gorzowem. Zamiast reczne wklejac ogloszenia w 31 grupach, zbudowalem system ktory to organizuje.

Jak to dziala?
- Claude Code + MCP (Model Context Protocol) do Facebooka
- Facebook Graph API pod spodem
- Panel admina do zarzadzania
- Jedno klikniecie = post leci na strone, potem share do grup z poziomu panelu

To nie jest teoria. To dziala od teraz w produkcji.

Co dalej? Buduje to samo dla LinkedIn — MCP z 25 narzedziami, harmonogramem postow, generowaniem grafik AI i wbudowana wiedza o algorytmie LinkedIn.

AI zmienia sposob w jaki pracuje z social media. Nie chodzi o zastepowanie ludzi — chodzi o eliminowanie powtarzalnej roboty.

Masz pytania o automatyzacje social media? Pisz smialo.

#automatyzacja #AI #SocialMedia

---

## Post 2 — Wednesday 4.03, 08:00 CET (EN) — PUBLISHED

### Topic: How I Built the Only LinkedIn MCP Server with Write Operations
### URN: urn:li:share:7434488115160899584
### Comment: 7434488314239533056

---

## Post 3 — Thursday 5.03, 09:30 CET (EN)

### Topic: LinkedIn MCP — Smart Scheduling

"Schedule a thought leadership post for Thursday 9:30 with an AI-generated banner."

That's it. That's the prompt. And it works.

I built a LinkedIn MCP server with smart scheduling that most people think requires enterprise tools:

📅 Natural language scheduling — "post this Monday at 9am" → ISO 8601 → SQLite → auto-publish

⏰ Background daemon — checks every 30 seconds for due posts, retries failed ones up to 3 times

🎨 AI images at publish time — set a Gemini prompt, image is generated fresh when the post goes live

📊 Algorithm-aware — the server knows optimal posting times (Tue-Thu, 8:00/9:30/17:00), max 1 post per day, 12h minimum gap

🧠 12 built-in templates — Thought Leadership, Case Study, Viral Trend, Lead Magnet, Carousel Edu, and more. Each with algorithm tips baked in.

The key insight: LinkedIn has no scheduling API. Zero. So I built one with SQLite + setInterval + catch-up logic for overdue posts.

On startup, the daemon catches up on any posts that were scheduled while the server was down (up to 24h). Nothing gets lost.

This is the power of MCP — you build once, and every AI assistant can use it. Claude Code, Claude Desktop, any MCP-compatible client.

What features would you want in a LinkedIn automation tool?

#MCP #ContentScheduling #LinkedIn

### Auto-comment (add after 15 min):
Try it yourself: https://github.com/gacabartosz/linkedin-mcp-server — schedule posts, generate AI images, and let Claude handle your LinkedIn content. Open source, MIT licensed.

---

## Post 4 — Friday 6.03, 08:00 CET (EN)

### Topic: LinkedIn MCP — Auto-Commenting & Algorithm Intelligence

The most powerful signal on LinkedIn isn't likes. It's comments with 15+ words.

Posts with quality comments get 10-15x more reach. And the first 60 minutes after posting (the "golden hour") decide everything.

So I built a LinkedIn MCP server that understands this. Here's what it does:

💬 Auto-commenting — create comments and replies via MCP. After scheduling a post, automatically add a comment with your link (since links in the post body cut reach by 40%).

🧠 Built-in algorithm knowledge — the server has LinkedIn's ranking factors embedded: dwell time, quality comments, early engagement, relevance scoring. It knows the rules before you write a single word.

📋 Pre-publish checklist — hook in first 210 chars? Max 3 hashtags? Link in comment, not body? CTA at the end? The guidelines tool validates your content against LinkedIn best practices.

🎯 Brand voice config — set your tone, emoji style, posting times, golden hour duration. The AI adapts to YOUR voice, not generic advice.

The magic of MCP: every tool is composable. Schedule a post → auto-generate AI image → auto-add link comment → check algorithm guidelines. All in one natural language conversation.

I went from "I wish I could automate LinkedIn" to 25 working MCP tools in 48 hours. The age of AI-powered content management is here.

What's stopping you from building your own MCP tools?

#MCP #LinkedInAlgorithm #AIAutomation

### Auto-comment (add after 15 min):
Source code: https://github.com/gacabartosz/linkedin-mcp-server — the only open-source LinkedIn MCP with write operations, scheduling, AI images, and algorithm intelligence. Built with Claude Code + Ralph.
