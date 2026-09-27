# Hardening Plan — five confirmed code-review findings

## Overview

Five targeted bug fixes across four files. No refactoring, no new features. Each fix is
independent and can be reviewed in isolation. After all edits, `npx tsc --noEmit` and
`npx eslint .` must pass clean.

---

## Sub-task 1 — Fix double-counted usage tokens in `lib/deepseek.ts`

**Status:** [ ] pending

**Intent**  
The shared `usage` object (passed in by the caller) is mutated inside the retry loop
*before* the `finish_reason === 'length'` check throws. If the first attempt truncates and a
second attempt runs, the first attempt's tokens are already written to `usage`. When the
second attempt then also writes its tokens, the caller sees `attempt1 + attempt2` but the
first attempt's result was discarded — its tokens were wasted, not accumulated correctly.

**Fix**  
Move the `usage.prompt +=` / `usage.completion +=` lines to *after* the successful parse
(i.e. after `return parseJsonLoose`). That way tokens are only added to the caller's
object when the attempt actually produced a usable result.

**Expected Outcomes**  
- A retried call accumulates only the successful attempt's tokens in the caller's `usage`.  
- No behaviour change when the first attempt succeeds.

**Relevant Context**  
- [`lib/deepseek.ts`](lib/deepseek.ts) lines 204–217: the `usage` mutation and
  `finish_reason` throw are adjacent; move the mutation below the throw.

---

## Sub-task 2 — Reduce `maxTokens` on retry in `lib/deepseek.ts`

**Status:** [ ] pending

**Intent**  
The retry after a `finish_reason === 'length'` truncation reuses the same `maxTokens`
value, so the retry can truncate again for exactly the same reason. The instruction to
"answer more compactly" is already in the retry prompt, but the budget must also shrink.

**Fix**  
When `attempt === 1` pass `max_tokens: Math.round(maxTokens * 0.6)` instead of `maxTokens`.

**Expected Outcomes**  
- Retry sends 60 % of the original token budget.  
- First attempt is unaffected.

**Relevant Context**  
- [`lib/deepseek.ts`](lib/deepseek.ts) line 188: `max_tokens: maxTokens` in the fetch body.

**Constraint**  
Do NOT touch `repairTruncatedObject`. Add a short comment near it recording that the
stale-container-stack risk after truncation is known and deliberately deferred.

---

## Sub-task 3 — Escape model output in GFM table cells and backtick spans (`lib/markdown.ts`)

**Status:** [ ] pending

**Intent**  
Model output is interpolated directly into GFM table cells and inline code spans. A `|`
in a file path breaks the column boundary; a backtick in a value closes an inline code
span early and garbles the rest of the cell.

**Fix**  
Add a two-function escaping layer:

- `escCell(s)` — calls `line(s)` then replaces every `|` with `\|`.  
- `escCode(s)` — calls `line(s)` then replaces every `` ` `` with `\``.

Apply `escCell` to every value that is placed *directly inside a `|…|` table cell boundary*
(i.e. the bare text portions, not the surrounding pipe characters).
Apply `escCode` to every value wrapped in a backtick span (`` `${…}` ``).

Backtick escaping strategy: replace each `` ` `` with `\`` (backslash-backtick, standard GFM).
All existing call sites in the file use one of these two patterns so no other escaping is
needed.

**Expected Outcomes**  
- A path like `src/lib/a|b.ts` renders as a single column value.  
- A value containing a backtick does not break inline code spans.

**Relevant Context**  
- [`lib/markdown.ts`](lib/markdown.ts): all GFM table rows and all `` `${line(f)}` ``
  patterns throughout the file.

---

## Sub-task 4 — Move orphaned agent statuses to `error` after stream closes (`app/page.tsx`)

**Status:** [ ] pending

**Intent**  
If the SSE stream closes without a `done` event (server crash, Vercel timeout), agents
still in `running` or `queued` state stay that way forever. The retry button only renders
for the `error` state, so those agents are stuck with no recovery path.

**Fix**
Immediately after the `for (;;)` read loop exits, call `setStatuses` and for every entry
whose state is `'running'` or `'queued'`, replace it with
`{ state: 'error', error: 'Stream ended without a result' }`.
This cleanup applies to both full runs and single-agent retries (`only` set).

**Expected Outcomes**
- Any agent that did not receive a result transitions to `error`.
- The existing per-agent retry button becomes available for those agents.
- No change when the stream closes normally (all agents already `done` or `error`).

**Relevant Context**  
- [`app/page.tsx`](app/page.tsx) lines 142–157: the SSE read loop.  
- [`app/page.tsx`](app/page.tsx) lines 159–164: the scroll-into-view call that follows —
  the new `setStatuses` call goes between the loop and the scroll.

---

## Sub-task 5 — Remove `nodeVersion` and `uptimeSeconds` from health endpoint (`app/api/health/route.ts`)

**Status:** [ ] pending

**Intent**  
Neither field is needed by a readiness probe. Both leak server fingerprinting information
to unauthenticated callers.

**Fix**  
Delete the `uptimeSeconds` and `nodeVersion` lines from the `Response.json(…)` object.
The `STARTED_AT` constant becomes unused; remove it too.

**Expected Outcomes**  
- `GET /api/health` no longer returns those two fields.  
- `STARTED_AT` is removed (no unused-variable lint warning).

**Relevant Context**  
- [`app/api/health/route.ts`](app/api/health/route.ts) lines 17, 69–70.

---

## Sub-task 6 — Validate with `tsc` and `eslint`

**Status:** [ ] pending

**Intent**  
Confirm that none of the edits introduced type errors or lint violations.

**Steps**  
1. `npx tsc --noEmit`  
2. `npx eslint .`  
3. Fix any new errors (not pre-existing ones) before marking complete.
