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
