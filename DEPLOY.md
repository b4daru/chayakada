# CHAYAKADA KAVALA – deploy on Vercel (free)

Folder layout (keep it exactly like this):
  api/          the backend (chat, reactions, memes, scores, admin)
  lib/          backend code + starting data (your data from 13 Nov)
  public/       the website (index.html, admin.html, style.css, script.js, uploads/)
  package.json, vercel.json

## Steps
1. Make a free account at github.com -> New repository (name: chayakada) -> "uploading an existing file".
   Drag EVERYTHING inside this folder (api, lib, public, package.json, vercel.json, .gitignore) into the page -> Commit.
2. Make a free account at vercel.com (Continue with GitHub) -> Add New -> Project -> import "chayakada".
   Framework Preset: Other. Leave everything else empty -> Deploy.
3. In the Vercel project: Storage tab -> Create Database -> Upstash (Redis) -> Free plan.
   Choose the region nearest India (Mumbai / ap-south-1) if offered -> Connect to this project (all environments).
4. Settings -> Environment Variables -> add   ADMIN_PASS = (a new password only you know)
5. Deployments tab -> latest deployment -> ... -> Redeploy.
6. Open  https://YOUR-PROJECT.vercel.app/api?a=ping   You should see: ok:1, redis:"PONG", adminPassSet:true.
7. Open the site, send a chat message, react, upload a meme. Open /admin.html and log in with ADMIN_PASS.
8. Optional (faster in India): Settings -> Functions -> Function Region -> Mumbai (bom1).

## Moving newer data from InfinityFree
- Download data/db.json from InfinityFree (File Manager) -> Admin page -> "db.json ഇമ്പോർട്ട്".
- Memes uploaded after 13 Nov: download them from InfinityFree's uploads/ folder and add them to public/uploads/ in GitHub
  (same file names, e.g. m116.jpg). New memes posted on the Vercel site are stored in Redis, not in the folder.

## Limits to watch (free plans)
- Upstash Redis free: 500K commands/month. Check the Upstash dashboard each day during the event.
- Vercel Hobby: 1M function invocations + 1M edge requests per month. Check Usage in the Vercel dashboard.
- Never share ADMIN_PASS. Hobby plan is for non-commercial use only.
