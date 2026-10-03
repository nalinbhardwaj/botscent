# Performance

What the page half costs a page, measured in a real browser against the same page without it. `npm run perf` reproduces every number here, and CI's `perf` job fails when one leaves its budget ([`test/perf/budgets.json`](../test/perf/budgets.json)). The bytes are gated separately by `scripts/size.ts`.

## In short

On the reference device (defined below; roughly a budget phone's CPU), against the same page without the library:

| What                               | Measured                                                                   | Plan (section 8.7, principle 5)              |
| ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Start-up: the script and `start()` | **4.6–5.5 ms**                                                             | under 2 ms: **not met**                      |
| Long tasks                         | none                                                                       | none: met                                    |
| First paint and LCP, light page    | **+4 ms** (the paint waits for start-up)                                   | measured, no number                          |
| First paint and LCP, heavy page    | no change                                                                  | measured, no number                          |
| CLS                                | no change (0)                                                              | no DOM writes: met                           |
| Work per trusted input             | 0.010–0.018 ms median; 0.24–0.58 ms at the 95th percentile (a marker read) | microseconds: met except the marker read     |
| INP, scripted visit                | no change                                                                  | measured, no number                          |
| Idle, visible                      | 8 callbacks in 30 s, 1.1–2.4 ms in all                                     | nothing beyond the triggers: met             |
| Idle, hidden                       | 6 callbacks in 30 s, no DOM reads                                          | the slow sample runs only while visible: met |
| DOM churn, every frame             | 0.74–0.89 ms per second; the 250 ms debounce holds at 4 reads a second     | met                                          |
| A day left open                    | 17,280 callbacks; heap 103 KB at rest, no growth after the JIT settles     | met                                          |
| Requests, storage, DOM writes      | none                                                                       | none: met                                    |

Start-up does no work for the two cloud-browser rules. Muse's renderer read happens only after its other clauses match, in a later task. Grok Bot's computer check runs once at the first idle moment (within 300 ms), and on any machine other than a Linux x86_64 Chrome 139 or later it returns after reading the platform and the user agent. Neither reads the time zone or the renderer on a person's machine; see [History](#history).

## Method

### The reference device and calibration

Times depend on the machine, so every Chromium measurement runs with the CPU throttled through the DevTools protocol (`Emulation.setCPUThrottlingRate`). The **reference device** is the reference machine (an Apple M3 Max) throttled 4x, the slowdown Lighthouse applies for its mobile profile. In single-thread speed that is roughly a budget Android phone, slower than the plan's "mid-range phone".

Other machines emulate the same device. Before measuring, the harness times a fixed workload (object and descriptor work, function source reads, building 6,000 elements and an attribute query) unthrottled, in nine fresh documents. It then throttles by `4 × 7.0 ms / its own median`. On the reference machine that comes to 3.7x–4.2x between runs, because the calibration itself varies by about ±5%. A CI runner twice as slow throttles about 2x. Calibration evens out CPU speed; it cannot make a laptop into a phone (no thermal limits, memory bandwidth or storage differences), so the budgets keep headroom for that.

### Attribution

Each load is traced (`devtools.timeline`, `toplevel`, `v8.execute`, `loading`). Library time is read from the trace by script URL: the library's `EvaluateScript` (compile, module evaluation and the synchronous `start()`) and every `FunctionCall` into its code (timer, idle, observer and listener callbacks), less any call into another script nested inside it. Tracing with these categories adds no measurable time: the in-page timing of the same work agrees with the trace within 1 ms at 4x.

### The pages

- **article**: a small static page, 30 paragraphs, a hero image (the LCP element), a search box that filters a 200-item list, and a button that adds a row.
- **feed**: a heavier page, about 10,000 nodes. On every animation frame it adds a toast under `<body>` and removes the last one (churn the library's observer watches), and every 100 ms it updates text deep in the tree (churn it does not watch).

The library is installed as the README says, `<script defer src="/botscent.js">`, from the built `dist/botscent.js`. The "without" variant is the same page without that tag. Chromium runs with `--disable-blink-features=AutomationControlled`, so `navigator.webdriver` is false and the library takes the path it takes for a person: no evidence, no verdict change.

### The measurements

- **Page loads** (11 per page and variant, interleaved, alternating which goes first, each in a fresh browser context after one warm-up load):
  - start-up attribution, and the task that contains it;
  - long tasks: a load counts when its task exceeds 50 ms and would not without the library's share;
  - FCP, LCP and CLS from `PerformanceObserver`;
  - every request the page made;
  - every DOM change from the start of the document (each node added or removed, each attribute and text change), compared between variants less the script element itself;
  - the script request's render-blocking status.
- **Cold start** (5 browser launches): the same start-up attribution in the first document of a new browser.
- **Input** (5 scripted visits per page and variant): 8 clicks on the button, typing 9 characters into the search box, 5 wheel scrolls and 4 clicks on text, all trusted input sent through CDP. The trace gives the library's time inside each `pointerdown`, `keydown`, `input` and `wheel` dispatch. Event Timing (`durationThreshold: 16`) gives the worst interaction, which is INP for fewer than 50 interactions.
- **DOM churn** (2 windows of 10 s per variant, 2 s after load): observer callbacks, timer runs and library time on the feed.
- **Idle** (one browser over raw CDP, because Playwright keeps every page visible): the article page with the library for 30 s visible from navigation, then 30 s hidden behind a second tab in the same window. The harness counts library callbacks and their time, and document queries (`getElementById`, `querySelector` and `querySelectorAll` on `Document`, counted by an init script; the page makes none of its own while idle). It also records every request and, at the end, localStorage, sessionStorage, cookies, IndexedDB and Cache Storage.
- **A day left open** (one page per variant): every interval the page sets is recorded, and each callback is called as often as it would fire in 24 hours (17,280 times for a 5 s interval), four times over. After each simulated day the heap is read after a forced collection, along with the document's listeners. Running the real callback without waiting is fast (seconds, against 78 s for Playwright's fake clock). It does not model the browser throttling timers over hours, which only reduces the work.
- **Other engines** (record only): the script inserted as an inline script into the article page in fresh contexts, timed with `performance.now()`, unthrottled. Only Chromium can throttle, and Firefox and WebKit report time in whole milliseconds here.

Every figure is a median. The table shows the interquartile range as the spread, and `--json` writes every sample.

## Results

Reference machine: Apple M3 Max, macOS 26.1, Node 24.13, Playwright 1.63 (Chromium 153.0.8010.12). Two full runs on 4 October 2026 at library commit b41f405, each about 5 minutes. The values are the first run's; the range is over both.

| Metric                                                     | Run 1                | Range over 2 runs                 | Budget             |
| ---------------------------------------------------------- | -------------------- | --------------------------------- | ------------------ |
| calibration workload, unthrottled (throttle applied)       | 6.7 ms (4.18x)       | 6.7–6.9 ms (4.06x–4.18x)          |                    |
| article: start-up                                          | 4.78 ms              | 4.63–4.78                         | ≤ 12               |
| feed: start-up                                             | 5.29 ms              | 5.29–5.47                         | ≤ 12               |
| article: start-up, a new browser's first document          | 5.05 ms              | 4.67–5.05                         | ≤ 12               |
| article: the task that contains it                         | 30.2 ms              | 28.9–30.2                         | record             |
| article: loads where the library makes a long task         | 0 of 11              | 0                                 | = 0                |
| feed: the task that contains it                            | 19.2 ms              | 8.9–19.2                          | record             |
| feed: loads where the library makes a long task            | 0 of 11              | 0                                 | = 0                |
| article: library time in the next second                   | 0.12 ms              | 0.10–0.12                         | ≤ 1                |
| feed: library time in the next second                      | 1.89 ms              | 1.89–2.21                         | ≤ 8                |
| article: LCP (= FCP), without → with                       | 64 → 68 ms (+4)      | +4                                | ≤ +16              |
| feed: LCP (= FCP), without → with                          | 196 → 192 ms (−4)    | −4 to 0                           | ≤ +16              |
| CLS added, both pages                                      | 0                    | 0                                 | = 0                |
| article: DOM changes added                                 | 0                    | 0                                 | = 0                |
| requests made by the library                               | 0                    | 0                                 | = 0                |
| script tag render-blocking                                 | non_blocking         | same                              | = non_blocking     |
| article: library time per trusted input (median, p95, max) | 0.018, 0.58, 1.02 ms | median 0.018, p95 0.24–0.58       | ≤ 0.1, p95 ≤ 2     |
| feed: library time per trusted input (median, p95, max)    | 0.012, 0.48, 0.93 ms | median 0.010–0.012, p95 0.36–0.48 | ≤ 0.1, p95 ≤ 2     |
| the page's own click handling, for scale                   | 0.04 ms              | 0.03–0.04                         |                    |
| INP added (both pages)                                     | −8 ms                | −8 to 0                           | ≤ +16              |
| feed churn: library time per second                        | 0.89 ms/s            | 0.74–0.89                         | ≤ 6                |
| feed churn: observer callbacks per second                  | 60                   | 60                                |                    |
| feed churn: debounced reads per second                     | 4.05 (0.16 ms each)  | 4.05 (0.11–0.16 ms)               | ≤ 4.5              |
| idle visible 30 s: callbacks / time / DOM queries          | 7 + 1 / 1.1 ms / 42  | 7 + 1 / 1.1–2.4 / 42              | ≤ 8 / ≤ 10 / ≤ 48  |
| idle hidden 30 s: callbacks / time / DOM queries           | 6 / 6.9 ms / 0       | 6 / 6.9–10.9 / 0                  | ≤ 7 / record / = 0 |
| requests after load, 60 s idle                             | 0                    | 0                                 | = 0                |
| storage written                                            | 0                    | 0                                 | = 0                |
| idle day: interval callbacks (DOM queries)                 | 17,280 (103,680)     | same                              | ≤ 17,280           |
| heap the library holds at rest                             | 103 KB               | 103                               | ≤ 160              |
| heap growth added, days 1–2 / day 4                        | 15.0 / 1.2 KB        | same                              | ≤ 48 / ≤ 8         |
| listeners on the document, all day                         | 6, unchanged         | same                              | added or lost = 0  |
| Chromium / Firefox / WebKit start-up, unthrottled          | 1.3 / 2 / 1 ms       | 1.3 / 2–3 / 1–2                   | record             |
| `dist/botscent.js` gzipped                                 | 5,602 B              |                                   | `scripts/size.ts`  |

Every budget held in both runs, and every count (callbacks, queries, requests, writes, listeners) was the same in both. The visible idle minute has one callback beyond the seven timers: the idle callback that runs the Grok Bot check, which returns at the host check here. Idle DOM queries are the six Claude ids per marker read; the badge queries are made on `<head>`, an element, and are not counted.

## Findings

### 1. Start-up is spread thin

At 4.6–5.5 ms on the reference device (1.3 ms unthrottled), start-up has no single hot spot: module evaluation (the registry tables), compiling the script, `start()` itself, and the descriptor and source reads. The plan's 2 ms target stays unmet on this reference device, which is slower than a mid-range phone. Whether about 5 ms on a budget-phone CPU meets "under 2 ms on a mid-range phone" depends on the phone; the honest statement is the measured number and the device.

### 2. On a light page, start-up delays the first paint

A deferred script runs after parsing, before `DOMContentLoaded`. On a page as light as the article, that is before the first frame, so the first paint (FCP and LCP together here) waits for the library's start-up: +4 ms at 4x, in every load. On the feed, the page's own parsing finishes later and the library's start-up fits before it, so there is no change.

### 3. The marker read

`markers()` looks for the ChatGPT badge only in `<head>`, where the favicon is, and for six Claude for Chrome ids with `getElementById`, so its cost no longer grows with the size of the page. It runs at most every 300 ms on a pointerdown or keydown, at most four times a second while `<body>`'s children churn, and every 5 s while visible. It is the 95th percentile of per-input time on both pages (0.24–0.58 ms, at most 1.19).

### 4. The hidden interval still wakes the page

While the document is hidden, the slow sample's interval still fires every 5 s; each callback checks `visibilityState` and returns, reading nothing. Stopping the interval on `visibilitychange` and restarting it on return would remove the wake-ups. They are small, and Chromium throttles background timers anyway, so this is a note, not a problem. Their time (6.9–10.9 ms for six, one callback up to 6.4 ms) belongs to the environment: a hidden renderer runs at low priority, and the browser may schedule a collection after hiding. It is recorded, not gated.

Everything else is as promised:

- **Input:** listeners are passive and cost tens of microseconds.
- **Paint and layout:** INP and CLS do not move.
- **Debounce:** holds under per-frame churn.
- **Idle:** activity is exactly the two later passes, the 5 s sample and one idle check.
- **Long-term:** nothing accumulates over simulated days. The 15 KB in the first two days is the JIT tiering up the callback, and growth stops after.
- **Side effects:** no request, storage write or DOM write in any run.

### History

The first measurements (2–3 October) found start-up at 27.5–31.4 ms, a long task on most light-page loads and +28 to +36 ms on its LCP. Nearly all of it was one call: a Grok Bot rule compared an exact screen-and-time-zone profile at start, and the first `Intl.DateTimeFormat` in a document loads the time zone data (24 ms at 4x). Reading the time zone only on a matching screen took start-up to 4.7 ms, and the budgets were tightened then (start-up from 48 to 12 ms, LCP added from 48 to 16 ms, long tasks gated at 0). That rule was later replaced by the host-gated computer check above, which reads the time zone only on the cloud host with three signs already matching. The same review moved the badge query from the whole document to `<head>`, which took the marker read from 0.26–0.36 ms on the 10,000-node feed to 0.11–0.16 ms.

## Budgets

Every budget, its value and how it was derived is in [`test/perf/budgets.json`](../test/perf/budgets.json); `npm run perf` prints them beside the numbers. The principles:

- **Differences against the same page, measured in the same run**, wherever the page's own cost is in the number: LCP, FCP, CLS, INP, DOM changes, heap growth.
- **Counts where the design gives an exact count**, because counts do not depend on the machine:
  - callbacks in 30 s idle (7 timers and one idle check visible, 6 hidden);
  - DOM queries while hidden (0);
  - debounced reads per second of churn (at most 4.5);
  - callbacks in a day (17,280);
  - requests, storage and DOM writes (0).
- **Times on the reference device, with headroom from the spread**, about 1.5x to 4x over the worst run, so that the calibration's ±5% and the gap between a laptop and a CI runner do not fail a run. Start-up's ceiling is 12 ms, about 2.5x the measured value and well under one long task. The light page's LCP ceiling is one frame (16 ms), because the delay is start-up.
- **Not gated** where the time belongs to the environment (hidden callbacks), or where the measure has no fixed scale (the task that contains start-up includes the page's own parsing). These are printed, with the plan's target shown as met or not met.

The plan's targets (start-up under 2 ms, no long tasks, no requests, storage or DOM writes) are shown in their own column. A target never fails the run; a budget does.

## Running it

```sh
npm run build
npm run perf                          # about 5 minutes: measure, print, check budgets
npm run perf -- --quick               # fewer runs, for trying a change
npm run perf -- --no-engines          # skip the Firefox and WebKit record
npm run perf -- --json results.json   # also write every sample
```

CI runs it as the `perf` job in `mcr.microsoft.com/playwright:v1.63.0-noble`. The table goes to the job summary, and `perf.json` is uploaded as an artifact.

If the reference machine changes, re-derive `reference.calibrationMs` from the median `calibration` samples in `--json` output on the new machine, then re-check the budgets against a few runs.

## Limits

- **Engines.** Only Chromium is gated, because only Chromium can be throttled and traced. Firefox and WebKit are recorded for start-up only.
- **Devices.** Throttling emulates a slower CPU, not a phone. The reference device is a calibrated slowdown of one machine, not a measured handset.
- **Pages and visits.** The pages are synthetic, and every load is a first visit (no code cache). A returning visitor's start-up is somewhat lower, because compilation is cached.
- **Entry points.** The script build is what is measured. The ES module entry (`botscent`, `botscent/auto`) runs the same code through the application's bundler; its start-up is the same work, its compile cost depends on the bundle, and it is not measured separately.
- **The simulated day** calls the real callbacks rather than waiting. It finds anything kept per callback, but not effects that only real hours would show.
