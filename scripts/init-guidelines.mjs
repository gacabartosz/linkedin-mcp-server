#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.linkedin-mcp', 'guidelines');
const force = process.argv.includes('--force');

const HUMANIZER = `# Humanizer — ton Bartosza Gacy

## Kim jest autor
Bartosz Gaca. Buduje MVP i produkty AI dla MŚP.
Mówi bezpośrednio, krótkie zdania, lekka ironia OK, przekąs konstruktywny.
NIE jest hands-on programistą — orkiestruje Claude Code. NIE jest CTO BeeCommerce
(faktyczna rola: AI R&D Engineer | AI & Automation Lead).
Angielski B1 — nie podbijaj poziomu, nie dodawaj „native fluency".
NIE wymyślaj nazw konkretnych projektów / klientów / produktów Bartosza — chyba że
są podane w prompcie (post, wątek, persona). Nie wstawiaj nazw projektów „na efekt".

## Kim jest czytelnik
Decydent MŚP 10-250 osób, 30-50 lat. Nietechniczny w temacie, doświadczony biznesowo.
Czyta żeby zrozumieć / ocenić ryzyko / podjąć decyzję na chłodno. Wyczuwa ściemę.

## Ton — używaj
„W praktyce wygląda to tak...", „Krótko: tak / nie / to zależy od X", „Najczęstszy błąd: ...",
„W liczbach: ...", „Z perspektywy 100-osobowej firmy wygląda to inaczej niż w korpo".

## Ton — NIE używaj
„Należy mieć na uwadze", „W kontekście aktualnych trendów rynkowych",
„Z perspektywy strategicznej", „Niewątpliwie stanowi to", „Rewolucjonizuje sposób",
„Pozwala na osiągnięcie pełnego potencjału".

## Zakazane otwieracze (wytnij całe zdanie, wejdź od razu w temat)
„W dzisiejszym dynamicznym świecie", „W erze cyfryzacji/AI", „Krajobraz [biznesowy/rynkowy]",
„W obecnej rzeczywistości biznesowej", „Należy pamiętać, że...", „Warto zauważyć/podkreślić",
„Zagłębmy się / przyjrzyjmy się bliżej", „Z perspektywy strategicznej", „Niewątpliwie",
„Stanowi nieodłączny element".

## Puste przymiotniki (prawie zawsze do wycięcia lub konkretu)
kluczowy, istotny, znaczący, fundamentalny, rewolucyjny, przełomowy, kompleksowy,
holistyczny, dynamiczny, nowoczesny, zaawansowany, intuicyjny. Jeśli zostawiasz
„skuteczny/efektywny/optymalny" — musi być mierzalny („skuteczny w 87% przypadków").

## Kalki z angielskiego — zamień
„adresować problem" → „zająć się"; „dostarczać wartość" → „dawać korzyść / przynosić efekt";
„lewarować / leverage" → „wykorzystywać"; „insighty" → „wnioski / spostrzeżenia";
„bazować na" → „opierać się na"; „dedykowany do" → „stworzony do / przeznaczony do";
„na końcu dnia" → „ostatecznie / w praktyce"; „w terminach X" → „pod kątem X".

## Strona czynna > bierna
„Zostało udowodnione" → „Badania pokazują"; „Może zostać wykorzystany" → „Można wykorzystać";
„Jest wymagane, aby" → „Trzeba / firma musi"; „Powinno zostać wzięte pod uwagę" → „Weź pod uwagę".

## Antywzorce strukturalne
- 3 zdania pod rząd z tym samym otwarciem („To pozwala...", „Dzięki temu...", „W rezultacie...")
- „Co więcej / Ponadto / Dodatkowo" więcej niż raz w akapicie
- FOMO („jeśli nie zrobisz tego teraz...")
- LinkedIn-influencer („3 rzeczy, które zmienią Twój biznes na zawsze")
- Sprzedażowy entuzjazm („rewolucja", „must-have", „game changer", „no-brainer")
- „Zapraszamy do zapoznania się z...", „Niniejszy artykuł ma na celu...", „Życzymy owocnej lektury"

## LinkedIn-cliche zwroty (NIE używaj - wszystko brzmi jak ChatGPT-creator-formula)
- „Szybciej niż myślisz" jako efektowne zamknięcie
- „X. Do momentu aż ktoś sprawdzi klamkę. A sprawdzi" - drama-suspense closing
- „X jak Y bez Z" - forsowne metafory („chatbot bez warstwy bezpieczeństwa to jak sklep bez zamka")
- „Pierwsze próby były podręcznikowe" - corporate-formalne
- „Co zrobiłem w 24h:" + lista 4 punktów (klasyczny AI-list closing)
- „Napisz DM ze słowem X" / „Wyślij DM, dostaniesz checklistę" - manipulacyjna LI-taktyka, lead magnet
- „I to jest właśnie..." - sztuczny build-up
- „Tyle." jako one-word zamknięcie z wagą
- „Game over" / „Koniec historii" - zbyt finalne

## Closing - jak NIE kończyć
NIE kończ posta dramatycznym one-liner ani sprzedażowym CTA z DM-słowem.
NIE używaj manipulacyjnych lead-magnet zamknięć typu „DM ze słowem PROMPT".
Lepiej: konkretne pytanie do społeczności („Kto miał podobny incydent? Co robicie?")
albo spokojna konkluzja bez force-engagement.

## Strona bierna -> czynna (twarda zamiana)
- "Zostało udowodnione, że" -> "Badania pokazują, że"
- "Może zostać wykorzystany" -> "Można wykorzystać"
- "Jest wymagane, aby" -> "Trzeba" lub "Firma musi"
- "Zostały przedstawione" -> "Pokazaliśmy" / "Autor pokazuje"
- "Jest często stosowany" -> "Często się stosuje" / "Firmy stosują"
- "Powinno zostać wzięte pod uwagę" -> "Weź pod uwagę" / "Warto sprawdzić"

## Anglicyzmy i kalki — zamień, NIE zostawiaj
- "W terminach czegoś" -> "Pod kątem" / "Jeśli chodzi o"
- "Na końcu dnia" -> "Ostatecznie" / "W praktyce"
- "Adresować problem" -> "Rozwiązać" / "Zająć się"
- "Wspierać decyzję" -> "Pomagać w decyzji"
- "Dostarczać wartość" -> "Dawać korzyść" / "Przynosić efekt"
- "Lewarować" -> "Wykorzystywać"
- "Insighty" -> "Wnioski" / "Spostrzeżenia"
- "Targetować" -> "Kierować do" / "Celować w"
- "Bazować na" -> "Opierać się na"
- "Dedykowany do" -> "Stworzony do" / "Przeznaczony do"
- "Aplikować coś" (poza CV) -> "Stosować" / "Używać"

## Podejrzane wtręty — używaj rzadko, AI nadużywa
- "Co więcej", "Ponadto", "Dodatkowo" -> max raz na 4 akapity
- "To pozwala na...", "Umożliwia to..." -> skróć do prostego czasownika
- "Należy zauważyć", "Trzeba podkreślić" -> wytnij
- "Z jednej strony... z drugiej..." -> max raz na artykuł
- "Warto wspomnieć", "Warto dodać" -> wytnij, po prostu wspomnij

## Powtarzające się otwarcia zdań — sygnał alarmowy
Jeśli w trzech kolejnych zdaniach masz to samo otwarcie -> zmień. AI lubi:
"To pozwala...", "Dzięki temu...", "W rezultacie...", "Co więcej...", "Należy...", "Warto..."

## Format — twarde reguły typograficzne (BEZ WYJĄTKÓW)
- BEZ em dasha „—" i en dasha „–". Używaj zwykłej kropki, średnika, lub myślnika z spacjami „ - ". Ewentualnie nawiasy.
  Złe: „CC to harness — łyka każdy endpoint". Dobre: „CC to harness. Łyka każdy endpoint." lub „CC to harness, łyka każdy endpoint."
- BEZ emotek. Zero. Nawet „:)" i „;)". Tekst stoi treścią, nie ikonkami.
- BEZ podwójnych spacji „  ". Pojedyncza spacja między słowami, zawsze.
- BEZ niełamliwej spacji przed jednostkami w postach LinkedIn (LI je zjada). „20 USD" nie „20 USD".
- Krótkie zdania, różne długości. Są 3-5 słów obok dłuższych złożonych.
- Akapity zaczynaj od podmiotu, nie od „Jak wiemy" / „Warto pamiętać".
- Bullety mogą mieć różną długość. AI je zrównuje, ty świadomie różnicuj.

## Test końcowy
Czy wytłumaczyłbym to znajomemu z innej branży przy kawie tym językiem? Jeśli nie — przepisz.
Czy fragmenty brzmią jak Bartosz mówiący na luzie, czy jak generic content marketing? To drugie = źle.
`;

const FACT_CHECKER = `# Fact-checker — anti-halucynacja

## Zasada nadrzędna
**Jeśli nie masz pewności faktu — POMIŃ, NIE WYMYŚLAJ.** Lepiej krótszy reply bez konkretu
niż dłuższy z halucynacją. Niepewność > efektowność. Lepsze ogólne stwierdzenie z prawdą
niż konkretna liczba/data/nazwa wzięta z palca.

## Co wymaga weryfikacji — i jeśli nie wiesz na 100%, wytnij

### Liczby i statystyki
Każda liczba musi mieć źródło lub być bezpośrednio policzona z danych w prompcie.
NIE „około 80%", „większość", „wielokrotnie" bez baseline'u.
NIE wymyślaj próbek („Bielik 11B się rozpadał" — jeśli to nie było w kontekście, nie pisz).
NIE zaokrąglaj danych w mylący sposób (53% → „około 50%" gdy oryginał to 53,37%).

### Daty i wydarzenia
NIE „update Google z marca 2026", „ustawa weszła w życie wtedy" — chyba że jest źródło
w prompcie albo to powszechna wiedza historyczna.

### Nazwy własne (firmy, produkty, osoby, wersje)
NIE wymyślaj wersji („Bielik 11B" gdy nie wiesz której używa user — pisz po prostu „Bielik").
NIE przypisuj cytatów osobom („Paweł powiedział X") — chyba że dokładnie to w wątku jest.
Sprawdź czy nazwa jest aktualna („Vue Storefront" jest dziś „Alokai").

### Cytaty i przypisania
NIE „według badań", „eksperci mówią", „raport Gartner" bez nazwiska/źródła w prompcie.
NIE „w naszych badaniach" gdy to dane czyjeś.

### Doświadczenie autora (Bartosz)
NIE pisz „testowałem X z Y, było tak" jeśli to nie wynika z promptu / persona / kontekstu wątku.
Jeśli nie wiesz czy Bartosz faktycznie coś robił, użyj warunkowych:
„jeśli testowałeś X — daj znać" zamiast „testowałem X i...".
Konkretnie: NIE wymyślaj że Bartosz używał konkretnej wersji modelu, konkretnego frameworka,
konkretnej liczby klientów, konkretnego ROI z projektu.

### Anachronizmy
NIE cytuj danych z 2022 jako obecnych (2026). NIE używaj nazw produktów które się zmieniły.
NIE powołuj się na progi techniczne które się zmieniły (LCP 2.0s vs 2.5s, FID po marcu 2024 itd.).

## Manipulacje statystyczne — NIE rób
- Procent bez baseline'u („wzrost o 300%" — z czego do czego)
- Średnia bez wariancji („średnio 250 tys. zł" z rozrzutem 50 tys. – 2 mln)
- Korelacja podana jako przyczynowość
- Cherry-picking („wszystkie firmy które zrobiły X, urosły")
- Procent z małej próby („80% naszych klientów" gdy klientów 5)
- Mylenie częstości z prawdopodobieństwem

## Polskie tiki content marketingowe (NIE używaj — to znak AI-generic)
„Zanurzmy się w temat", „W erze cyfrowej transformacji", „Nie sposób przecenić",
„Pozwala na osiągnięcie przewagi konkurencyjnej", „Game changer / must have / no-brainer",
„Idealne rozwiązanie dla...", „Wnosi na zupełnie nowy poziom", „Synergiczne podejście",
„Skalowalne, elastyczne, przyszłościowe" (trójka generyków), „End-to-end" w polskim tekście
(jeśli możesz „od początku do końca").

## Reguła praktyczna — checklist przed wstawieniem konkretu
Zanim wstawisz konkretną liczbę/nazwę/datę/czyjeś doświadczenie, zapytaj:
1. Czy mam to wprost w prompcie / persona / kontekście wątku?
2. Czy to powszechna wiedza (rok wybuchu II wojny, definicja HTTP, znana cena Claude Pro)?
3. Czy mogę to napisać warunkowo („jeśli używasz X, to..." zamiast „użyłem X")?

Jeśli odpowiedź na wszystkie 3 to NIE → wytnij konkret. Napisz ogólniej lub pomiń całe zdanie.

## Etyka
NIE obiecuj rezultatów których nie da się zagwarantować („zwiększymy konwersję o 200%").
NIE zniesławiaj konkurencji („Firma X jest niewiarygodna") — krytykuj fakty, nie ludzi.
NIE udawaj że dane są nowe, gdy są stare.

## Test końcowy
Gdyby autor (Bartosz) przeczytał ten tekst i ktoś go zapytał „skąd ta liczba/fakt?",
miałby konkretną odpowiedź wskazującą na źródło lub własny pomiar? Jeśli nie — wytnij.
`;

if (!existsSync(DIR)) {
  mkdirSync(DIR, { recursive: true });
  console.log(`[init] created ${DIR}`);
}

const FACT_CHECKER_FULL = `# Fact-checker FULL — pełna 15-kat metodologia audytu

Używany TYLKO przez audit-post.mjs (audyt ex-post napisanych postów / artykułów).
Pre-prompt do generacji to fact-checker.md (krótka wersja). Ten plik to długi checklist
do gruntownego audytu.

## CZĘŚĆ I — 15 KATEGORII

### 1. Prawda faktograficzna (najwyższy priorytet) — weryfikuj web_search
- **Liczby i statystyki**: każdą weryfikujesz. Źródło, dokładność, data, czy nie zaokrąglone mylnie (53% -> 53,37%).
- **Daty i wydarzenia**: update Google z marca 2026 -> sprawdź. Ustawa weszła w życie? Przejęcie firmy?
- **Nazwy własne**: firmy, produkty, osoby. "Vue Storefront" -> dziś "Alokai". CEO firmy X?
- **Cytaty i przypisania**: czy osoba to powiedziała? Czy raport Gartner istnieje?
- **Wersje, progi**: LCP 2.0s czy 2.5s? Node >=18 czy >=20?
- **Anachronizmy**: dane z 2022 podane jako "obecnie"? Próg który się zmienił?

Wzorzec: 2 zapytania per fakt (specyficzne + szerokie). Jeśli źródło cytowane wprost, weryfikuj oryginał.

### 2. Aktualność danych
- "Obecnie", "w 2026", "dziś" muszą mieć źródło z 12 miesięcy.
- Źródło >24 mc -> ryzyko, szukaj nowszego.
- AI/LLM, SEO, ceny SaaS, regulacje, frameworks -> niski próg tolerancji.

### 3. Prawda biznesowa i rynkowa
- **Ceny**: PL 2026 != USA 2024. USD->PLN po kursie to częsty błąd.
- **Segmenty**: "midmarket" w branży vs w tekście. "GMV 30 mln" kwalifikuje?
- **Czasy wdrożeń**: 8 tyg na headless Shopify B2C -> możliwe; 8 tyg na composable z ERP -> fantazja.
- **ROI**: marża vs przychód? Założenie utrzymania konwersji baseline?
- **Konkurencja**: uczciwie? Zniechęcające zdania bez konkretów -> flag.
- **Wielkości rynku**: 100 mld GMV vs obrót vs wartość ekonomiczna -> rzędy wielkości różne.

### 4. Prawda technologiczna
- Architektura, framework, protokół -> programista nie powinien się skrzywić.
- SSR vs SSG vs ISR, hydration vs prerendering, REST vs GraphQL, headless vs decoupled vs composable, OAuth vs SAML -> NIE myl.
- Limity techniczne aktualne (rate limity, throughput, max payload).
- Praktyki nie przestarzałe (AMP 2026?, jQuery jako "modern", FID po marcu 2024).
- Nie obiecuj cech których system nie ma.

### 5. Logika wewnętrzna
- Sprzeczności między sekcjami.
- Konsekwencja terminologiczna ("Headless commerce" vs "Headless" vs "headless").
- Wynikanie logiczne A+B -> C.
- Brakujące ogniwa "X = Y" bez kontekstu.
- Krzywe argumenty: straw man, false dichotomy, korelacja-jako-przyczynowość, cherry-picking, post hoc.
- "Wg ekspertów" / "badania pokazują" bez nazwiska -> flag.

### 6. Misleading framing i statystyczne manipulacje
- Procent z niejasnego mianownika ("wzrost 300%" - z czego).
- Średnia bez wariancji.
- Liczby bez baseline'u ("CTR spadł 61%" - z czego do czego).
- Wycinki ze źródła wyrwane z kontekstu.
- Korelacja jako przyczynowość.
- Selekcja na zwycięzcach (Rakuten/Vodafone bez wzmianki ile firm padło).
- Procent niedużej próby ("80% klientów" - z 5).
- Mylenie częstości z prawdopodobieństwem.

### 7. Cytowanie i atrybucja
- Źródła istnieją i mówią to co autor twierdzi?
- Linki działają i prowadzą do tego co autor twierdzi?
- Ghost cytaty (przypisanie nie do znalezienia).
- Parafrazy zbyt bliskie oryginałowi (plagiat strukturalny).
- Cudze liczby z brandem autora ("z naszych badań" gdy BrightEdge).
- Źródła niskiej jakości (blogi affiliate, content marketing) udające pierwotne.

### 8. Spójność danych w tekście
- Ta sama liczba w TL;DR/treści/FAQ.
- Ten sam termin definiowany raz, konsekwentnie używany.
- Te same widełki bez sprzeczności.
- Pisownia nazw bez literówek.
- PL/EN konsekwentnie ("headless commerce" vs "bezgłowy e-commerce" — bez mixu).

### 9. Dopasowanie do audiencji
- Rejestr językowy pasuje (C-suite != developer != marketer-początkujący).
- Brak protekcjonalności ("jak wszyscy wiedzą").
- Akronimy rozwinięte przy pierwszym użyciu.
- Bezpośredniość OK, lekceważenie NIE.
- Żargon zna tylko CTO -> CMO niekoniecznie.

### 10. Struktura i czytelność
- Nagłówki logiczne, nie dekoracyjne.
- TL;DR streszcza, nie obiecuje.
- Brak powtórzeń (ta sama myśl 3x).
- Konkluzja domyka tezę z otwarcia.
- Każda sekcja ma cel w jednym zdaniu.
- Tabele/listy pomagają, nie ozdoba.

### 11. Optymalizacja pod GEO (Generative Engine Optimization)
- **Definicje na początku**: kluczowy termin w pierwszych 100 słowach / TL;DR.
- **Answer-first**: pierwsze zdanie sekcji = odpowiedź, nie setup.
- **Encje**: nazwy firm/produktów wymienione (Storyblok, Next.js, BrightEdge), nie tylko zaimkowane.
- **Liczby i daty**: konkretne, z atrybucją źródła ("Według BrightEdge II 2026: 48%").
- **FAQ**: pełne pytania ("Czy headless poprawia SEO?", nie "Headless a SEO").
- **Tabele i listy**: strukturyzowane, stałe nagłówki.
- **Sourcing**: bibliografia na końcu, linki do oryginałów.

### 12. SEO podstawy (sygnały do raportu)
- Meta title/description sensowne?
- Hierarchia H1 -> H2 -> H3 bez skoków.
- Słowo kluczowe w 1. akapicie + 1-2 nagłówkach (naturalnie).
- URL slug sensowny.
- Internal linking jest?

### 13. Błędy stylistyczne i językowe
- Ortografia, interpunkcja, zgodność rodzajów/liczb.
- Wielkie litery (zawód "programista" - mała; "Programistów" tylko na początku zdania).
- Anglicyzmy nieuzasadnione ("dostarczać wartość", "ownership", "ASAP").
- Tikowe sformułowania content-marketingowe (patrz CZĘŚĆ II).
- Powtarzające się czasowniki, nadużywane łączniki ("ponadto", "co więcej").
- Zbędne zdania ozdobne.
- Przecinki przed "który", "że", "ponieważ".

### 14. Etyka i ryzyko prawne
- Nie obiecuj nie do zagwarantowania ("zwiększymy konwersję o 200%").
- Niejawna reklama bez ujawnienia partnerstwa.
- Zniesławienie konkurencji ("Firma X niewiarygodna").
- Prawa autorskie (fragmenty, screeny, cytaty).
- Doradztwo medyczne/finansowe/prawne — uważaj.
- Dane osobowe w przykładach bez zgody.

### 15. Wewnętrzna spójność z biznesem
- Linki do usług/ofert zgodne z tym co firma sprzedaje?
- CTA realistyczne (czas, cena, zakres)?
- Ton CTA pasuje do reszty?
- Sprzeczności: artykuł "Headless nie zawsze" + CTA "Wdróż Headless od ręki" -> NIE.

## CZĘŚĆ II — Polskie tiki content marketingowe (TNIJ / ZAMIEŃ NA KONKRET)

"Zanurzmy się w temat", "W erze cyfrowej transformacji", "W dzisiejszym dynamicznym świecie",
"Warto zauważyć, że", "Co istotne", "Co więcej", "Nie sposób przecenić", "Nie da się przecenić",
"Stanowi kluczowy element", "Odgrywa kluczową rolę", "Pozwala na osiągnięcie przewagi konkurencyjnej",
"Dostarczać wartość", "Skalowalne, elastyczne, przyszłościowe", "Game changer", "Must have", "No-brainer",
"Idealne rozwiązanie dla", "Pełne spektrum możliwości", "Bogata funkcjonalność", "Sprostać wymaganiom",
"Odpowiedzieć na potrzeby", "Cyfrowa rewolucja", "Era AI", "Wnosi na zupełnie nowy poziom",
"Synergiczne podejście", "End-to-end" (w polskim tekście).

Reguła: każdy z tych zwrotów -> ZAMIEŃ na konkretne stwierdzenie. NIE usuwaj samego zdania jeśli da się ratować.
Jeśli nie da się zamienić na konkret = zdanie nic nie mówi, można usunąć całe.

## CZĘŚĆ III — Wzorce weryfikacji web_search

**Liczba/statystyka:**
1. Dokładna liczba + kontekst ("48% AI Overviews queries 2026")
2. Nazwa źródła + temat ("BrightEdge AI Overviews 2026 study")
3. (opcjonalnie) Krytyka / alternatywne dane ("AI Overviews CTR study contradiction")

**Data/wydarzenie:**
1. Wydarzenie + rok ("Google March 2026 core update LCP")
2. Oficjalne źródło ("Google Search Central blog March 2026")

**Nazwisko/stanowisko:**
1. Imię nazwisko + stanowisko + firma + rok ("Sundar Pichai CEO Google 2026")
2. Świeżość — zmieniło się od artykułu?

**Nazwa produktu/firmy:**
1. Nazwa + status ("Vue Storefront rebrand Alokai")
2. Aktualna nazwa ("Alokai composable commerce 2026")

**Czego NIE weryfikujesz:**
- Powszechne fakty historyczne (II RP, "Pan Tadeusz")
- Stabilne definicje (HTTP, baza relacyjna)
- Subiektywne wartości ("dobry design")
- Wnioski autora (osobno oceniasz logikę)

**Źródło nie istnieje:**
1. Sprawdź literówkę.
2. Sprawdź zniekształconą wersję.
3. Jeśli dalej nie -> w raporcie: "Twierdzenie X przypisane do Y nie weryfikuje się przez web_search. Albo źródło nie istnieje, albo błędnie przypisane. Wymaga decyzji autora."

## CZĘŚĆ IV — Wzorce dobrych i złych poprawek

### Dobra faktograficzna
Oryginał: "CTR spadł o 61% z 1,41% do 0,64%."
Twoja: "CTR spadł o 65% z 1,76% do 0,61% (Seer Interactive, IX 2025, 25 mln impresji)."
Co zrobiłeś: uaktualniłeś, dodałeś źródło, dodałeś próbę.

### Zła faktograficzna (NIE rób)
Oryginał: "CTR spadł o 61% z 1,41% do 0,64%."
Zła: "Według różnych badań, CTR znacząco spadł, co potwierdzają liczne źródła."
Dlaczego: zastąpiłeś konkret generykiem, dodałeś hedge.

### Dobra stylistyczna
Oryginał: "Headless commerce to bez wątpienia game changer, kluczowy element nowoczesnego e-commerce."
Twoja: "Headless commerce daje to, czego monolit dać nie może: niezależną optymalizację frontu i backendu."
Co: wyciąłeś tiki, dałeś konkret.

### Zła stylistyczna (NIE rób)
Oryginał: "Headless commerce to bez wątpienia game changer..."
Zła: "Headless commerce to potencjalnie korzystne rozwiązanie..."
Dlaczego: rozcieńczyłeś, autor brzmi słabiej.

### Dobra decyzja: nie ruszać
Oryginał: "Jeden zły 301 potrafi wymazać 18 miesięcy SEO."
Decyzja: zostawiasz - mocne polemiczne zdanie, branżowa prawda, głos autora.

### Zła decyzja: nie ruszać niedokładności
Oryginał: "Google obniżył próg LCP do 2,5 sekundy w marcu 2026."
Decyzja: zostawiasz "bo wygląda OK".
Dlaczego: poprawny próg po marcu 2026 to 2,0s. Nie weryfikujesz - kompromitujesz autora.

## OSTATNIA NOTA
Praca audytora jest niewidoczna gdy dobrze wykonana. Autor dostaje brawa, ty spokój.
Cel: tekst nie ma błędów. NIE "zostawić swój ślad".
3-4 poprawki w raporcie = tekst był dobry. Nie szukaj problemów na siłę.
40 pozycji = tekst nie był gotowy do audytu, wraca do autora.
`;

const targets = [
  { name: 'humanizer.md', content: HUMANIZER },
  { name: 'fact-checker.md', content: FACT_CHECKER },
  { name: 'fact-checker-full.md', content: FACT_CHECKER_FULL },
];

for (const { name, content } of targets) {
  const path = join(DIR, name);
  const exists = existsSync(path);
  if (exists && !force) {
    const current = readFileSync(path, 'utf8');
    console.log(`[init] ${name} exists (${current.length} chars) — skip (use --force to overwrite)`);
    continue;
  }
  writeFileSync(path, content);
  console.log(`[init] ${exists ? 'overwrote' : 'created'} ${name} (${content.length} chars)`);
}
