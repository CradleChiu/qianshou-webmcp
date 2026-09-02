# Public demo video script — target 2:30

The final video must be public on YouTube, include audio, and remain under three minutes. Record at 1080p or higher. Use browser zoom large enough that the tool call and synchronized page update remain readable after YouTube compression.

## Before recording

- Use ChatGPT's in-app browser or Chrome with WebMCP testing enabled.
- Open `https://loveyou.cradle-ai.dev/journey` in a fresh session.
- Confirm the Site tools menu lists `prepare_accessible_journey` and `describe_current_location`.
- Do one private rehearsal with the exact main prompt.
- Close notifications and hide bookmarks or account information.
- Do not demonstrate current location from a private residence. If the location tool is shown, record from a public place you are comfortable revealing.
- Prepare a backup take that demonstrates only the journey tool if location permission is unreliable.

## Timeline and narration

### 0:00–0:15 — The problem

**Screen:** Start on the clean Qianshou page.

**Narration:**

> Planning a trip is often a form-filling task. For blind and older travelers, every extra field and every mismatched result adds friction. Qianshou lets a person simply say what they need.

### 0:15–0:30 — Show native WebMCP

**Screen:** Briefly open the browser's Site tools panel. Show the two registered tools, then close it.

**Narration:**

> This page exposes native WebMCP tools. The agent receives task-level actions, not a pile of buttons to guess from.

### 0:30–1:15 — Natural request and agent call

**Screen:** Ask the agent, without mentioning a tool:

```text
我想從臺大醫院去板橋車站，少走路、少轉乘，順便告訴我下一班車和未來幾小時的天氣。
```

Show that the agent selects `prepare_accessible_journey`. Keep the tool invocation visible for two or three seconds, then show the synchronized page.

**Narration:**

> I never told the agent which tool to use. WebMCP gives it the semantics to prepare one complete journey. The same operation resolves places, plans transit, matches arrival context, and adds short-range weather.

### 1:15–1:50 — Shared human interface

**Screen:** Scroll through total time, walking, transfers, steps, arrival, and weather. Briefly expand “data sources and current limitations.”

**Narration:**

> The result is not trapped in chat. It updates the same keyboard-accessible page the traveler can inspect or listen to. Official and integrated sources are labelled, and missing accessibility data stays unknown instead of becoming a false safety promise.

### 1:50–2:12 — Human control

**Screen:** Start itinerary speech for a few seconds, stop it, and—if alternatives are present—select another route. Do not wait for the full speech output.

**Narration:**

> The agent does the structured work, but the person remains in control: listening, comparing, confirming ambiguous places, or using the same interface without an agent.

### 2:12–2:28 — Privacy boundary and close

**Screen:** Return to the main result. Optionally show the privacy details in the footer.

**Narration:**

> Fresh location can be requested only when the sentence requires it, and raw browser coordinates are not returned to the agent. Qianshou shows how WebMCP can make the web more useful for both people and their agents.

### 2:28–2:30 — End card

**Screen text:**

```text
Qianshou 牽手過路走
Agent-native accessible journeys for Taiwan
loveyou.cradle-ai.dev/journey
```

## YouTube metadata

**Suggested title:**

```text
Qianshou — Agent-native accessible journey planning with WebMCP
```

**Suggested description:**

```text
Qianshou (牽手過路走) is a WebMCP-powered accessible journey companion for Taiwan. A person can make a natural request while an agent prepares place resolution, transit, matched arrivals, weather, and explicit data limitations in the same human-accessible interface.

Live demo: https://loveyou.cradle-ai.dev/journey
Source: [PUBLIC REPOSITORY URL]
Built for the OpenAI WebMCP Challenge 2026.
```
