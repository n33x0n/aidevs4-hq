# AI_devs 4 HQ — Agent Template

Starter template agenta zbudowanego podczas kursu **[AI_devs 4: Builders](https://aidevs.pl)**.

Zawiera gotową infrastrukturę — interfejs, obsługę modeli LLM, SSE streaming, integrację z Hub API — bez rozwiązań zadań. Każde zadanie ma pusty solver z TODO do zaimplementowania.

## Stack

- **[Astro 5](https://astro.build)** — SSR framework
- **[React 19](https://react.dev)** — wyspy interaktywne
- **[Tailwind CSS v4](https://tailwindcss.com)** — styling
- **[OpenRouter](https://openrouter.ai)** — dostęp do modeli LLM (GPT-4o, Gemini, Claude...)
- **[Langfuse](https://langfuse.com)** — observability wywołań LLM
- **TypeScript** — pełne typowanie

## Uruchomienie

```bash
# 1. Sklonuj repozytorium
git clone https://github.com/n33x0n/aidevs4-hq.git
cd aidevs4-hq

# 2. Zainstaluj zależności
npm install

# 3. Skonfiguruj zmienne środowiskowe
cp .env.example .env
# Uzupełnij .env swoimi kluczami API

# 4. Uruchom dev server
npm run dev -- --port 31337
```

Otwórz [http://localhost:31337](http://localhost:31337).

## Struktura projektu

```
src/
  components/       # UI — AgentPanel, NavHeader, FlagText, DashboardPanel...
  lib/              # Biblioteki pomocnicze
    llm.ts          # Klient OpenRouter (OpenAI SDK)
    hub.ts          # submitAnswer() i fetchData() do Hub API
    azyl.ts         # SSH do Azyl VPS
    sse.ts          # Server-Sent Events utility
    hub-db.ts       # SQLite — logowanie odpowiedzi Huba
    task-registry.ts # Rejestr zadań
  pages/
    api/tasks/      # Endpointy SSE dla każdego zadania
  tasks/            # Solvery — tu implementujesz rozwiązania
    people/solver.ts
    findhim/solver.ts
    # ... (25 zadań)
  styles/           # Tailwind + global CSS
data/               # Dane zadań pobrane z Hub API (gitignored)
```

## Jak dodać solver

Każde zadanie ma plik `src/tasks/<nazwa>/solver.ts` z pustym szkieletem:

```typescript
export async function solveMainTask(onStep: StepCallback): Promise<{ flag?: string }> {
  onStep('TODO: implement');
  return {};
}
```

Zaimplementuj logikę, a endpoint SSE w `src/pages/api/tasks/<nazwa>.ts` automatycznie ją wywoła i wyświetli logi w terminalu UI.

## Wymagane klucze API

| Klucz | Do czego |
|-------|----------|
| `AIDEVS_API_KEY` | Weryfikacja odpowiedzi na hub.ag3nts.org |
| `OPENROUTER_API_KEY` | Wywołania LLM przez OpenRouter |

Pozostałe klucze w `.env.example` są opcjonalne i potrzebne tylko dla konkretnych zadań.

---

Kurs: [aidevs.pl](https://aidevs.pl)
