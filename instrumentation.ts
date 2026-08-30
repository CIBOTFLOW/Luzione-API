import { emitTelemetryLog } from "@/modules/platform-telemetry/telemetry";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  emitTelemetryLog({
    attributes: { runtime: process.env.NEXT_RUNTIME },
    body: "Luzione API service started.",
    eventName: "service.lifecycle.started",
    severity: "INFO",
  });
}
