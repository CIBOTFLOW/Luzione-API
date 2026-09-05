begin;

insert into public.accounts (tenant_id,id,name,status,version,updated_at) values
  ('tenant-proof-a','supplier-profile-primary','Supplier Profile Primary','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-a','supplier-profile-fault','Supplier Profile Fault','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-a','supplier-profile-concurrent','Supplier Profile Concurrent','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-a','supplier-profile-conflict','Supplier Profile Conflict','active',1,'2026-09-05T09:00:00.000Z'),
  ('tenant-proof-a','supplier-profile-portal-other','Supplier Profile Portal Other','active',1,'2026-09-05T09:00:00.000Z');

commit;
