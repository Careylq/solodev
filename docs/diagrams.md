# OnboardPilot — Architecture Diagrams

## 1. Context diagram

End-to-end data flow from the browser through the Next.js route handler, GitHub APIs, the raw-content circuit breaker, the five analyst agents, and DeepSeek back to the streamed UI.

```mermaid
graph TD
    Browser["Browser (app/page.tsx)"]

    subgraph Next_js ["Next.js (Node runtime)"]
        Route["POST /api/analyze\n(app/api/analyze/route.ts)"]
        Cache["In-memory context cache\n10-min TTL, 12-entry LRU"]
        RateLimit["Per-IP rate limiter\n25 req / 10 min"]
    end

    subgraph GitHub_APIs ["GitHub APIs"]
        GH_Meta["api.github.com\n/repos/owner/repo\n-- metadata + recursive tree\n(language mix derived from the tree)"]
        RAW["raw.githubusercontent.com\n-- file contents (primary)"]
        Contents["api.github.com\n/repos/owner/repo/contents\n-- file contents (fallback)"]
        Breaker["Circuit breaker\nrawHostDownUntil\n5-min cooldown"]
    end

    subgraph Agents ["Five analyst agents (parallel, lib/agents.ts)"]
        A1["Architecture Mapper"]
        A2["Entry-Point Detective"]
        A3["Convention and Risk Radar"]
        A4["First-Task Generator"]
        A5["Ramp-Up Planner"]
    end

    DeepSeek["api.deepseek.com\ndeepseek-chat model\n(lib/deepseek.ts)"]
    SSE["SSE stream\ntext/event-stream\nAnalyzeEvent frames"]

    Browser -->|POST repo| RateLimit
    RateLimit -->|pass| Route
    Route --> Cache
    Cache -->|miss| GH_Meta
    GH_Meta -->|RepoMeta + tree| Route
    Route --> Breaker
    Breaker -->|healthy| RAW
    RAW -->|timeout or error| Breaker
    Breaker -->|tripped| Contents
    Contents -->|RepoFile| Route
    Route -->|buildSystemPrompt| A1
    Route -->|buildSystemPrompt| A2
    Route -->|buildSystemPrompt| A3
    Route -->|buildSystemPrompt| A4
    Route -->|buildSystemPrompt| A5
    A1 -->|jsonCompletion| DeepSeek
    A2 -->|jsonCompletion| DeepSeek
    A3 -->|jsonCompletion| DeepSeek
    A4 -->|jsonCompletion| DeepSeek
    A5 -->|jsonCompletion| DeepSeek
    DeepSeek -->|JSON result| A1
    DeepSeek -->|JSON result| A2
    DeepSeek -->|JSON result| A3
    DeepSeek -->|JSON result| A4
    DeepSeek -->|JSON result| A5
    A1 -->|agent done event| SSE
    A2 -->|agent done event| SSE
    A3 -->|agent done event| SSE
    A4 -->|agent done event| SSE
    A5 -->|agent done event| SSE
    SSE -->|data frames| Browser
```

---

## 2. Sequence diagram — one full analysis request

Full lifecycle of a single POST request, including the per-agent error path and the client-disconnect abort via the `cancel()` handler.

```mermaid
sequenceDiagram
    actor Browser
    participant Route as POST /api/analyze
    participant Cache as Context cache
    participant GH as GitHub API
    participant RAW as raw.githubusercontent.com
    participant DS as DeepSeek API
    participant SSE as SSE stream

    Browser->>Route: POST {repo}
    Route->>Route: rate-limit check
    Route->>Cache: lookup repo key
    alt cache hit
        Cache-->>Route: RepoContext
    else cache miss
        Route->>GH: GET /repos/{owner}/{repo}
        GH-->>Route: RepoMeta
        Route->>GH: GET git/trees/{sha}?recursive=1
        GH-->>Route: file tree
        loop each key file
            Route->>RAW: GET file content
            alt raw host healthy
                RAW-->>Route: file content
            else circuit breaker tripped
                Route->>GH: GET /repos/{owner}/{repo}/contents/{path}
                GH-->>Route: file content
            end
        end
        Route->>Cache: store RepoContext
    end
    Route->>SSE: stage: fetching
    Route->>SSE: stage: reading
    Route->>SSE: context event (meta + stats)
    Route->>SSE: stage: analyzing

    par five agents in parallel
        Route->>DS: agent=architecture
        Route->>SSE: agent{architecture, running}
        DS-->>Route: JSON result
        Route->>SSE: agent{architecture, done, data}
    and
        Route->>DS: agent=entrypoints
        Route->>SSE: agent{entrypoints, running}
        DS-->>Route: JSON result
        Route->>SSE: agent{entrypoints, done, data}
    and
        Route->>DS: agent=conventions
        Route->>SSE: agent{conventions, running}
        alt DeepSeek error
            DS-->>Route: HTTP error or timeout
            Route->>SSE: agent{conventions, error, message}
        else success
            DS-->>Route: JSON result
            Route->>SSE: agent{conventions, done, data}
        end
    and
        Route->>DS: agent=firstTasks
        Route->>SSE: agent{firstTasks, running}
        DS-->>Route: JSON result
        Route->>SSE: agent{firstTasks, done, data}
    and
        Route->>DS: agent=onboarding
        Route->>SSE: agent{onboarding, running}
        DS-->>Route: JSON result
        Route->>SSE: agent{onboarding, done, data}
    end

    alt browser still connected
        Route->>SSE: done event (totalMs, tokens)
        SSE-->>Browser: stream closed normally
    else browser disconnects early
        Browser->>SSE: connection dropped
        SSE->>Route: cancel() called
        Route->>DS: AbortController.abort()
        Note over Route,DS: in-flight DeepSeek fetches terminated
    end
```

---

## 3. Component diagram — lib/ and components/

Responsibilities of every module in `lib/` and `components/`, and the import edges between them.

```mermaid
graph LR
    subgraph lib ["lib/"]
        types["types.ts\nShared domain types:\nRepoContext, AgentId,\nAnalyzeEvent, Report"]
        github["github.ts\nGitHub API client:\nparse repo URL, fetch tree,\nread files, circuit breaker,\nscore and rank files"]
        deepseek["deepseek.ts\nDeepSeek API client:\njsonCompletion with retry,\nloose JSON parser,\ntruncation repair"]
        agentMeta["agentMeta.ts\nClient-safe agent metadata:\ntitles, subtitles, accents\n(no server imports)"]
        agents["agents.ts\nAgent orchestrator:\nbuildSystemPrompt, runAgent,\nfive PROMPTS definitions"]
        markdown["markdown.ts\nMarkdown serialiser:\nbuildOnboardingMarkdown\nfor downloadable ONBOARDING.md"]
    end

    subgraph components ["components/"]
        AgentBoard["AgentBoard.tsx\nAgent status grid:\nqueued / running / done / error\nper-agent retry button"]
        ReportView["ReportView.tsx\nFull report renderer:\narchitecture, entry points,\nconventions, tasks, plan,\nevidence index"]
    end

    subgraph app ["app/"]
        Page["page.tsx\nRoot client page:\nSSE consumer, state machine,\ndownload buttons, deep-link support"]
        Route["api/analyze/route.ts\nSSE route handler:\ncache, rate limiter,\ncontext loader, agent fan-out"]
    end

    agents --> types
    agents --> agentMeta
    agents --> deepseek
    github --> types
    markdown --> types
    AgentBoard --> agentMeta
    AgentBoard --> types
    ReportView --> types
    Page --> AgentBoard
    Page --> ReportView
    Page --> agentMeta
    Page --> markdown
    Page --> types
    Route --> agents
    Route --> github
    Route --> types
```

---

## 4. State diagram — single analyst agent lifecycle

State machine for one agent from the moment the route handler starts processing until it is done,
errors out, or is retried from the UI. Client-disconnect handling is server-side only (see diagram 2):
the route aborts its in-flight requests and drops those agents silently, because the browser that
would have rendered their state is already gone.

```mermaid
stateDiagram-v2
    [*] --> queued : route handler starts\n(all agents initialised)

    queued --> running : Promise.all fan-out\nreaches this agent

    running --> done : DeepSeek returns valid JSON\nand agent event is sent

    running --> error : DeepSeek throws\n(HTTP error, timeout,\nbad JSON after retry)

    queued --> error : SSE stream ends before this agent starts\n("Stream ended without a result")
    running --> error : SSE stream ends before this agent finishes\n("Stream ended without a result")

    error --> running : user clicks\nRetry this agent\n(page.tsx -> analyze(repo, id))

    done --> [*]
    error --> [*] : user does not retry
```

---

## 5. State diagram — raw-content fetch circuit breaker

State machine for `rawHostDownUntil` in `lib/github.ts` that prevents all parallel file fetches from paying the full 5-second timeout when `raw.githubusercontent.com` is unreachable.

```mermaid
stateDiagram-v2
    [*] --> healthy : module loaded\nrawHostDownUntil = 0

    healthy --> healthy : fetch succeeds\n(200 OK returned)

    healthy --> tripped : transport error\nor 429 / 5xx response\nrawHostDownUntil = now + 5 min

    tripped --> cooling : any file fetch attempted\nnull returned immediately\n(raw host skipped)

    cooling --> healthy : Date.now() >= rawHostDownUntil\n(cooldown expired)\nnext fetch tries raw host again
```
