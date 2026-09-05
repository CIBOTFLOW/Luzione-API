import { sha256 } from "@/modules/platform-guarantees/eventContract";
import { SeedSupplierIdentityContractError } from "@/modules/seed-supplier-identity/contracts";

export const PORTAL_ACCOUNT_ACCESS_BINDING_VERSION = "PortalOrganizationAccountAccessBinding/v1";
export const PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION = "PortalOrganizationAccountAccessBindingCommand/v1";

export type PortalAccessRef = { id: string; status: "ACTIVE" | "REVOKED"; version: string };
export type PortalBindingEvidenceRef = { objectId: string; objectType: "EVIDENCE_ARTIFACT"; ownerProject: "LUZIONE_PROCUREMENT"; version: string };
type Common = { bindingId: string; commandId: string; contractVersion: typeof PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION; expectedVersion: string; idempotencyKey: string };
export type PortalAccountAccessBindingCommand = (Common & {
  accountId: string; accountVersion: string; commandType: "portal_account_access_binding.record";
  evidenceRefs: readonly PortalBindingEvidenceRef[]; expectedVersion: "ABSENT";
  membershipRef: PortalAccessRef & { status: "ACTIVE" }; objectGrantRef: PortalAccessRef & { status: "ACTIVE" }; organizationId: string;
}) | (Common & {
  commandType: "portal_account_access_binding.revoke"; evidenceRefs: readonly PortalBindingEvidenceRef[];
  membershipRef: PortalAccessRef; objectGrantRef: PortalAccessRef; revocationRef: string;
});

export type PortalAccountAccessBindingV1 = {
  accountRef: { accountId: string; accountVersion: string };
  authority: { decision: "REQUIRE_HUMAN"; effectClass: "A2"; humanActorId: string; humanAuthenticationRef: string; workloadActorId: "service:luzione-supplier-portal" };
  bindingId: string; contractVersion: typeof PORTAL_ACCOUNT_ACCESS_BINDING_VERSION; createdAt: string;
  evidenceRefs: readonly PortalBindingEvidenceRef[]; membershipRef: PortalAccessRef; objectGrantRef: PortalAccessRef;
  organizationId: string; receipt: { committedVersion: string; finality: "DOMAIN_COMMITTED"; payloadHash: string; receiptId: string };
  revocationRef: string | null; status: "ACTIVE" | "REVOKED"; tenantId: string; version: string;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,511}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
type JsonObject = Record<string, unknown>;
function fail(message: string, status = 400): never { throw new SeedSupplierIdentityContractError("INVALID_PORTAL_ACCESS_BINDING", message, status); }
function object(value: unknown, path: string): JsonObject { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object.`); return value as JsonObject; }
function exact(value: unknown, keys: readonly string[], path: string) { const input = object(value, path); const actual = Object.keys(input).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${path} fields are not exact.`); return input; }
function id(value: unknown, path: string) { if (typeof value !== "string" || value !== value.trim() || !ID.test(value)) fail(`${path} must be an unpadded stable identifier.`); return value; }
function timestamp(value: unknown, path: string) { if(typeof value!=="string"||!RFC3339.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString()!==value) fail(`${path} must be canonical RFC3339 UTC.`); return value; }
function digest(value: unknown,path:string){if(typeof value!=="string"||!SHA256.test(value)) fail(`${path} must be a lowercase SHA-256 digest.`);return value;}
function evidenceRefs(value: unknown) { if (!Array.isArray(value) || value.length === 0 || value.length > 100) fail("evidenceRefs must be non-empty."); const refs = value.map((entry, index) => { const ref = exact(entry, ["objectId", "objectType", "ownerProject", "version"], `evidenceRefs[${index}]`); if (ref.objectType !== "EVIDENCE_ARTIFACT" || ref.ownerProject !== "LUZIONE_PROCUREMENT") fail("Portal binding evidence must use the procurement EvidenceArtifact boundary."); return { objectId: id(ref.objectId, "evidence.objectId"), objectType: "EVIDENCE_ARTIFACT" as const, ownerProject: "LUZIONE_PROCUREMENT" as const, version: id(ref.version, "evidence.version") }; }); if (new Set(refs.map((ref) => `${ref.objectId}@${ref.version}`)).size !== refs.length) fail("Portal binding evidence must not contain duplicates."); return refs; }
function accessRef(value: unknown, path: string): PortalAccessRef { const ref = exact(value, ["id", "status", "version"], path); if (ref.status !== "ACTIVE" && ref.status !== "REVOKED") fail(`${path}.status is invalid.`); return { id: id(ref.id, `${path}.id`), status: ref.status, version: id(ref.version, `${path}.version`) }; }

export function portalAccountAccessBindingId(tenantId: string, organizationId: string, accountId: string) { return `portal_account_binding_${sha256({ accountId, organizationId, tenantId }).slice(0, 40)}`; }
export function portalAccountAccessBindingVersion(bindingId: string, version: number) { return `portal-account-binding:${bindingId}:v${version}`; }

export function parsePortalAccountAccessBindingCommand(value: unknown): PortalAccountAccessBindingCommand {
  const input = object(value, "command"); if (input.contractVersion !== PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION) fail("Unsupported Portal binding command version."); const commandType = input.commandType;
  if (commandType === "portal_account_access_binding.record") { exact(input, ["accountId", "accountVersion", "bindingId", "commandId", "commandType", "contractVersion", "evidenceRefs", "expectedVersion", "idempotencyKey", "membershipRef", "objectGrantRef", "organizationId"], "command"); if (input.expectedVersion !== "ABSENT") fail("Initial Portal binding must expect ABSENT."); const membershipRef=accessRef(input.membershipRef,"membershipRef"); const objectGrantRef=accessRef(input.objectGrantRef,"objectGrantRef"); if(membershipRef.status!=="ACTIVE"||objectGrantRef.status!=="ACTIVE") fail("Initial Portal binding requires active membership and object grant."); return {accountId:id(input.accountId,"accountId"),accountVersion:id(input.accountVersion,"accountVersion"),bindingId:id(input.bindingId,"bindingId"),commandId:id(input.commandId,"commandId"),commandType,contractVersion:PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION,evidenceRefs:evidenceRefs(input.evidenceRefs),expectedVersion:"ABSENT",idempotencyKey:id(input.idempotencyKey,"idempotencyKey"),membershipRef:membershipRef as PortalAccessRef & {status:"ACTIVE"},objectGrantRef:objectGrantRef as PortalAccessRef & {status:"ACTIVE"},organizationId:id(input.organizationId,"organizationId")}; }
  if(commandType!=="portal_account_access_binding.revoke") fail("Unsupported Portal binding command type."); exact(input,["bindingId","commandId","commandType","contractVersion","evidenceRefs","expectedVersion","idempotencyKey","membershipRef","objectGrantRef","revocationRef"],"command"); const membershipRef=accessRef(input.membershipRef,"membershipRef"); const objectGrantRef=accessRef(input.objectGrantRef,"objectGrantRef"); if(membershipRef.status!=="REVOKED"&&objectGrantRef.status!=="REVOKED") fail("Revocation requires revoked membership or object-grant evidence."); return {bindingId:id(input.bindingId,"bindingId"),commandId:id(input.commandId,"commandId"),commandType,contractVersion:PORTAL_ACCOUNT_ACCESS_COMMAND_VERSION,evidenceRefs:evidenceRefs(input.evidenceRefs),expectedVersion:id(input.expectedVersion,"expectedVersion"),idempotencyKey:id(input.idempotencyKey,"idempotencyKey"),membershipRef,objectGrantRef,revocationRef:id(input.revocationRef,"revocationRef")};
}

export function parsePortalAccountAccessBindingV1(value: unknown): PortalAccountAccessBindingV1 {
  const input=exact(value,["accountRef","authority","bindingId","contractVersion","createdAt","evidenceRefs","membershipRef","objectGrantRef","organizationId","receipt","revocationRef","status","tenantId","version"],"portalAccountAccessBinding");
  if(input.contractVersion!==PORTAL_ACCOUNT_ACCESS_BINDING_VERSION) fail("Unsupported Portal Account access binding version.");
  const tenantId=id(input.tenantId,"tenantId"); const bindingId=id(input.bindingId,"bindingId"); const organizationId=id(input.organizationId,"organizationId");
  const account=exact(input.accountRef,["accountId","accountVersion"],"accountRef"); const accountId=id(account.accountId,"accountId"); const accountVersion=id(account.accountVersion,"accountVersion"); if(!accountVersion.startsWith(`account:${accountId}:v`)) fail("Account version does not bind its exact Account ID.");
  if(bindingId!==portalAccountAccessBindingId(tenantId,organizationId,accountId)) fail("Portal binding stable ID is not canonical.");
  const version=id(input.version,"version"); const versionMatch=/^portal-account-binding:(.+):v([1-9][0-9]*)$/.exec(version); if(!versionMatch||versionMatch[1]!==bindingId||!Number.isSafeInteger(Number(versionMatch[2]))) fail("Portal binding version is not canonical."); const versionNumber=Number(versionMatch[2]);
  const membershipRef=accessRef(input.membershipRef,"membershipRef"); const objectGrantRef=accessRef(input.objectGrantRef,"objectGrantRef");
  const status=input.status; if(status!=="ACTIVE"&&status!=="REVOKED") fail("Portal binding status is invalid.");
  const revocationRef=input.revocationRef===null?null:id(input.revocationRef,"revocationRef"); if((status==="REVOKED")!==Boolean(revocationRef)) fail("Portal binding status and revocationRef are inconsistent."); if(status==="ACTIVE"&&(versionNumber!==1||membershipRef.status!=="ACTIVE"||objectGrantRef.status!=="ACTIVE")) fail("Active Portal binding requires initial version 1 with active membership and object grant."); if(status==="REVOKED"&&(versionNumber!==2||(membershipRef.status!=="REVOKED"&&objectGrantRef.status!=="REVOKED"))) fail("Revoked Portal binding requires version 2 and a revoked membership or object grant.");
  const authority=exact(input.authority,["decision","effectClass","humanActorId","humanAuthenticationRef","workloadActorId"],"authority"); if(authority.decision!=="REQUIRE_HUMAN"||authority.effectClass!=="A2"||authority.workloadActorId!=="service:luzione-supplier-portal") fail("Portal binding authority is invalid."); const humanActorId=id(authority.humanActorId,"authority.humanActorId"); const humanAuthenticationRef=id(authority.humanAuthenticationRef,"authority.humanAuthenticationRef"); if(humanActorId===authority.workloadActorId) fail("Portal workload cannot approve its own access change.");
  const receipt=exact(input.receipt,["committedVersion","finality","payloadHash","receiptId"],"receipt"); if(receipt.finality!=="DOMAIN_COMMITTED"||receipt.committedVersion!==version) fail("Portal binding receipt finality/version is invalid.");
  return {accountRef:{accountId,accountVersion},authority:{decision:"REQUIRE_HUMAN",effectClass:"A2",humanActorId,humanAuthenticationRef,workloadActorId:"service:luzione-supplier-portal"},bindingId,contractVersion:PORTAL_ACCOUNT_ACCESS_BINDING_VERSION,createdAt:timestamp(input.createdAt,"createdAt"),evidenceRefs:evidenceRefs(input.evidenceRefs),membershipRef,objectGrantRef,organizationId,receipt:{committedVersion:version,finality:"DOMAIN_COMMITTED",payloadHash:digest(receipt.payloadHash,"receipt.payloadHash"),receiptId:id(receipt.receiptId,"receipt.receiptId")},revocationRef,status,tenantId,version};
}

export function requirePortalAccountAccess(input: { binding: PortalAccountAccessBindingV1; membershipRef: PortalAccessRef; objectGrantRef: PortalAccessRef; observedTenantId: string; organizationId: string }) { const binding=parsePortalAccountAccessBindingV1(input.binding); if(binding.tenantId!==input.observedTenantId||binding.organizationId!==input.organizationId||binding.status!=="ACTIVE"||binding.revocationRef!==null||input.membershipRef.status!=="ACTIVE"||input.objectGrantRef.status!=="ACTIVE"||sha256(binding.membershipRef)!==sha256(input.membershipRef)||sha256(binding.objectGrantRef)!==sha256(input.objectGrantRef)) fail("Portal organization access requires exact active tenant, membership, object grant, and non-revoked binding metadata.",403); return binding.accountRef; }
