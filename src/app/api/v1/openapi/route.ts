import { NextResponse } from "next/server";

import { controlPlaneOpenApi } from "@/modules/control-plane/openapi";

export const dynamic = "force-static";
export const revalidate = 300;

export function GET() {
  return NextResponse.json(controlPlaneOpenApi, {
    headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" },
  });
}
