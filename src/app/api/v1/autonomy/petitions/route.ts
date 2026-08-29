import { runtimeConfig } from "@/lib/api/config";
import { apiResponse, requestId } from "@/lib/api/http";
import {
  listConstitutionalPetitions,
  recordConstitutionalPetition,
} from "@/lib/autonomy/constitutionalLedgerStore";
import { constitutionalLedgerFailure } from "@/lib/autonomy/ledgerHttp";
import { requireCanonicalActor, requireWorkloadCapability } from "@/lib/control-plane/actor";
import { boundedLedgerLimit } from "@/modules/autonomy/ledger";
import { evaluateConstitutionalPetition } from "@/modules/autonomy/petition";
import { parseConstitutionalPetitionRequest } from "@/modules/autonomy/petitionParser";
import { readBoundedJson } from "@/modules/control-plane/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = requestId(request.headers);
  try {
    const actor = requireWorkloadCapability(
      await requireCanonicalActor(request.headers),
      "constitution.petitions.read",
    );
    const limit = boundedLedgerLimit(new URL(request.url).searchParams.get("limit"));
    const records = await listConstitutionalPetitions(actor, limit);
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
        code: "CONSTITUTIONAL_RECORDING_DISABLED",
        externalEffectsAuthorized: false,
        message: "Constitutional recording is disabled until the canonical control plane is released.",
        ok: false,
      }, { requestId: id, status: 503 });
    }
    const actor = requireWorkloadCapability(
      await requireCanonicalActor(request.headers),
      "constitution.petitions.record",
    );
    const petition = parseConstitutionalPetitionRequest(await readBoundedJson(request, 48 * 1024));
    const evaluation = evaluateConstitutionalPetition(petition, actor.principal.identityId);
    const record = await recordConstitutionalPetition(actor, petition, evaluation);
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
