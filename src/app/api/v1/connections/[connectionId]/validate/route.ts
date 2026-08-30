import { unavailableProviderAction } from "@/lib/control-plane/providerActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  return unavailableProviderAction(request, context, "validate");
}
