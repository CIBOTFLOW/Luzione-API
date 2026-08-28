export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  console.info(JSON.stringify({
    event: "service_started",
    level: "info",
    service: "luzione-api",
    environment: process.env.VERCEL_ENV ?? process.env.APP_ENV ?? "local",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
    region: process.env.VERCEL_REGION ?? "local",
    observedAt: new Date().toISOString(),
  }));
}
