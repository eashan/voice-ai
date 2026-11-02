// Local dev: share the repo-root .env with the orchestrator. On Vercel, env vars come from the project settings.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {
  // no root .env (e.g. Vercel build)
}

/** @type {import('next').NextConfig} */
export default { transpilePackages: ["@voiceforge/shared"] };
