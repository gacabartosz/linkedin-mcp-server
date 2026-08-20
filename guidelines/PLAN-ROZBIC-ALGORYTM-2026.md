# Plan: Rozbić algorytm LinkedIn 2026 i robić najlepsze posty

> Cel: przestać gubić zasięgi i zamienić profil w maszynę, która systematycznie produkuje posty,
> które algorytm **musi** roznieść. Oparte na zweryfikowanych mechanikach 2026 (źródła na końcu),
> nie na mitach. Stan wyjścia: mamy bramkę jakości (`qa-gate.mjs` + `algorithm-2026.json`),
> która już blokuje śmieci i wymusza pierwszoosobową, przeżytą treść.

---

## 0. Realia 2026 — co algorytm NAPRAWDĘ liczy (zweryfikowane)

Cała branża krwawi: **zasięgi −50%, zaangażowanie −25%, przyrost followersów −59% r/r.** To nie Ty —
to reset bazowego zasięgu. Wygrywa ten, kto rozumie nową mechanikę. LinkedIn przeszedł z
**relationship graph → interest graph**: tylko ~31% Twojego feedu to znajomi 1. stopnia, reszta to
2./3. stopień i obcy z Twojej niszy. **Liczba followersów jest odsprzężona od zasięgu** — konto 8 tys.
skupione bije konto 80 tys. rozmyte.

### Dźwignie, które PODBIJAJĄ zasięg (w kolejności wagi)

| Dźwignia | Mechanika | Liczba |
|---|---|---|
| **Dwell time** | ile czasu ktoś realnie czyta post = główny sygnał jakości | 61s+ → **15,6% ER** vs 0–3s → 1,2% (**13×**) |
| **Komentarze** | wątki z wieloma odpowiedziami, nie pojedyncze | warte **15×** like'a |
| **Saves (zapisy)** | content referencyjny, który ludzie chowają na później | **~5×** like, **2×** komentarz |
| **Golden hour** | pierwsze **60–90 min** decyduje czy post idzie dalej | 3 fazy dystrybucji; faza 3 = wyjście poza sieć |
| **Topic authority** | meta-dźwignia: spójność na 1–3 tematach = „structural distribution advantage" | 2–4 posty/tydz = +1 234 impresji/post vs 1/tydz |

### Co ZABIJA zasięg (wytnij natychmiast)

| Zabójca | Kara |
|---|---|
| Link w treści posta | **−60%** zasięgu |
| **Link w pierwszym komentarzu** (stary „trik") | **suppressed ~80% od początku 2026** — to już NIE działa |
| Treść formułkowa / AI-generic | **−47%** zasięgu |
| >3 hashtagi / generyczne tagi (#Leadership) | 30–50% kara + mylą klasyfikację (posty BEZ tagów biją te z tagami o 5–10%) |
| Skakanie po tematach | rozmywa „topic fingerprint", algorytm nie wie komu Cię podać |
| Posty codziennie | −26% średniego zasięgu/post + zmęczenie treścią |

---

## 1. Zasada naczelna (już wdrożona w bramce)

> Przewaga nad AI = naprawdę to przeżyłeś. Pisz **co zrobiłeś / co myślisz / jak doszedłeś**,
> nie „10 sposobów". Ludzie komentują to, co **czują**, nie to, co wiedzą.

To jest egzekwowane: scoring `experience/emotion/specificity` (próg 3/2/3, Σ≥10) + twarda bramka
kompletności + fact-check. Posty „opis produktu / case study klienta / spec-dump / nieprawda" = HOLD.

---

## 2. Anatomia najlepszego posta 2026 (pod 4 dźwignie naraz)

Każdy post projektujemy tak, żeby trafiał we **wszystkie** dźwignie:

```
[HOOK ≤210 zn, problem/porażka pierwsza]      → DWELL: zatrzymuje scroll przed "see more"
   ⮑ jedna konkretna scena, nie teza ogólna

[CIAŁO: przeżyta relacja, droga + błąd]        → DWELL + TOPIC AUTHORITY
   ⮑ krótkie akapity, dużo enterów, realne liczby/stack
   ⮑ pokaż porażkę PRZED wynikiem (napięcie = czas czytania)

[SAVE-TRIGGER: framework/checklist/liczby]     → SAVES: coś, co warto zachować
   ⮑ "zapisz, jak będziesz to robił u siebie"

[ZAMKNIĘTE pytanie do dyskusji]                → COMMENTS: prawdziwe, nie "co myślisz?"
   ⮑ pytanie, na które da się odpowiedzieć z własnego doświadczenia

[0–3 precyzyjne hashtagi, BEZ linka]            → nie karać zasięgu
```

**Pierwsza linia = jedyne, co decyduje o kliknięciu na mobile.** Hook to 80% roboty.

---

## 3. Strategia formatów 2026 (kolejność priorytetu)

1. **Tekst pierwszoosobowy** — po update z czerwca 2026 native text **+28% reach / +34% engagement** vs karuzela dla B2B. Domyślny format. Historia/porażka/refleksja.
2. **Tekst + AUTENTYCZNY screen** (terminal, panel, rozmowa bota) — buduje dwell i wiarygodność. NIGDY generowany banner/Canva (Twój test #11 = potwierdzony przez −47% za AI-generic).
3. **Karuzela PDF** — najwyższy dwell + **save-bait**: framework / checklist / krok-po-kroku z ORYGINALNYMI danymi. 1 slajd = hook, ostatni = jedno CTA. Używać celowo pod zapisy.
4. **Wideo <90s** — 5,6% ER, buduje więź. Kamera w twarz / demo ekranu, napisy, hook w 3s.
5. ❌ Nigdy: generowane grafiki, stock, link w treści, link w 1. komentarzu.

---

## 4. Quick wins — DO ZROBIENIA TERAZ (faza 1, dziś)

Te zmiany kosztują minuty i odzyskują zasięg od następnego posta:

- [ ] **Wyłączyć link-in-comment** w `brand-voice.json` (`link_in_comment: false`) — to dziś kara −80%, nie trik. Link → do DM / profilu / osobny post później, NIE w komentarzu pod postem.
- [ ] **Hashtagi**: zejść do 0–3 precyzyjnych, niszowych. Wyciąć generyczne (#AI, #Leadership). Rozważyć posty bez tagów (biją te z tagami o 5–10%).
- [ ] **Restart dashboardu** — żeby widzieć odznaki QA: `launchctl kickstart -k gui/$(id -u)/com.gaca.linkedin-dashboard`
- [ ] **Bramka QA live** (zrobione) — publikuje się tylko `approved`; 4 wstrzymane czekają na Twój realny wkład.
- [ ] **Trzymać 2 nisze**: AI-automation (MCP/Claude Code/boty) + polskie e-gov/open-data (KSeF/ZUS/ARiMR/IRZ). Każdy post = jedna z nich. Zero dryfu.

---

## 5. Build roadmap — maszyna w `linkedin-mcp-server`

Funnel: **pomysł (z realnego przeżycia) → draft → QA → hook A/B → publikacja → golden hour → analityka → feedback**.
Masz już większość klocków (`auto-engage.mjs`, `scrape-analytics.mjs`, `auto-publish.mjs`, `qa-gate.mjs`) — chodzi o domknięcie pętli.

### Faza 1 — Fundament (dziś) ✅ częściowo zrobione
- Bramka QA z manifestem + scoringiem + kompletnością + formatami → **zrobione**.
- Quick wins z sekcji 4 (config).

### Faza 2 — Idea Engine (wydobywanie REALNYCH przeżyć)
Problem #1 z manifestu: posty są generyczne, bo nie wyciągamy Twoich prawdziwych historii.
- Skrypt mineujący materiał źródłowy: **git log + commit messages**, dzienniki projektów, logi sesji Claude Code, statusy daemonów (fb-hala, CarHunter, Borix, voicedoc, KSeF-tool…).
- Dla każdego wyciąga „momenty": co się wysypało, co naprawiłeś, ile to zajęło, jaka liczba.
- Output: kolejka **pomysłów z gotowym surowcem przeżycia** (scena + liczby) → wpada do `media_plan_items` jako `plan`.
- Efekt: draft startuje z prawdziwej historii, nie z pustki → bramka QA przepuszcza za pierwszym razem.

### Faza 3 — Hook Lab (A/B hooków)
- Dla każdego draftu generuj **3 warianty hooka** (porażka-first / liczba-first / kontrariańska teza).
- Scoring „dwell-potential" (≤210 zn, napięcie, konkret) → wybór najlepszego, reszta do `text_alt`.
- Reguła 62 znaków (to, co widać przed „see more" na mobile).

### Faza 4 — Golden Hour Engine
Pierwsze 60–90 min = wszystko. Zautomatyzować rozgrzewkę i podtrzymanie wątku:
- **10–15 min przed publikacją**: auto-komentarze wartościowe u 3–5 osób z niszy (masz `auto-comment-*`).
- **Pierwszy komentarz autora po ~15 min**: WARTOŚĆ (ciekawostka/dane/kontekst), **bez linka**.
- **Push do Ciebie** w momencie publikacji: „odpowiadaj na komentarze przez najbliższą godzinę" (golden hour to ręczna robota o najwyższym ROI).
- **Auto-reply daemon** (`auto-engage.mjs`) — dopina wątki, każda odpowiedź min. 2 zdania + dopytanie (przedłuża thread = waga 15×).

### Faza 5 — Analytics Feedback Loop
Bez pomiaru strzelamy na ślepo. Domknąć pętlę:
- Rozszerzyć `scrape-analytics.mjs` o **dwell time, saves, komentarze, sends** per post (nie tylko likes/impresje).
- Tabela `post_performance`: format, hook-typ, nisza, scores QA vs realny wynik.
- Co tydzień: **które hooki/formaty/nisze realnie dają dwell+saves+comments** → feed z powrotem do scoringu Hook Lab i do progów `algorithm-2026.json`.
- Tu „rozbijasz algorytm": uczysz się NA SWOICH danych, nie na blogach.

### Faza 6 — Topic Authority Tracker
Meta-dźwignia. Pilnuje „topic fingerprint":
- Klasyfikuje każdy post do niszy (semantic clarity) i liczy udział: cel **≥80% w 2 niszach**.
- Alert na dryf tematyczny (post poza niszami → ostrzeżenie przed publikacją).
- Mierzy trend topic authority (zaangażowanie w niszy w czasie).

---

## 6. Tydzień operacyjny (cadence)

3 posty/tydz = sweet spot (Twój config: wt/śr/czw, 07:30–08:30 — zostaje).

| Dzień | Akcja |
|---|---|
| Pon | Idea Engine → wybór 3 tematów na tydzień (1 musi być o PORAŻCE — najdłuższe wątki) |
| Wt/Śr/Czw | Publikacja 1 posta → **golden hour: 60 min na odpowiadanie** (blok w kalendarzu) |
| Pt | Analytics review: co dało dwell/saves/comments → korekta na kolejny tydzień |
| Mix | 1× tekst-historia, 1× tekst+screen, co 2. tydz. 1 karuzela-save-bait; wideo gdy jest realne demo |

---

## 7. Metryki sukcesu (cel: rozbić algorytm = wygrać dźwignie)

Nie „lajki". Mierzymy to, co algorytm liczy:
- **Dwell**: % postów z avg >30s (cel: rosnący).
- **Comments/post** i **% wątków 2+ odpowiedzi** (waga 15×).
- **Saves/post** (waga 5×) — szczególnie karuzele.
- **% approved first-pass** w bramce QA (jakość draftów rośnie = Idea Engine działa).
- **Topic authority**: ≥80% postów w 2 niszach.
- **Reach trend** vs baseline (mimo branżowego −50%, skupiona nisza ma rosnąć).

---

## Źródła (zweryfikowane 2026-06-21)
- LinkedIn Algorithm Explained 2026 — Dwell Time, Comments (meet-lea.com)
- LinkedIn Algorithm 2026: What Works Now — Documents/Video (dataslayer.ai)
- 5 Steps to 10x Reach 2026 — Comments 2x Likes (HypergrowthAI, Medium)
- LinkedIn Algorithm 2026: First 60 Minutes Decide Reach (growleads.io)
- LinkedIn Algorithm 2026: Topic Authority, Documents, Saves (Melanie Goodman)
- LinkedIn Algorithm June 2026: B2B Reach (markanamedia.com)
- LinkedIn Algorithm Changes 2026: Beat the Depth Score (linkboost.co)
- How the LinkedIn Algorithm Works 2026 (sproutsocial.com)
```
