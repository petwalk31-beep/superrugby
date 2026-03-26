// api/fixtures.js
// Fetches the upcoming Super Rugby Pacific round from the ESPN API,
// derives recent form from past results, and asks Claude to generate
// rich match context (H2H, injuries, weather, pundits) that the
// predict endpoint then uses to make its predictions.

const LEAGUE_ID = "242041"; // Super Rugby Pacific 2026 on ESPN
const ESPN_BASE = `https://site.api.espn.com/apis/site/v2/sports/rugby/${LEAGUE_ID}`;

// ─── CORS helper ─────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ─── Fetch with timeout ───────────────────────────────────────────────────────
async function fetchJSON(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Get all events for a date range ─────────────────────────────────────────
async function getEvents(fromDate, toDate) {
  // ESPN scoreboard accepts ?dates=YYYYMMDD-YYYYMMDD for a range
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url = `${ESPN_BASE}/scoreboard?dates=${fmt(fromDate)}-${fmt(toDate)}&limit=100`;
  const data = await fetchJSON(url);
  return data.events || [];
}

// ─── Get completed events (last 8 weeks) for form calculation ────────────────
async function getRecentEvents() {
  const to   = new Date();
  const from = new Date(to.getTime() - 56 * 24 * 60 * 60 * 1000); // 8 weeks back
  return getEvents(from, to);
}

// ─── Get upcoming events (next 10 days) ──────────────────────────────────────
async function getUpcomingEvents() {
  const from = new Date();
  const to   = new Date(from.getTime() + 10 * 24 * 60 * 60 * 1000);
  return getEvents(from, to);
}

// ─── Derive W/L form string for a team from completed events ─────────────────
function calcForm(teamId, completedEvents) {
  const results = [];
  for (const ev of completedEvents) {
    if (ev.status?.type?.completed !== true) continue;
    const comps = ev.competitions?.[0];
    if (!comps) continue;
    const myComp = comps.competitors?.find(c => c.team?.id === teamId);
    if (!myComp) continue;
    results.push({ date: new Date(ev.date), winner: myComp.winner });
  }
  // Sort oldest → newest, take last 5
  results.sort((a, b) => a.date - b.date);
  return results.slice(-5).map(r => r.winner ? "W" : "L").join("") || "-----";
}

// ─── Group upcoming events into rounds ───────────────────────────────────────
// ESPN groups events by week. We cluster by "week" label or by date proximity.
function groupIntoRound(events) {
  if (!events.length) return null;

  // Sort by date
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Find the earliest event and include everything within 4 days of it
  const first = new Date(events[0].date);
  const cutoff = new Date(first.getTime() + 4 * 24 * 60 * 60 * 1000);
  const roundEvents = events.filter(e => new Date(e.date) <= cutoff);

  // Try to get the round number from ESPN's season/week label
  const weekLabel = events[0].season?.slug || events[0].week?.text || null;

  return { events: roundEvents, weekLabel, firstDate: first };
}

// ─── Parse a single ESPN event into our match shape ──────────────────────────
function parseEvent(ev, completedEvents) {
  const comp    = ev.competitions?.[0];
  const competitors = comp?.competitors || [];

  // ESPN sometimes orders home/away differently
  const home = competitors.find(c => c.homeAway === "home") || competitors[0];
  const away = competitors.find(c => c.homeAway === "away") || competitors[1];

  const venue   = comp?.venue?.fullName || "TBC";
  const city    = comp?.venue?.address?.city || "";
  const indoor  = comp?.venue?.indoor || false;

  // Date → local NZT display
  const kickoff = new Date(ev.date);
  const dayStr  = kickoff.toLocaleDateString("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "long", day: "numeric", month: "long"
  });
  const timeStr = kickoff.toLocaleTimeString("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "2-digit", minute: "2-digit"
  }) + " NZST";

  const homeTeam = home?.team?.displayName || "TBC";
  const awayTeam = away?.team?.displayName || "TBC";
  const homeId   = home?.team?.id;
  const awayId   = away?.team?.id;

  const formHome = homeId ? calcForm(homeId, completedEvents) : "-----";
  const formAway = awayId ? calcForm(awayId, completedEvents) : "-----";

  // Odds if available
  let odds = "";
  const oddsData = comp?.odds?.[0];
  if (oddsData) {
    odds = oddsData.details || "";
  }

  return {
    day:      dayStr,
    time:     timeStr,
    home:     homeTeam,
    away:     awayTeam,
    venue:    `${venue}${city ? ", " + city : ""}`,
    indoor,
    formHome,
    formAway,
    kickoffISO: ev.date,
    espnOdds: odds
  };
}

// ─── Ask Claude to generate rich context for each match ──────────────────────
async function generateContext(matches, roundLabel) {
  const prompt = `You are a Super Rugby Pacific analyst. For each of the following ${roundLabel} matches, provide rich context to help predict the result.

For each match return a JSON array (same order) where each object has:
- h2h: string — head-to-head history, recent winning streaks, home/away record between these teams
- homeAdv: string — home ground advantage notes, crowd factor, travel fatigue for away side
- weather: string — typical conditions for this venue and time of year, how it suits each team's style
- injuries: string — any known or likely key player absences, suspensions, or returns for both teams based on current 2026 season knowledge
- standingsAndForm: string — current ladder context, recent run of form, momentum
- pundits: string — what expert pundits and betting markets typically favour for this matchup given current form

Matches:
${JSON.stringify(matches.map(m => ({
  home: m.home, away: m.away,
  venue: m.venue, indoor: m.indoor,
  formHome: m.formHome, formAway: m.formAway,
  espnOdds: m.espnOdds
})), null, 2)}

Return ONLY a valid JSON array. No markdown, no preamble.`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!resp.ok) throw new Error(`Claude context API error ${resp.status}`);
  const data = await resp.json();
  const raw  = (data.content || []).map(b => b.text || "").join("").replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  setCors(res);

  try {
    // Fetch upcoming and recent events in parallel
    const [upcomingEvents, recentEvents] = await Promise.all([
      getUpcomingEvents(),
      getRecentEvents()
    ]);

    // Completed events only, for form
    const completed = recentEvents.filter(e => e.status?.type?.completed === true);

    // Group upcoming into a round
    const round = groupIntoRound(upcomingEvents);

    if (!round || !round.events.length) {
      return res.status(200).json({
        round: null,
        message: "No upcoming fixtures found in the next 10 days."
      });
    }

    // Parse each match
    const matches = round.events.map(ev => parseEvent(ev, completed));

    // Derive round number/label from ESPN data or date
    const roundNum   = round.weekLabel || `Round (${round.firstDate.toLocaleDateString("en-NZ")})`;
    const firstDate  = round.firstDate;
    const lastDate   = new Date(round.events[round.events.length - 1].date);

    const formatDate = d => d.toLocaleDateString("en-NZ", {
      timeZone: "Pacific/Auckland", day: "numeric", month: "long", year: "numeric"
    });

    // Generate rich context for each match via Claude
    let contexts;
    try {
      contexts = await generateContext(matches, roundNum);
    } catch (ctxErr) {
      console.error("Context generation failed:", ctxErr);
      // Fall back to minimal context so predictions can still run
      contexts = matches.map(m => ({
        h2h: "Head-to-head data unavailable",
        homeAdv: "Home advantage applies",
        weather: "Conditions unknown",
        injuries: "No injury data available",
        standingsAndForm: `${m.home} form: ${m.formHome} | ${m.away} form: ${m.formAway}`,
        pundits: m.espnOdds ? `ESPN odds: ${m.espnOdds}` : "No pundit data available"
      }));
    }

    // Merge context into matches
    const enriched = matches.map((m, i) => ({
      ...m,
      context: contexts[i] || {}
    }));

    return res.status(200).json({
      round: {
        label:  roundNum,
        dates:  `${formatDate(firstDate)} – ${formatDate(lastDate)}`,
        matches: enriched
      }
    });

  } catch (err) {
    console.error("Fixtures handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
