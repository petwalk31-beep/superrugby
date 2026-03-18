# Super Rugby Pacific 2026 — Predictions App

Dynamic AI-powered match predictions hosted on Vercel.

---

## What's in this folder

```
superrugby/
├── index.html        ← The web app (frontend)
├── api/
│   └── predict.js    ← Serverless function (calls Anthropic API securely)
├── vercel.json       ← Vercel routing config
└── README.md         ← This file
```

---

## Deploy to Vercel (step-by-step, ~15 minutes)

### Step 1 — Get a free Vercel account
Go to https://vercel.com and sign up with GitHub, GitLab, or email.

### Step 2 — Get an Anthropic API key
1. Go to https://console.anthropic.com
2. Sign up / log in
3. Click **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`) — you only see it once

> Cost note: Each "Refresh" click costs roughly $0.01–0.02 NZD. Very cheap.

### Step 3 — Upload the project to Vercel

**Option A — Drag and drop (easiest, no GitHub needed)**
1. Go to https://vercel.com/new
2. Click **"Browse"** or drag the entire `superrugby` folder onto the page
3. Vercel will detect the project automatically
4. Click **Deploy** — wait ~30 seconds

**Option B — Via GitHub**
1. Create a free GitHub account at https://github.com if you don't have one
2. Create a new repository (click + → New repository), name it `superrugby`
3. Upload all files from this folder into that repository
4. Go to https://vercel.com/new, click **Import** and select your GitHub repo
5. Click **Deploy**

### Step 4 — Add your Anthropic API key
This is the most important step — without it predictions won't work.

1. In Vercel, go to your project dashboard
2. Click **Settings** → **Environment Variables**
3. Click **Add New**
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your key from Step 2 (e.g. `sk-ant-api03-...`)
   - Environment: tick **Production**, **Preview**, and **Development**
4. Click **Save**
5. Go to **Deployments** → click the three dots on your latest deployment → **Redeploy**

### Step 5 — Open your app
Vercel gives you a URL like `https://superrugby-abc123.vercel.app`
Bookmark it — this is your permanent prediction site!

---

## Updating predictions for new rounds

When a new round's fixtures are announced, open `index.html` and add a new entry
to the `ROUNDS` object following the same format as Round 6. Then re-upload or
push to GitHub (Vercel auto-deploys on every push).

Key fields to fill in per match:
- `day`, `time`, `home`, `away`, `venue`, `indoor`
- `formHome` / `formAway` — last 5 results as W/L string e.g. `"WWLWL"`
- `context.h2h` — head-to-head history
- `context.homeAdv` — home advantage notes
- `context.weather` — forecast conditions
- `context.injuries` — key injury/suspension news for both teams
- `context.standingsAndForm` — ladder context
- `context.pundits` — tips from ESPN, Rugby365, AusSportsBetting etc.

The richer the context you provide, the better the AI predictions will be.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not generate predictions" | Check ANTHROPIC_API_KEY is set and redeployed |
| Predictions show for wrong round | Check `firstKickoff` dates in ROUNDS data |
| Predictions locked when they shouldn't be | Verify UTC times in `firstKickoff` (NZ is UTC+12 standard, UTC+13 daylight saving) |
| Vercel build error | Make sure `api/predict.js` and `vercel.json` are in the root of the uploaded folder |
