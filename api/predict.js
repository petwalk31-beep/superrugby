export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // CORS — allow requests from your own Vercel domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { matches, roundNum } = req.body;

  if (!matches || !Array.isArray(matches)) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const SYSTEM = `You are an expert Super Rugby Pacific analyst with deep knowledge of New Zealand, Australian and Pacific Island rugby. 

Given match context data for Round ${roundNum}, produce a JSON array (same order as input, one object per match) containing:
- winner: string (exact team name from input)
- marginCategory: "close" (winning margin 1–12 pts) or "comfortable" (winning margin 13+ pts)
- predictedScore: string e.g. "27–19"
- confidence: integer between 55 and 92
- keyFactors: array of 3–5 short strings, max 6 words each
- analysis: string, max 60 words, punchy and specific — reference actual player names, streaks, and stats from the context provided

Weigh these factors in order of importance:
1. Current form (last 5 games)
2. Head-to-head record, especially at this venue
3. Key injury absences and their positional impact
4. Home advantage and crowd factor
5. Weather/conditions and how each team's style is affected
6. Pundit consensus and market odds as a cross-check

Return ONLY a valid JSON array. No markdown fences, no commentary, no preamble.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 2000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Super Rugby Pacific Round ${roundNum} — please predict all matches:\n\n${JSON.stringify(matches, null, 2)}`
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return res.status(502).json({ error: "Upstream API error", detail: err });
    }

    const data = await response.json();
    const raw = (data.content || [])
      .map(b => b.text || "")
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    let predictions;
    try {
      predictions = JSON.parse(raw);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Raw:", raw);
      return res.status(500).json({ error: "Failed to parse predictions", raw });
    }

    return res.status(200).json({ predictions });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
