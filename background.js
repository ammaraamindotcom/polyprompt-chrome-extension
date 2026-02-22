const OPENAI_API_KEY = "YOUR_API_KEY";

/*
  EventSnap Background Service Worker (MV3)
  - Captures visible tab screenshot on demand
  - Calls OpenAI Responses API with image input
  - Returns structured JSON to popup
*/

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const MODEL_NAME = "gpt-4.1-mini"; // Reasonable default; can be changed later

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "CAPTURE_EVENT") return;

  // Keep the message channel open for async work.
  (async () => {
    try {
      if (!OPENAI_API_KEY || OPENAI_API_KEY === "YOUR_OPENAI_API_KEY_HERE") {
        throw new Error("Missing OpenAI API key. Please set OPENAI_API_KEY in background.js.");
      }

      // Capture the currently visible tab as JPEG (quality ~50).
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "jpeg",
        quality: 50
      });

      if (!dataUrl || !dataUrl.startsWith("data:image")) {
        sendResponse({ ok: false, error: "Failed to capture screenshot." });
        return;
      }

      // Send to OpenAI Responses API with image input.
      const responseJson = await callOpenAI(OPENAI_API_KEY, dataUrl);

      // Extract JSON string from the response payload.
      const outputText = extractOutputText(responseJson);
      if (!outputText) {
        sendResponse({ ok: false, error: "No output text returned by OpenAI." });
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(outputText);
      } catch (err) {
        sendResponse({
          ok: false,
          error: "OpenAI returned invalid JSON.",
          details: outputText
        });
        return;
      }

      sendResponse({ ok: true, data: parsed });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      sendResponse({ ok: false, error: msg });
    }
  })();

  return true; // Required to signal async response
});

async function callOpenAI(apiKey, dataUrl) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt =
  const userPrompt =
  "Analyze this screenshot carefully.\n\n" +
  "Step 1: Decide if it contains a real, upcoming event announcement.\n" +
  "Step 2: If true, extract structured event details.\n\n" +
  "Important:\n" +
  "- Do not guess missing details.\n" +
  "- If uncertain, use null.\n" +
  "- Only extract what is clearly visible.\n" +
  "- Output JSON only.";

  const body = {
    model: MODEL_NAME,
    // Enforce JSON-only output (Responses API now uses text.format)
    text: { format: { type: "json_object" } },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userPrompt },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ]
  };

  const resp = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    let details = "";
    try {
      const errJson = await resp.json();
      details = errJson.error?.message || JSON.stringify(errJson);
    } catch (e) {
      details = await resp.text();
    }
    throw new Error(`OpenAI API error (${resp.status}): ${details}`);
  }

  return await resp.json();
}

function buildSystemPrompt() {
  return `
You are a strict event extraction engine.

Your task:
Analyze the provided screenshot and determine whether it contains a REAL upcoming event announcement or invitation.

Definition of a REAL event:
- A specific future gathering, meeting, performance, party, lecture, workshop, sports game, fundraiser, or organized activity.
- Must include at least a clear title OR a clear date/time.

Do NOT classify as events:
- Generic advertisements
- Venue pages without a specific event
- Meme posts
- Past events with no upcoming date
- Giveaways without a scheduled date/time
- Promotions without a specific date

If the screenshot does NOT contain a real event:
Return:
{
  "is_event": false,
  "event": null
}

If the screenshot DOES contain a real event:
Extract structured event details following these rules:

Strict extraction rules:
- Do NOT hallucinate.
- Do NOT guess missing information.
- If a field is missing or unclear, return null.
- Only extract information clearly visible in the screenshot.
- If required scheduling details are too unclear to reasonably identify the event, set is_event to false.

Date and time rules:
- Return start_datetime and end_datetime in ISO 8601 format.
- Example: 2026-04-15T19:00:00
- Do NOT include timezone offsets in the datetime strings.
- If year is missing, assume the next upcoming occurrence of that date.
- If time is missing but date exists, return null for the datetime.
- If end time is not stated, return end_datetime as null.

Timezone rules:
- If explicitly stated, use it.
- Otherwise default to "America/Los_Angeles".

Field-specific rules:
- registration_link: Only include if clearly visible.
- cost: Return exactly as written (e.g., "$10", "Free", "$5–$15").
- location: Extract full visible location text if present.
- host: Extract organizer name only if clearly stated.

Return JSON ONLY.
No prose.
No markdown.
No explanation.

Return EXACTLY this schema:

{
  "is_event": boolean,
  "event": {
    "title": string|null,
    "start_datetime": string|null,
    "end_datetime": string|null,
    "timezone": string,
    "location": string|null,
    "host": string|null,
    "registration_link": string|null,
    "cost": string|null
  }
}

If is_event is false, event must be null.
`;
}

function extractOutputText(responseJson) {
  if (!responseJson) return "";

  // Some Responses API payloads include output_text as a convenience.
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text.trim();
  }

  // Otherwise, walk the output array.
  const output = responseJson.output || [];
  for (const item of output) {
    const content = item.content || [];
    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        return part.text.trim();
      }
    }
  }

  return "";
}