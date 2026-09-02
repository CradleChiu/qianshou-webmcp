# Devpost submission draft

## Project name

Qianshou — Accessible Journey Companion

## Tagline

An agent-native accessible journey companion that turns natural requests into shared, verifiable transit guidance for Taiwan.

## Live URL

https://loveyou.cradle-ai.dev/journey

## Repository URL

https://github.com/CradleChiu/qianshou-webmcp

## Demo video URL

To be added after the public YouTube upload.

## What it does

Qianshou means “holding hands” in Mandarin: accompanying someone through a journey without taking away their control. Its Chinese name is 牽手過路走.

Qianshou helps blind and older travelers prepare a journey without first learning how to express it as a set of technical form fields. A person can say, “I want to go to Taipei 101,” “from here to Tamsui,” or “where am I?” A WebMCP-capable agent can invoke structured tools provided by the page, while the result simultaneously appears in an accessible human interface.

The current Taipei and New Taipei pilot resolves natural place names, obtains fresh browser location only when the sentence requires it, calculates transit with OpenTripPlanner, matches the first transit leg to TDX arrival data, and adds a short-range Central Weather Administration forecast. The person can then inspect sources, confirm an ambiguous place, compare alternatives, operate by keyboard, or listen to the itinerary.

Qianshou is intentionally honest about incomplete accessibility data. It distinguishes confirmed markings from unknown fields and never turns missing GTFS or OpenStreetMap data into a step-free guarantee.

## Why this is a strong fit for WebMCP

Transportation is a poor fit for visual guessing. A browser agent that only clicks controls has to infer field meaning, current-location grammar, candidate identity, and whether arrival information belongs to the route it just selected. Those errors create extra work for any traveler and disproportionately affect people using speech or screen readers.

Qianshou uses WebMCP as the collaboration boundary. The page exposes structured, task-level capabilities instead of low-level UI controls:

- `prepare_accessible_journey` prepares a complete journey from natural place references and returns route, matched arrival context, weather, source freshness, limitations, and any required place confirmation.
- `describe_current_location` obtains a fresh one-time location and returns an approximate human-readable place without exposing coordinates to the agent.

The agent does not need to scrape the UI, invent selectors, or ask the person which tool to use. Both the WebMCP path and manual path call the same journey service, and every tool result updates the visible page. This makes the agent useful without making the human interface secondary.

## How it creates a better user experience

The user speaks in normal language instead of translating intent into separate origin, destination, walking, transfer, and accessibility controls. Qianshou asks only for genuinely missing information. It preserves the user's chosen place candidate and presents the most relevant facts together: how to travel, walking and transfer burden, the next matched vehicle information, short-range weather, and known data limitations.

The shared page is particularly important for accessibility. A traveler can delegate the structured work to an agent and still use keyboard focus, live regions, large high-contrast controls, speech synthesis, and expandable source details. If WebMCP is unavailable, the same natural-language interface still works manually.

## What people and agents can do together that was difficult before

The person can express an incomplete, relative, or ambiguous request. The agent can use the page's semantics to decide whether “here” is the origin or destination, trigger a fresh one-time location request, and prepare a real itinerary. If a place is ambiguous, the result returns candidates for human confirmation instead of silently guessing. After the tool completes, the human and agent look at the same route state rather than maintaining separate conversational and visual answers.

This collaboration also creates a privacy boundary: raw browser geolocation coordinates are used by the page's journey service but are removed from results returned to the agent.

## How we built it

The interface is a Next.js 16 and React 19 application. Native WebMCP tools are registered with `document.modelContext.registerTool`. Both tools call a shared server-side TypeScript service.

Natural typed requests are converted into a strict JSON intent by a loopback-only Codex CLI process with an explicit schema, timeout, concurrency limit, and no shell, browser, plugin, or project-write access. Location resolution combines TDX and OpenStreetMap Nominatim. OpenTripPlanner 2.9 combines TDX GTFS with OpenStreetMap streets. TDX supplies route-specific bus arrivals and Taipei Metro LiveBoard information. Taiwan's Central Weather Administration supplies township-level three-hour forecasts.

The app records session-scoped product events in a server-only SQLite database. It stores submitted questions, understood summaries, intent classifications, and major UI/WebMCP outcomes for a configurable retention period. It does not store unsubmitted keystrokes, audio, or coordinates returned by browser geolocation. Users can stop recording or delete the current session.

## Challenges

- Public transit feeds did not contain enough accessibility detail to justify a broad “accessible route” claim. We created evidence levels and keep unknown values visible.
- A route and an arrival board are easy to mismatch. We bind arrival lookup to the exact first transit leg by stop, route, direction, and mode.
- Natural phrases such as “from here” and “to here” require grammatical direction, a fresh permission-bound location, and protection against stale application state.
- A route that minimizes transfers can still create excessive walking. We rank alternatives across total time, walking burden, and transfers while allowing no more than two transfers.
- Taipei/New Taipei transit plus a national street graph initially placed too much pressure on a small VM. We cropped the OpenStreetMap graph around relevant transit stops and set explicit container memory limits.

## Accomplishments

- A live, non-trivial WebMCP implementation in which native tool calls update the human UI.
- One operation prepares place resolution, multimodal routing, matched arrivals, weather, and limitations.
- Fresh current-location semantics for omitted origins, “from here,” “to here,” and “where am I?”
- Explicit uncertainty instead of fabricated demo routes or accessibility guarantees.
- Keyboard, responsive, reduced-motion, live-region, and speech-output support.
- A reproducible OTP/GTFS/OSM pipeline and automated domain tests.

## What we learned

Agent-native does not mean agent-only. The strongest experience came from exposing meaningful domain actions while preserving a complete human interface. Tool descriptions should explain user intent and safety boundaries, not implementation trivia. We also learned that route quality is constrained as much by public-data coverage as by the planner, and an honest unknown is more useful than a confident unsupported claim.

## What's next

- Conduct moderated tests with blind participants using mobile screen readers and desktop NVDA.
- Add nearby-place discovery for stations, convenience stores, and wheelchair-accessible toilets with clear unknown-data labels.
- Integrate operational elevator status where official sources permit it.
- Self-host or contract a geocoder with an appropriate production SLA.
- Expand beyond Taipei/New Taipei only after the accessibility evidence and operating model are validated.

## Built with

WebMCP, Next.js, React, TypeScript, Codex CLI, OpenTripPlanner, GTFS, TDX, OpenStreetMap, Nominatim, Central Weather Administration Open Data, SQLite, Docker, Nginx, and Google Cloud Platform.

## Testing instructions for judges

1. Open https://loveyou.cradle-ai.dev/journey in ChatGPT's in-app browser, or in a WebMCP-enabled version of Chrome.
2. Ask naturally: `我想從臺大醫院去板橋車站，少走路、少轉乘，順便告訴我下一班車和未來幾小時的天氣。`
3. Confirm that the agent invokes `prepare_accessible_journey` and that the route, matching arrival card, weather, data sources, and limitations appear on the same page.
4. Ask `這裡是哪裡？` only if you are comfortable granting one-time browser location permission. Confirm that `describe_current_location` updates the page and does not return coordinates to the agent.
5. The same first request can also be typed directly into the page to verify the non-WebMCP fallback.

No account is required. Live upstream data may occasionally be unavailable; the page reports that state explicitly and does not replace failed official data with a fabricated result.
