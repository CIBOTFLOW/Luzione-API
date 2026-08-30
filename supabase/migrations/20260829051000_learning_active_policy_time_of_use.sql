BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_learning_policy_evaluation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.authority_contract_version = 'luzione-authority/v2'
     AND OLD.capability IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning policy evaluations are immutable execution evidence.';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.authority_contract_version = 'luzione-authority/v2'
     AND NEW.capability IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Learning policy evaluations are immutable execution evidence.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER learning_policy_evaluations_immutable
BEFORE UPDATE OR DELETE ON public.policy_evaluations
FOR EACH ROW EXECUTE FUNCTION public.prevent_learning_policy_evaluation_mutation();

CREATE OR REPLACE FUNCTION public.validate_learning_source_confirmation_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.authority_contract_version = 'luzione-authority/v2'
     AND NEW.command_type IN (
       'learning.candidate.promote',
       'learning.candidate.rollback'
     )
     AND NEW.state = 'SOURCE_CONFIRMED' THEN
    PERFORM 1
      FROM public.policy_evaluations policy
      JOIN public.policy_definitions definition
        ON definition.policy_definition_id = policy.policy_definition_id
       AND definition.tenant_id = NEW.canonical_tenant_id
       AND definition.status = 'ACTIVE'
     WHERE policy.evaluation_id = NEW.policy_decision_id
       AND policy.tenant_id = NEW.canonical_tenant_id
       AND policy.authority_contract_version = 'luzione-authority/v2'
       AND policy.authority_class = 'A2'
       AND policy.capability = NEW.capability
       AND policy.correlation_id = NEW.correlation_id
       AND policy.actor_ref = NEW.actor_id
       AND policy.domain = 'learning'
       AND policy.action = NEW.command_type
       AND policy.resource_scope = NEW.resource_scope
       AND policy.payload_hash = NEW.metadata->'action'->>'contentDigest'
       AND policy.created_at <= NEW.requested_at
       AND policy.created_at >= NEW.requested_at - interval '5 minutes'
       AND policy.allowed
       AND NOT policy.hard_blocked
     FOR KEY SHARE OF policy, definition;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Learning source confirmation requires the exact active tenant policy at time of use.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER learning_command_active_policy_time_of_use
BEFORE UPDATE OF state, policy_decision_id, canonical_tenant_id,
  capability, correlation_id, actor_id, resource_scope, metadata
ON public.p110_command_receipts
FOR EACH ROW
WHEN (
  NEW.authority_contract_version = 'luzione-authority/v2'
  AND NEW.command_type IN (
    'learning.candidate.promote',
    'learning.candidate.rollback'
  )
  AND NEW.state = 'SOURCE_CONFIRMED'
)
EXECUTE FUNCTION public.validate_learning_source_confirmation_policy();

REVOKE ALL ON FUNCTION public.prevent_learning_policy_evaluation_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_learning_source_confirmation_policy()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.validate_learning_source_confirmation_policy() IS
  'Final atomic time-of-use gate: locks the exact immutable learning policy receipt and its active tenant policy before SOURCE_CONFIRMED.';

COMMIT;
