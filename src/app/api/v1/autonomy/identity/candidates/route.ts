import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import {
  listIdentityCandidates,
  recordIdentityCandidate,
} from "@/lib/autonomy/constitutionalLedgerStore";
import { constitutionalLedgerFailure } from "@/lib/autonomy/ledgerHttp";
import { requireCanonicalActor, requireWorkloadCapability } from "@/lib/control-plane/actor";
import { evaluateIdentityCandidate } from "@/modules/autonomy/identity";
import { parseIdentityCandidateRequest } from "@/modules/autonomy/identityParser";
import { boundedLedgerLimit } from "@/modules/autonomy/ledger";
import { readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = requireWorkloadCapability(
      await requireCanonicalActor(request.headers),
      "identity.candidates.read",
    );
    const limit = boundedLedgerLimit(new URL(request.url).searchParams.get("limit"));
    const records = await listIdentityCandidates(actor, limit);
    return apiResponse({
      contractVersion: "sultan-constitutional-ledger/v1",
      externalEffectsAuthorized: false,
      ok: true,
      records,
    }, { requestId: id });
  } catch (error) {
    return constitutionalLedgerFailure(error, id);
  }
}

export async function POST(request: Request) {
  const id = requestId(request.headers);
  try {
    if (!runtimeConfig().controlPlaneMutationsEnabled) {
      return apiResponse({
        code: "IDENTITY_RECORDING_DISABLED",
        externalEffectsAuthorized: false,
        message: "Identity candidate recording is disabled until the canonical control plane is released.",
        ok: false,
      }, { requestId: id, status: 503 });
    }
    const actor = requireWorkloadCapability(
      await requireCanonicalActor(request.headers),
      "identity.candidates.record",
    );
    const candidate = parseIdentityCandidateRequest(await readBoundedJson(request, 32 * 1024));
    const evaluation = evaluateIdentityCandidate(candidate);
    const record = await recordIdentityCandidate(actor, candidate, evaluation);
    return apiResponse({
      contractVersion: "sultan-constitutional-ledger/v1",
      externalEffectsAuthorized: false,
      ok: true,
      record,
    }, { requestId: id, status: record.replayed ? 200 : 201 });
  } catch (error) {
    return constitutionalLedgerFailure(error, id);
  }
}
