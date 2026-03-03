# LinkedIn Content Plan — Week of March 17, 2026

## Schedule Overview

| Day | Time | Language | Topic | Status |
|-----|------|----------|-------|--------|
| Tue Mar 17 | 09:30 CET | PL | MCP to nowy standard — co musisz wiedziec | SCHEDULED |
| Wed Mar 18 | 08:00 CET | EN | LinkedIn Algorithm Secrets I Coded Into My MCP | SCHEDULED |
| Thu Mar 19 | 09:30 CET | EN | Solo Founder Stack: Claude Code + MCP | SCHEDULED |
| Fri Mar 20 | 08:00 CET | EN | Week 3 Results — Real Numbers | SCHEDULED |

---

## Post 9 — Tuesday 17.03, 09:30 CET (PL)

### Topic: MCP — nowy standard ktory zmieni AI
### Template: thought-leadership-pl
### Image: post9-banner.png (MCP diagram: Claude ↔ MCP Server ↔ LinkedIn API)

MCP (Model Context Protocol) to najwazniejsza zmiana w AI od pojawienia sie ChatGPT.

Dlaczego? Bo AI w koncu moze ROBIC rzeczy, a nie tylko o nich mowic.

Przed MCP: "Napisz mi posta na LinkedIn" → dostajesz tekst → sam wklejasz → sam publikujesz
Po MCP: "Zaplanuj posta na czwartek 9:30 z grafika" → gotowe. Opublikowany. Z komentarzem.

MCP to prosty standard — definujesz narzedzia (tools), AI ich uzywa. Kazdy moze budowac:
→ MCP do LinkedIn (zbudowalem — 25 narzedzi)
→ MCP do Facebooka (tez zbudowalem)
→ MCP do bazy danych, CRM, e-mail, Slacka...

Kto powinien sie tym zainteresowac?
• Developerzy — nowa kategoria narzedzi do budowania
• Marketerzy — automatyzacja social media bez kodu
• Founderzy — wlasne narzedzia AI w godziny zamiast tygodni

Ten post wystawil sie automatycznie przez MCP scheduler. Tak wyglada przyszlosc content managementu.

Chcesz zobaczyc jak dziala? Link w komentarzu.

#MCP #AI #Automatyzacja

### Auto-comment (add after 15 min):
Kod zrodlowy MCP do LinkedIn: https://github.com/gacabartosz/linkedin-mcp-server — jedyny open-source z operacjami zapisu. 25 narzedzi, harmonogram, szablony. MIT license.

---

## Post 10 — Wednesday 18.03, 08:00 CET (EN)

### Topic: LinkedIn Algorithm — Rules I Coded Into My MCP Server
### Template: thought-leadership
### Image: post10-banner.png (algorithm checklist with green checkmarks)

I didn't just read about the LinkedIn algorithm. I coded it into a tool.

Here are the rules my MCP server enforces before publishing any post:

✅ Hook in first 210 characters (before "see more" cutoff)
✅ Post length 1300-1600 chars (sweet spot for dwell time)
✅ Max 3 hashtags, only at the end
✅ Link in comment, never in post body (-40% reach)
✅ CTA as the last line (drives comments = #1 engagement signal)
✅ Post on Tue-Thu at 8:00, 9:30, or 17:00
✅ Minimum 12h gap between posts
✅ Max 1 post per day
✅ First comment with link after 15 minutes

The server has a linkedin_guidelines tool — ask it about any topic (hooks, timing, formats, dos/donts) and it returns the rules. Your AI assistant reads them before writing a single word.

Result? Every post follows best practices by default. Not because you remember the rules — because the tool knows them.

This is the difference between knowing the algorithm and encoding the algorithm.

Which rule surprised you the most?

#LinkedInAlgorithm #MCP #ContentStrategy

### Auto-comment (add after 15 min):
Algorithm rules + 25 tools: https://github.com/gacabartosz/linkedin-mcp-server — built-in guidelines, templates, and auto-publish. Open source.

---

## Post 11 — Thursday 19.03, 09:30 CET (EN)

### Topic: The Solo Founder AI Stack
### Template: case-study
### Image: post11-banner.png (stack diagram: Claude Code + LinkedIn MCP + Facebook MCP + Auto-Publish)

My content management stack as a solo founder:

Claude Code (AI assistant)
+ LinkedIn MCP Server (25 tools)
+ Facebook MCP Server (auto-posts + groups)
+ Auto-publish daemon (background scheduler)
= Zero manual social media work

Here's my actual weekly workflow:

Sunday: Plan 4 posts in one conversation with Claude
→ "Schedule thought leadership post for Tuesday 9:30, behind-the-scenes for Thursday"
→ Claude writes content using built-in templates
→ I review, tweak, approve
→ Claude schedules via linkedin_schedule_create

Monday-Friday: The daemon handles everything
→ Posts publish at optimal times
→ GitHub link added as comment after 15 min
→ I engage with replies during "golden hour" (first 60 min)

Total time: ~2 hours on Sunday. That's it.

Before this system: 45 min per post × 4 posts = 3 hours of scattered work across the week. Now it's batched, automated, and algorithm-optimized.

This post was scheduled on Sunday. Published automatically on Thursday. The comment below was added by the daemon 15 minutes ago.

What does your content workflow look like?

#SoloFounder #AIWorkflow #Productivity

### Auto-comment (add after 15 min):
My full stack is open source: https://github.com/gacabartosz/linkedin-mcp-server — LinkedIn MCP with scheduling, templates, algorithm intelligence. Build your own AI content pipeline.

---

## Post 12 — Friday 20.03, 08:00 CET (EN)

### Topic: 3 Weeks of MCP-Powered LinkedIn — Real Numbers
### Template: case-study
### Image: post12-banner.png (placeholder — replace with real analytics screenshot)

**NOTE: Update this post with real metrics before Mar 20!**

3 weeks ago I published my first post via linkedin-mcp-server.

Here are the real numbers (no cherry-picking, no vanity metrics):

📊 Posts published: 12
⏱️ Time spent creating content: ~6 hours total (3 Sundays × 2h)
🤖 Posts that published themselves: 12/12

What worked:
→ "This post published itself" — highest engagement (people love meta content)
→ Polish posts get more comments from local network
→ Algorithm tips posts get saved/bookmarked
→ GitHub link in comment gets more clicks than link in post body

The MCP server is still running. Every post scheduled. Every comment automated. The system works.

If you're building something, build in public. The compound effect of consistent posting is real.

What's your experience with posting consistency?

#BuildInPublic #LinkedInGrowth #MCP

### Auto-comment (add after 15 min):
Full source code + 3 weeks of real data: https://github.com/gacabartosz/linkedin-mcp-server — the open-source LinkedIn MCP that powers this entire content series.
