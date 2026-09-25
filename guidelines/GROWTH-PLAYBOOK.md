# LinkedIn Growth Playbook — Bartosz Gaca

> Wytyczne wzrostowe oparte na **realnych danych z konta** (analytics.db) + **Twoich własnych
> przetestowanych wnioskach** (post #11, „4 tygodnie media planu"). Nie na ogólnikach z internetu.
>
> Trzy role w jednym dokumencie: **spec od algorytmu**, **spec od wizerunku**, **spec od wzrostów**.
> Aktualizacja: 2026-06-18. Cel konta: **leady B2B** (MVP, doradztwo, projekty, strony, automatyzacje). Język: PL 80% / EN 20%.

---

## 0. Punkt wyjścia — co mówią dane (stan na 2026-06)

| Metryka | Wartość | Diagnoza |
|---|---|---|
| Wzrost obserwujących | ~185/tydz, **liniowy** | Brak efektu kuli śnieżnej. Algorytm Cię nie rozpędza. |
| Śr. wyświetlenia / post | 2 702 (peak 31 146) | Sufit zasięgu organicznego bez wiralowych pików. |
| Mediana engagement | **<1%** | Zdrowo jest 2–5%. Treść nie wywołuje reakcji. |
| Komentarze PL / post | **0,7** | Publika PL nierozgrzana. To największa dźwignia. |
| EN vs PL | 25 rx / 8,3 kom **vs** 7,7 rx / 0,7 kom | EN ma 3–10× lepszy engagement, ale to nie Twój pipeline. |
| Rytm | 1–6 postów/tydz, z lukami | Luki (np. W20–W22) zabijały rozpęd. |

**Wniosek nadrzędny:** problemem NIE jest częstotliwość ani zasięg surowy. Problemem jest
**engagement rate i komentarze**. Algorytm LinkedIn rozpędza konto dopiero, gdy posty generują
**komentarze >15 słów w pierwszej godzinie**. Cała strategia celuje w to jedno.

---

## 1. SPEC OD ALGORYTMU — jak działa dystrybucja i jak ją wygrać

### 1.1 Trzy fale dystrybucji
1. **Fala 0 (golden hour, 60–90 min):** LinkedIn pokazuje post ~5–10% Twojej sieci. Mierzy
   dwell time + reakcje + **komentarze**. To okno decyduje o wszystkim.
2. **Fala 1:** jeśli sygnały dobre → rozszerza na sieć 2. stopnia.
3. **Fala 2:** jeśli nadal rośnie → poza sieć (wiral). Tu robią się piki 30k+.

Konto liniowe = utyka na Fali 0/1. Trzeba **wygrać golden hour**, żeby przejść dalej.

### 1.2 Sygnały rankingowe (waga)
- **Komentarz >15 słów = ★★★★★** — najsilniejszy. 10–15× reach. Cała treść ma do tego prowadzić.
- **Dwell time = ★★★★★** — czas na poście. Długi, dobrze sformatowany tekst + 1 mocny wizual.
- **Golden hour engagement = ★★★★★** — pierwsze 60 min.
- **Spójność tematyczna autora = ★★★★** — *„3 posty/tydz w jednym temacie biją 5 o wszystkim"* (Twój wniosek #11). Algorytm buduje autorytet tematyczny.
- **Zapisy / udostępnienia = ★★★★**

### 1.3 Czynniki ryzyka (czego NIE robić)
- **Link w treści posta = −40% zasięgu.** ZAWSZE link w komentarzu po 15–30 min. (W repo już zautomatyzowane.)
- **Generowane grafiki/bannery = zbity zasięg** (Twój test #11). Patrz §2.4.
- **Engagement bait** („Skomentuj TAK") = karane. Pytanie otwarte ≠ bait.
- **>3 hashtagi**, masowe tagowanie, edycja w golden hour, 2 posty/12h.

### 1.4 Rytm (z brand-voice.json — zgodny z konfiguracją)
- **Dni:** wt / śr / czw. **Godziny:** 07:30 / 08:00 / 08:30 (rotacja).
- **3 posty/tydz**, gap ≥18h, max 1/dzień.
- **Golden hour:** komentuj u 3–5 innych 10–15 min PRZED publikacją (rozgrzewa Twój zasięg), potem 60 min dostępny na odpowiedzi.

---

## 2. SPEC OD WIZERUNKU — kim jesteś na feedzie

### 2.1 Pozycjonowanie (jedno zdanie)
> **„Buduję cyfrowe narzędzia dla polskich firm — od MVP po automatyzacje. Pokazuję jak, na żywym kodzie."**

Nie „developer". Nie „AI enthusiast". **Builder z dowodami, który wycina zbędne.**
Wyróżnik vs agencje: szczerość (pokazujesz porażki), konkret (realny stack, nie marketing), szybkość (MVP w tydzień, nie kwartał).

### 2.2 Dwie nisze + jeden wątek konsultingowy (Twój własny podział #11)
- **Nisza A — AI automation:** boty WhatsApp/FAQ, voicedoc, agent-pack, gacek CLI.
- **Nisza B — polskie dane publiczne / e-gov:** ZUS MCP, KSeF, IRZplus, odpisznapismo.
- **Wątek C — opinie/doradztwo (lead-gen):** CRM, MVP, „klient vs dane", wycinanie z briefu.

**Reguła spójności:** ≥80% postów w nisze A+B+C. Nie skacz po tematach — algorytm karze rozjazd, a publika gubi „po co tu jesteś".

### 2.3 Cztery filary treści (rotacja)
| Filar | Funkcja | Przykład z Twoich postów |
|---|---|---|
| **Porażka / lekcja** | trust | „Klient używał automatyzacji 2 razy" |
| **Gotowe rozwiązanie** | lead magnet | ZUS MCP, FAQ-bot, voicedoc |
| **Opinia rynkowa** | zasięg/kontrowersja | „Firmy przepłacają za SaaS", „wycinam z briefu" |
| **Behind the scenes** | pipeline visibility | „4 tygodnie media planu", „122 grupy" |

### 2.4 Wizualia — decyzja oparta na Twoich danych
Twój test #11: **autentyczny screenshot > generowana grafika**. Zasada:
- **Build-in-public** → ZAWSZE realny screen (terminal, panel, dashboard, rozmowa bota). Nie Canva.
- **Posty koncepcyjne** (opinia/lekcja, anegdota bez realnej apki do pokazania) → **czysty tekst**.
  Twoje top posty były tekstowe; nie podstawiaj generowanego stat-cardu ani screena z innego
  projektu (fałszywa atrybucja). Lepszy mocny tekst niż grafika-zapychacz.
- **Nigdy:** stocki, clip-art, dekoracyjna grafika „z Canvy", emoji jako punktory.

### 2.5 Głos (styl pisania)
- Hook **<100 znaków**, problem/porażka pierwsza — nie sukces. **Pierwsza linia niesie też słowo
  klucz tematu** (staje się URL-em, §7.1) i NIGDY nie zaczyna się od hashtagu.
- Krótkie zdania. Dużo enterów. Zero żargonu korporacyjnego.
- **Bez** „—" (myślnika) jako efekciarstwa, bez „nie tylko… ale i…", bez trójdzielnych wyliczeń na siłę, bez emoji-punktorów. (Reguły humanizera.)
- Konkret + liczba. Jedna myśl = jeden akapit.
- ≤3 hashtagi, na końcu.

---

## 3. SPEC OD WZROSTÓW — jak zamienić zasięg w leady

### 3.1 System CTA (zastępuje 5 obecnych wariantów — JEDEN schemat)
Rotacja trzech, zależnie od filaru:

1. **Pytanie-lustro** (domyślny, każdy post): pytanie zamknięte, na które odbiorca ma własne
   doświadczenie. *„Po jakim czasie wracają u Was briefy z 'dodajmy slider'?"*
   → cel: komentarze (sygnał algorytmu). Polacy komentują, gdy mogą się porównać lub poprawić.
2. **Soft-lead** (1×/tydz, posty „gotowe rozwiązanie"): *„Robisz integracje X? DM otwarty."*
   → niska presja, kwalifikuje samodzielnie.
3. **Trigger-słowo** (max 1×/2 tyg, NIE częściej — ociera się o bait): *„Napisz 'PRZEGLĄD' —
   zrobię bezpłatną 20-min analizę."* → aktywuje komentarze + DM naraz. Używać oszczędnie.

**Nigdy:** „Zostaw 👍", „Oznacz znajomego", „Skomentuj TAK".

### 3.2 Comment engineering (Twoja największa dźwignia — 0,7 kom/post)
- Pytanie na końcu MUSI być konkretne i zamknięte. „Co myślisz?" = martwe. „Po ilu tygodniach
  widzicie pierwsze dane?" = żywe.
- **Pierwszy komentarz autora** (po 15 min): link/screenshot + dodatkowy konkret, który zaprasza do dyskusji.
- W golden hour odpowiadaj na KAŻDY komentarz, min. 2 zdania, **zadaj dopytanie** (przedłuża wątek = silniejszy sygnał).
- Posty o **porażkach zbierają dłuższe komentarze** niż o sukcesach (Twój wniosek #11). Planuj 1 porażkę/tydz.

### 3.3 Lejek leadowy (gdzie ląduje uwaga)
Post → komentarz/DM → bezpłatna 20-min analiza → MVP w tydzień / retainer.
Nie sprzedawaj w poście. Sprzedaje **dowód** (działający kod) + **niska bariera** (DM, nie formularz).

### 3.4 EN 20% — kiedy i po co
1 post EN/tydz (piątek lub osobny slot), najlepszy case study przetłumaczony. Cel: zasięg +
social proof, NIE pipeline. Nie mieszaj z głównym rytmem PL wt–czw.

---

## 4. PLAN 90 dni

**Faza 1 (tyg. 1–4) — rozgrzanie publiki PL.**
3 posty/tydz wt–czw. Każdy wtorek = magnet (opinia/wynik). Śr/czw = build-in-public z realnym
screenem. Cel: podnieść komentarze z 0,7 → 3+ /post. Mierz golden-hour comments.

**Faza 2 (tyg. 5–8) — autorytet tematyczny.**
Trzymaj 2 nisze. Wprowadź 1 EN/tydz. Pierwszy trigger-słowo CTA. Cel: engagement rate >2%,
pierwsze 3–5 jakościowych DM.

**Faza 3 (tyg. 9–12) — konwersja.**
Dołóż 1 case study (PDF carousel — najwyższy dwell time) pokazujący efekt u klienta.
Cel: 2–3 leady/mies wchodzące przez DM. Sprawdź czy wzrost obserwujących przeszedł z liniowego
w przyspieszający.

**Mierniki sukcesu (dashboard :6767):**
- Komentarze/post: 0,7 → 3+ (tyg. 4), 5+ (tyg. 12)
- Engagement rate: <1% → >2%
- DM-leady: 0 → 2–3/mies
- Krzywa obserwujących: liniowa → wklęsła w górę

---

## 5. Checklist przed każdą publikacją
- [ ] Hook <100 znaków, problem/porażka pierwsza, **słowo klucz w 1. linii, bez hashtagu na starcie** (§7.1)?
- [ ] Należy do nisz A/B lub wątku C (spójność)?
- [ ] Realny screenshot (build) lub stat-card A/B (koncepcyjny)? Zero Canvy.
- [ ] **Załącznik PDF/karuzela nazwany słowami kluczowymi** (nazwa pliku = URL, §7.1)?
- [ ] **Długość 200-300 słów** (§7.3)?
- [ ] **Jest lista/framework + pytanie→krótka odpowiedź** (format cytowalny, §7.2)?
- [ ] **Nota autorska 1 linia na końcu + konkretna data w tekście** (§7.2)?
- [ ] Pytanie końcowe konkretne i zamknięte?
- [ ] Jeden system CTA (lustro / soft-lead / trigger), nie miks?
- [ ] ≤3 hashtagi (NIGDY w 1. linii), link TYLKO do komentarza?
- [ ] Slot wt–czw 07:30–08:30, gap ≥18h, brak kolizji tego dnia?
- [ ] Będę dostępny 60 min po publikacji + komentarz u 3 innych przed?
- [ ] Głos: bez myślnika-efekciarza, bez emoji-punktorów, bez korpo-żargonu?

---

## 6. Komentarze pod cudzymi postami (networking / topic authority)

> Wypracowane 2026-07-03 na komentarzu do posta o postanowieniu NSA (halucynacje AI w piśmie
> procesowym). Komentarz u innych = ta sama waga wizerunkowa co własny post — czyta go publika autora.

### 6.1 Rola i kąt
- **Zawsze z pozycji praktyka-buildera:** „buduję na LLM-ach na co dzień". Nie recenzent, nie teoretyk.
- Schemat: **zgadzam się z tezą autora → dokładam warsztat z pierwszej ręki → mocna puenta.**
  Nie polemizuj dla polemiki; wartość = perspektywa techniczna, której publika autora (np. prawnicy) nie ma.
- Puenta 1–2 zdania, najlepiej odwrócenie ramy posta („NSA nie rozprawił się z AI. Rozprawił się z pominięciem etapu…").

### 6.2 Forma
- **>15 słów** (sygnał algorytmu), realnie 4–8 zdań. Jeden wątek, nie esej.
- **Bez myślnika „—"** (reguła humanizera) — zamieniaj na przecinek, dwukropek albo nowe zdanie.
- Bez emoji-punktorów, bez hashtagów, bez linków, bez CTA sprzedażowego.
- Żargon techniczny (RAG, MCP, kontekst) tylko z wyjaśnieniem po ludzku, w tym samym zdaniu.

### 6.3 Fact-check przed wysłaniem (obowiązkowy)
- **Wciel się w eksperta domeny** (twórca LLM / prawnik / DevOps — zależnie od tematu) i sprawdź
  komentarz zdanie po zdaniu, zanim wyjdzie.
- Pilnuj **kategorii pojęć**: RAG = technika, MCP = protokół — to nie są zamienniki
  („przez RAG […] na przykład po protokole MCP", nie „RAG albo MCP").
- Unikaj absolutów („wyłącznie", „100%", „zawsze działa") — RAG redukuje halucynacje, nie eliminuje.
  Zostaw człowieka w pętli w treści komentarza („człowiek i tak sprawdza przed podpisem").
- Halucynacja to **naturalne działanie** modelu (najbardziej prawdopodobny tekst ≠ fakty), nie „błąd
  modelu" — błędem jest używanie LLM jak wyszukiwarki.

### 6.4 Publikacja
- **Wklejaj ręcznie.** Po incydencie restrykcji 2026-06-24 zero automatów do interakcji na cudzych
  postach (auto-comment-sender tylko do własnych wątków, jeśli w ogóle).
- Najlepszy moment: świeży post (<24h), idealnie przed publikacją własnego (rozgrzewa zasięg, §1.3).
- Po komentarzu bądź dostępny na odpowiedź autora — wątek 2+ wymian to najsilniejszy sygnał.
- **AI też cytuje komentarze.** Wartościowy komentarz (wiedza, pytanie, inna perspektywa) jest
  retrievowany przez LLM tak samo jak post (§7). To dodatkowy powód, żeby komentarz był
  merytoryczny, >15 słów i samodzielnie zrozumiały poza kontekstem wątku.

---

## 7. Widoczność w AI (cytowania LLM)

> Źródło: **oficjalny materiał LinkedIna** — Davang Shah, VP Marketing @ LinkedIn, 30.06.2026.
> Nowy sygnał OBOK algorytmu ludzkiego (§1): LLM-y (AI search) cytują treści z LinkedIna jako
> #1 zaufane źródło zawodowe. Bycie cytowanym = zasięg poza siecią + „buyability" (klient szukający
> rozwiązania widzi Twoje nazwisko w odpowiedzi AI). Statystyki niżej: dane Semrush 2026 / LinkedIn
> z artykułu — cytuj z atrybucją, nie jako własne pomiary.

### 7.1 Pierwsza linia = URL (NIEODWRACALNE)
- LinkedIn generuje URL posta z **pierwszej linii**. URL-a NIE zmienisz po publikacji (edycja treści też nie).
- **Front-load słowa kluczowe** tematu w pierwszym zdaniu. NIE zaczynaj od hashtagu (generyczny URL, rozmyty sygnał).
- Reconcile z §2.5: hook dalej mocny (problem/porażka), ale niesie temat. Zamiast czystej anegdoty
  wpleć słowo klucz w pierwsze zdanie (np. „Automatyzacja księgowości…", „Karuzela na LinkedIn…").
- **GOTCHA plik = URL:** gdy post ma załącznik (PDF/karuzela), NAZWA PLIKU może stać się URL-em
  zamiast pierwszej linii. Nazywaj PDF-y słowami kluczowymi z myślnikami
  (`automatyzacja-ksiegowosc-ai.pdf`, nie `karuzela-final-v3.pdf`). Dotyczy postów-dokumentów z §7.6.

### 7.2 Struktura pod ekstrakcję (żeby LLM mógł zacytować)
- Pytanie → krótka, bezpośrednia odpowiedź (1-2 zdania). Pytania jako śródtytuły.
- **Listy punktowane/numerowane** — wg danych LinkedIna 100% cytowanych treści miało listę. Framework/checklist = format cytowalny.
- Krótka **nota autorska na końcu** (1 linia: kto jesteś) = sygnał wiarygodności.
- Podawaj **konkretne daty** w tekście — LLM rozumie oś czasu i aktualność.

### 7.3 Długość i format
- Post: **200-300 słów** (optimum retrieval + engagement). Twoje ~150-250 podbić bliżej 200-300 tam, gdzie treść to udźwignie.
- **Artykuł** (800-1200 słów) = kotwica cytowań, wyższy udział cytatów niż post. DZIŚ robisz zero — do dodania do pipeline.
- System: 1 mocny artykuł → rozbij na **3-5 postów** (każdy 1 idea/stat/framework z artykułu) → wnioski z postów wracają do następnego artykułu.

### 7.4 Autorytet i świeżość (Semrush 2026, z artykułu)
- **54-64%** cytowanych postów to wiedza/praktyczna porada (edukacja > promocja — spójne z §2.3 filar „lekcja").
- **2000+ obserwujących** = bazowy próg wiarygodności dla cytowań.
- **10+ wartościowych komentarzy** = sygnał zaufania (pokrywa się z §3.2, Twoja największa dźwignia).
- **95%** cytowań pochodzi z ORYGINALNYCH postów, nie repostów → twórz oryginały.
- Świeżość: tygodniowy rytm > miesięczny; stare posty można aktualizować (dopisz datę aktualizacji).

### 7.5 Trzy formaty cytowalne (przykłady z artykułu → Twoje odpowiedniki)
- **Insight** (trend + jeden wniosek + actionable) → Twój filar „opinia rynkowa".
- **Framework** (lista/model/checklist, wizual: karuzela/checklist) → Twoje gotowce (ZUS MCP, FAQ-bot).
- **Experience** (historia / lekcja z pierwszej ręki) → Twój filar „porażka/lekcja", build-in-public.

### 7.6 Napięcia z algorytmem ludzkim (§1-2) — jak nie stracić jednego dla drugiego
- Hook: człowiek chce dramaturgii (§2.5), AI chce słowa klucz w linii 1. ROZWIĄZANIE: jedno zdanie, które
  robi oba (temat + napięcie), nigdy hashtag na starcie.
- Długość: golden hour lubi dwell time (dłuższy tekst), AI-retrieval lubi 200-300 słów zwięźle. Cel 200-300 to kompromis, trzymaj się go.
- Hashtagi (§2.5, ≤3 na końcu) zostają — tylko NIGDY w pierwszej linii.

---

### 7.7 Dane i reguły z serii LinkedIn AI-search (5 artykułów LinkedIn + Meltwater 9,5 mln cytowań, 06-07.2026)

> Twarde liczby — cytuj z atrybucją (Meltwater / Semrush / LinkedIn), nie jako własne pomiary.

**Skala i kto jest cytowany:**
- LinkedIn = **#2 najczęściej cytowane źródło** przez LLM-y; ~**11%** odpowiedzi AI cytuje LinkedIn; udział cytowań **+26%**; **11× więcej niż Quora**, wyprzedza Reddit.
- **75% cytowań z profili OSOBISTYCH**, 25% z Company Pages. ALE Perplexity cytuje Company Pages w **59%**, a ChatGPT Search i Google AI Mode cytują twórców-osoby w **59%**. WNIOSEK: publikuj z OBU (profil + strona firmowa).
- **CEO cytowani 8,2%, founderzy 7,5%** — „ekspertyza ważniejsza niż tytuł". Twój atut: jesteś founderem (reklamacje24, OdpiszNaPismo) i piszesz z pierwszej ręki.
- Cel lead-gen: **95% kupujących B2B** używających AI polega na niej przy researchu dostawców, **84%** używa AI-search w procesie zakupowym. Cytowanie = „buyability".

**Format (co się cytuje):**
- Artykuły + zwykłe posty = **83% cytowań**. Artykuły 50-66% cytowań, krótkie posty 15-28% — dlatego artykuły są kotwicą (§7.3).
- **Każdy top-cytowany artykuł miał listę; 92% miało czytelne nagłówki**; listy/porównania = **54%** najczęściej cytowanych.

**Świeżość:**
- **48% cytowanych treści z ostatnich 3 miesięcy, tylko 12% starsze niż rok** — AI aktywnie recrawluje. Wpisuj konkretne daty, aktualizuj stare posty (dopisz „aktualizacja <data>").

**Oryginalność i autorytet:**
- **72-95% cytowań to oryginały; reposty ~5% i są dla AI bezwartościowe.**
- Progi obserwujących: **2000+ (bazowy), 3000+ (mocniejszy)**. **10+ wartościowych komentarzy**. **75% cytowanych autorów = 5+ postów / 4 tyg.** Viral zbędny (mediana cytowanych postów **15-25 reakcji**).

**Reguły formy — DOPISANE do §7.2:**
- Każdy akapit SAMODZIELNY (1-3 zdania), zrozumiały bez sąsiednich — AI nie zakłada kontekstu z otoczenia.
- Rozwijaj skróty przy pierwszym użyciu; nazywaj marki/produkty WPROST (nie „nasze narzędzie", tylko nazwa) — inaczej AI parafrazuje do generyku.
- **Video OK, ale ZAWSZE z napisami/captionem** (tekst daje modelowi kontekst; dotyczy Twoich rolek/TikToków).
- TL;DR (na górze lub dole) pomaga w ekstrakcji. Jeden termin na jedno pojęcie, konsekwentnie (glosariusz marki).

**Pomiar:** cytowania i wzmianki mierz OSOBNO od zaangażowania — wysokie reakcje ≠ cytowania. Nowa rama celu: „Be seen, be mentioned, be considered, be chosen" (nie „search → click → website").

---

## 8. Bramka jakości przed publikacją (OBOWIĄZKOWA — posty i komentarze)

> Ta sama dyscyplina co §6.3 dla komentarzy, ale zakodowana dla POSTÓW. Nic nie idzie do
> `status='scheduled'`/`approved` bez przejścia obu bramek. Incydenty, które to wymusiły:
> zmyślona bramka OCR w poście fabryka-ocr (przeszła QA jako „private"), duplikaty publikacji.

### 8.1 Humanizer (deterministyczny, styl)
- Każdy post i komentarz przez `humanizeText()` z `lib/humanize.mjs` PRZED zapisem. Oczekiwane: **CHANGED=false**
  (jak zmienia, znaczy że był myślnik/wzorzec AI, popraw źródło). Uruchamiaj Node 22
  (`~/.nvm/versions/node/v22.22.0/bin/node`), nie systemowym 20 (ABI better-sqlite3).
- Twardo: **zero „—" i „–"**, bez „nie tylko… ale i…", bez emoji-punktorów, bez korpo-żargonu.
- **Treść w pełni AI-generowana ryzykuje flagę / brak indeksowania przez LinkedIn** (źródło: LinkedIn). Pisz z autentycznej wiedzy, humanizer (CHANGED=false) i ludzki fact-check §8.2 są tu podwójnie ważne — chodzi nie tylko o styl, ale o to, żeby treść w ogóle została zindeksowana i cytowalna.

### 8.2 Fact-check (obowiązkowy)
- Posty w bazie: `node qa-gate.mjs --id <id>` (Opus 4.8 + WebSearch). Publikuje się TYLKO `qa_status='approved'`.
- OGRANICZENIE, które trzeba znać: qa-gate klasyfikuje twierdzenia o własnym systemie jako „private,
  nieweryfikowalne, nie blokuje" — czyli **NIE wychwyci zmyślonego mechanizmu technicznego**
  (bramka OCR przeszła). Dlatego mechanizmy/pipeline/liczby o własnych projektach weryfikuj
  RĘCZNIE względem kodu, zanim wpiszesz je do posta.
- Zasady jak §6.3: zero absolutów, liczby/daty tylko z realnego źródła, kwalifikatory dosłownie,
  cudze tezy z atrybucją. Grafika/karuzela WIZUALNIE zgodna z treścią (nie pod starą narrację).
- Po edycji treści posta **resetuj `qa_status`** i przepuść QA od nowa (edycja nie przelicza QA sama).

### 8.3 Kolejność
1. Napisz/przerób treść. 2. `humanizeText()` → CHANGED=false. 3. Ręczny fact-check mechanizmów vs kod.
4. `qa-gate.mjs --id` → approved. 5. Dopiero teraz `status='scheduled'`. 6. Grafika/plik zgodne z treścią
   i nazwane słowami kluczowymi (§7.1).
