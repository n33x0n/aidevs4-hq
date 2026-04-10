export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  endpoint: string;
}

export interface TaskResult {
  success: boolean;
  flag?: string;
  message: string;
  data?: unknown;
}

const tasks: Map<string, TaskDefinition> = new Map();

export function registerTask(task: TaskDefinition) {
  tasks.set(task.id, task);
}

export function getTask(id: string): TaskDefinition | undefined {
  return tasks.get(id);
}

export function getAllTasks(): TaskDefinition[] {
  return Array.from(tasks.values());
}

export function ensureTasksRegistered() {
  if (tasks.size === 0) {
    registerTask({
      id: 'people',
      name: 'S01E01 — People — Transport',
      description: 'Pobierz listę osób z CSV, przefiltruj wg kryteriów (mężczyźni 20-40 lat, Grudziądz), otaguj zawody przez LLM i znajdź osoby z tagiem "transport".',
      endpoint: '/api/tasks/people',
    });
    registerTask({
      id: 'findhim',
      name: 'S01E02 — FindHim — Function Calling',
      description: 'Namierz podejrzanego z S01E01, który przebywał blisko elektrowni atomowej. Agent używa Function Calling do iteracyjnego sprawdzania lokalizacji i poziomu dostępu.',
      endpoint: '/api/tasks/findhim',
    });
    registerTask({
      id: 'proxy',
      name: 'S01E03 — Proxy — Konwersacyjny asystent logistyczny',
      description: 'Deployuj serwer proxy na Azyl. Serwer prowadzi konwersacje z operatorem systemu logistycznego, obsługuje paczki przez API i potajemnie przekierowuje paczki z paliwem reaktora do Żarnowca (PWR6132PL).',
      endpoint: '/api/tasks/proxy',
    });
    registerTask({
      id: 'sendit-llm',
      name: 'S01E04 — SendIt — Deklaracja transportu SPK',
      description: 'LLM analizuje dokumentację SPK i samodzielnie wypełnia deklarację transportową. Pobiera docs z Huba, wysyła do modelu, model rozumuje o kategorii/trasie/wagonach/opłatach.',
      endpoint: '/api/tasks/sendit-llm',
    });
    registerTask({
      id: 'railway',
      name: 'S01E05 — Railway — Aktywacja trasy',
      description: 'Aktywuj trasę kolejową X-01 przez samo-dokumentujące API. Sekwencja: reconfigure → setstatus(RTOPEN) → save. Obsługa 503 i rate-limitów.',
      endpoint: '/api/tasks/railway',
    });
    registerTask({
      id: 'categorize',
      name: 'S02E01 — Categorize — Klasyfikacja towarów',
      description: 'Sklasyfikuj 10 towarów jako DNG/NEU w budżecie 1.5 PP. Prompt caching, reactor→NEU. Sekret: kolejność J-D-I-B-A-C-G-E-H-F.',
      endpoint: '/api/tasks/categorize',
    });
    registerTask({
      id: 'electricity',
      name: 'S02E02 — Electricity — Puzzle kabli',
      description: 'Puzzle 3x3 — obracaj kafelki aby kable pasowały (perfect matching). Sekret: metadane PNG (tEXt chunk).',
      endpoint: '/api/tasks/electricity',
    });
    registerTask({
      id: 'failure',
      name: 'S02E03 — Failure — Kompresja logów',
      description: 'Skompresuj logi elektrowni do <1500 tokenów zachowując zdarzenia krytyczne. Iteracyjna optymalizacja z feedbackiem hub.',
      endpoint: '/api/tasks/failure',
    });
    registerTask({
      id: 'mailbox',
      name: 'S02E04 — Mailbox — Przeszukiwanie skrzynki',
      description: 'Przeszukaj skrzynkę operatora Systemu przez API zmail. Znajdź datę ataku, hasło i kod SEC z ticketa. Sekret: GADERYPOLUKI w ZIP.',
      endpoint: '/api/tasks/mailbox',
    });
    registerTask({
      id: 'drone',
      name: 'S02E05 — Drone — Bombardowanie tamy',
      description: 'Steruj dronem DRN-BMB7 przez API. Vision analizuje mapę → sektor tamy, agent loop buduje instrukcje. Sekret: balon w Radomiu.',
      endpoint: '/api/tasks/drone',
    });
    registerTask({
      id: 'evaluation',
      name: 'S03E01 — Evaluation — Anomalie sensorów',
      description: 'Analiza 9999 odczytów sensorów elektrowni. Programistyczna walidacja zakresów + LLM klasyfikacja notatek operatora. Sekret: AWK decode na pliku 2137.',
      endpoint: '/api/tasks/evaluation',
    });
    registerTask({
      id: 'firmware',
      name: 'S03E02 — Firmware — ECCS Cooling System',
      description: 'Napraw firmware sterownika ECCS na maszynie wirtualnej. Shell API, settings.ini, lock file. Sekret: /bin/flaggengenerator + schmetterling.',
      endpoint: '/api/tasks/firmware',
    });
    registerTask({
      id: 'reactor',
      name: 'S03E03 — Reactor — Nawigacja robota',
      description: 'Przeprowadź robota z modułem chłodzącym przez rdzeń reaktora. Plansza 7×5, bloki cykliczne. Symulacja ruchu bloków + greedy pathfinding.',
      endpoint: '/api/tasks/reactor',
    });
    registerTask({
      id: 'negotiations',
      name: 'S03E04 — Negotiations — Narzędzia dla agenta',
      description: 'Zbuduj 1-2 narzędzia API do wyszukiwania przedmiotów w miastach. Agent hub szuka 3 komponentów turbiny wiatrowej. Sekret: wyciągnij flagę z briefingu agenta przez tool #2 params.',
      endpoint: '/api/tasks/negotiations',
    });
    registerTask({
      id: 'savethem',
      name: 'S03E05 — SaveThem — Trasa do Skolwin',
      description: 'Zaplanuj optymalną trasę posłańca do Skolwin. Mapa 10×10, pojazdy (rocket/car/horse/walk), 10 fuel + 10 food. BFS + optymalizacja zasobów. Sekret: bobry w preview JS.',
      endpoint: '/api/tasks/savethem',
    });
    registerTask({
      id: 'okoeditor',
      name: 'S04E01 — OKO Editor — Modyfikacja centrum monitoringu',
      description: 'Zatrzyj ślady po rakiecie w OKO: zmień klasyfikację Skolwin (MOVE04), oznacz zadanie done, dodaj incydent Komarowo. Sekret: SHA256(poeci) → ukryci userzy → rozdarty bilet.',
      endpoint: '/api/tasks/okoeditor',
    });
    registerTask({
      id: 'windpower',
      name: 'S04E02 — WindPower — Turbina wiatrowa',
      description: 'Zaprogramuj harmonogram turbiny w 40s. Analiza pogody → burze (idle/90°) + produkcja (production/0°). Async API + parallel unlock codes.',
      endpoint: '/api/tasks/windpower',
    });
    registerTask({
      id: 'domatowo',
      name: 'S04E03 — Domatowo — Misja ratunkowa',
      description: 'Odnajdź partyzanta w ruinach Domatowa. Mapa 11×11, transportery+zwiadowcy, 300 AP. B3 = najwyższe bloki. Sekret: Take Me to Church → Vigenère(BLAISE) → ROT13 → mp4 → NATO → MD5.',
      endpoint: '/api/tasks/domatowo',
    });
    registerTask({
      id: 'filesystem',
      name: 'S04E04 — Filesystem — Notatki handlowe',
      description: 'Uporządkuj notatki Natana w /miasta (JSON z potrzebami), /osoby (linki do miast), /towary (linki do sprzedawców). Batch mode. Sekret: print(*map(ord,"FLAG")) w /flag/.',
      endpoint: '/api/tasks/filesystem',
    });
    registerTask({
      id: 'foodwarehouse',
      name: 'S04E05 — FoodWarehouse — Zamówienia magazynowe',
      description: 'Utwórz zamówienia dla 8 miast z food4cities.json. SQLite → destinations + users → signatures → orders + items → done. Sekret: Vibe Coder (role=6) name_surname = gzipped base64 flag.',
      endpoint: '/api/tasks/foodwarehouse',
    });
    registerTask({
      id: 'radiomonitoring',
      name: 'S05E01 — RadioMonitoring — Nasłuch radiowy',
      description: 'Nasłuchuj sygnałów radiowych, filtruj szum, dekoduj binarne (JSON/CSV/obrazy/audio/Morse). Syjon=Skarszewy. Sekret: Morse→/DEEPER→szyfr Caesar→DIWBU.',
      endpoint: '/api/tasks/radiomonitoring',
    });
    registerTask({
      id: 'phonecall',
      name: 'S05E02 — PhoneCall — Rozmowa z operatorem',
      description: 'Wieloetapowa rozmowa audio z operatorem systemu OKO. TTS+STT przez ElevenLabs. Cel: ustal przejezdną drogę (RD224/RD472/RD820) i wyłącz monitoring. Hasło: BARBAKAN. Tymon Gajewski, transport żywności do bazy Zygfryda.',
      endpoint: '/api/tasks/phonecall',
    });
    registerTask({
      id: 'shellaccess',
      name: 'S05E03 — ShellAccess — Archiwum Czasu',
      description: 'Eksploruj archiwum czasu na serwerze przez Shell API (grep/jq). Znajdź datę, miasto i GPS gdzie znaleziono Rafała. Odpowiedź: JSON z datą dzień PRZED znalezieniem. Sekret: tar GTFOBins (sudo /bin/tar) → /usr/local/share/flaga.txt.',
      endpoint: '/api/tasks/shellaccess',
    });
    registerTask({
      id: 'goingthere',
      name: 'S05E04 — GoingThere — Nawigacja rakietą',
      description: 'Poleciej rakietą przez siatkę 3×12 do bazy w Grudziądzu. Używaj skanera OKO (frequencyScanner) do wykrywania pułapek, getmessage do wskazówek o skałach. disarmHash = SHA1(detectionCode + "disarm"). Sekret: "Trzy groby 642".',
      endpoint: '/api/tasks/goingthere',
    });
    registerTask({
      id: 'timetravel',
      name: 'S05E05 — TimeTravel — Maszyna czasu CHRONOS-P1',
      description: 'Steruj kieszonkową maszyną czasu CHRONOS-P1. Skocz do 2238 po baterie, wróć do dziś, tunel do 2024. SyncRatio=(d*8+m*12+y*7)%101/100. Stabilization z needConfig (polski tekst). PWR z tabeli. Sekret: Marty McFly.',
      endpoint: '/api/tasks/timetravel',
    });
  }
}
