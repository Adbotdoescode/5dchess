---
name: deployment
description: Use when deploying, changing Vercel settings, domains or environment variables, or debugging what production serves.
---

# Deployment (Vercel)

- **Project:** `adbotdoescodes-projects/5dchess`; production is **https://5dimensionalchess.vercel.app**. `5dchess.vercel.app` is owned by someone else's project and can't be used; `5dchess-three.vercel.app` was removed on purpose.
- **Auto-deploy:** every push to `main` on GitHub (`Adbotdoescode/5dchess`, public, MIT) deploys to production. There is no staging; other branches get preview URLs.
- **Static build:** `npm run build` (`tsc -b && vite build`). The game screen and three.js are lazy-loaded chunks. `src/App.tsx` reloads the page once if a chunk is missing after a deploy; keep that.
- **Env:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in Vercel (all environments) and in `.env.local` (gitignored). Both are public by design; never add server secrets to `VITE_` vars.
- **Check deployments:** use `vercel ls`, `vercel inspect <url>`, and `gh api repos/Adbotdoescode/5dchess/commits/<sha>/statuses`. `vercel ls` ages can mislead after the machine sleeps, so compare commit times instead.
- **Domain changes:** `vercel api /v10/projects/5dchess/domains` (POST with `-f name=…`, DELETE `/v9/projects/5dchess/domains/<name>`). After changing the domain, update the GitHub "About" link (`gh repo edit --homepage`) and this skill.
- **Server changes** (the Edge Function and migrations) deploy separately through the Supabase MCP.
