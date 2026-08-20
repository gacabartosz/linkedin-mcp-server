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
- Hook **<100 znaków**, problem/porażka pierwsza — nie sukces.
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
- [ ] Hook <100 znaków, problem/porażka pierwsza?
- [ ] Należy do nisz A/B lub wątku C (spójność)?
- [ ] Realny screenshot (build) lub stat-card A/B (koncepcyjny)? Zero Canvy.
- [ ] Pytanie końcowe konkretne i zamknięte?
- [ ] Jeden system CTA (lustro / soft-lead / trigger), nie miks?
- [ ] ≤3 hashtagi, link TYLKO do komentarza?
- [ ] Slot wt–czw 07:30–08:30, gap ≥18h, brak kolizji tego dnia?
- [ ] Będę dostępny 60 min po publikacji + komentarz u 3 innych przed?
- [ ] Głos: bez myślnika-efekciarza, bez emoji-punktorów, bez korpo-żargonu?
