begin;

insert into public.commercial_case_identities
  (case_id,tenant_id,origin_type,origin_id,created_at,updated_at,created_by,status)
values
  ('case-proposal-a2p','tenant-proof-a','opportunity','opportunity-primary','2026-09-05T09:00:00.000Z','2026-09-05T09:00:00.000Z','proof-fixture','active');

insert into public.commercial_cases
  (tenant_id,case_id,title,stage,status,created_by,updated_by,created_at,updated_at,version,source_metadata)
values
  ('tenant-proof-a','case-proposal-a2p','A2P Proposal Proof','proposal_preparation','active','proof-fixture','proof-fixture','2026-09-05T09:00:00.000Z','2026-09-05T09:00:00.000Z',1,'{"fixture":"SEED-PROPOSAL-OWNER-A2P"}'::jsonb);

commit;
