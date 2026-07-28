# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Verifying required dependencies

The `verify:ai` script checks that every runtime dependency required by the BoothLens AI pipeline is installed and pinned to the exact version recorded in the lockfile, and that every required environment variable is set.

Run it after cloning, whenever a build fails with a missing-module error, or when you see a missing-variable error on startup:

```sh
npm run verify:ai
```

### What the script checks

- The package is installed in `node_modules`.
- The installed version matches the exact version in `package.json` (and the lockfile for pinned packages).
- Required environment variables are set and non-empty.
- **Database schema:** every required table (`profiles`, `research_runs`, `events`, `leads`, `email_templates`, `digest_schedules`) and its expected columns exist and are reachable through the Data API. Missing objects print the exact `CREATE TABLE` / `GRANT` / RLS guidance. Skipped automatically when no database credentials are present.
- **Smoke test:** a TypeScript compile (`tsc --noEmit`) plus a minimal runtime script that imports and initialises `zod`, `ai` and `@ai-sdk/openai-compatible`, so a broken install fails here rather than at request time.

If everything passes, you will see a list of required packages with their installed and expected versions, a list of configured environment variables, and `smoke: PASSED`.

Related scripts:

| Script | What it runs |
| --- | --- |
| `npm run verify:ai` | dependency + env checks, then the smoke test (type compile + runtime script) |
| `npm run verify:ai:deps` | dependency/lockfile/env checks only (add `-- --no-env` to skip env vars) |
| `npm run verify:ai:build` | dependency checks, then a full production build as the smoke step |
| `npm run smoke` | the smoke test on its own |
| `npm run verify:schema` | the database schema/RPC check on its own |

Build scripts (`dev`, `build`, `build:dev`) run `verify:ai:deps -- --no-env`, because deploy-time secrets are injected by the platform and are not present in the build environment.

When the smoke test fails it prints the failing step, the last lines of its output, and the exact command to re-run.


### Installing missing dependencies

When `verify:ai` finds missing or mismatched packages, it prints two things:

1. A table of each missing package and the expected version.
2. A package-manager-specific install command, for example:

   ```sh
   bun add --exact ai@7.0.37 @ai-sdk/openai-compatible@3.0.14
   ```

   Or, if you prefer npm:

   ```sh
   npm install --save-exact ai@7.0.37 @ai-sdk/openai-compatible@3.0.14
   ```

You can also run the bundled helper script to install all required packages and re-verify them in one step:

```sh
./scripts/install-required.sh
```

After installing, run `npm run verify:ai` again to confirm the environment is healthy.

### Missing environment variables

When `verify:ai` finds a required environment variable is missing, it prints a table of the missing variable names and what each one is used for, for example:

```
preflight: FAILED — 1 required environment variable(s) missing

  VARIABLE          DESCRIPTION
  --------          -----------
  FIRECRAWL_API_KEY Firecrawl API key for scraping trade show directories

Set the missing variables in your environment or .env file before running the app.
For Lovable Cloud projects, these secrets are managed in Project Settings → Secrets.
```

Required variables are:

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY` — Supabase publishable/anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `LOVABLE_API_KEY` — Lovable AI Gateway / connectors key
- `FIRECRAWL_API_KEY` — Firecrawl scraping key

`HUBSPOT_API_KEY` is optional and only required if you use the CRM sync feature.

This project uses the Lovable AI Gateway, so `LOVABLE_API_KEY` is used instead of `OPENAI_API_KEY`.


## Dependency Management


This repository uses [Renovate](https://docs.renovatebot.com/) to manage dependency updates. The `ai` and `@ai-sdk/openai-compatible` packages are intentionally pinned and excluded from automatic version bump PRs because they are tightly coupled to the Vercel AI SDK and the Lovable AI Gateway runtime.

### Approving AI SDK updates via the Dependency Dashboard

1. After Renovate runs, open the **Dependency Dashboard** issue it creates in this repository.
2. Look for the pending update group named **"AI SDK pinned packages"**.
3. Check the checkbox next to that group (or click the approval link) to allow Renovate to create a PR for the next pinned version.
4. Renovate opens a single PR for `ai` and `@ai-sdk/openai-compatible` together. Review it, then run:

   ```sh
   npm run verify:ai
   npm run typecheck
   npm run test
   npm run build
   ```

5. Merge only after CI passes and you have confirmed the changes work with the Lovable AI Gateway integration.

> **Note:** The dependency dashboard also lists all other pending updates. Only the AI SDK group is blocked by manual approval; the rest of the dependencies follow the default Renovate schedule.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
