-- Process due automation waits each minute. pg_net queues the HTTP request after
-- the transaction commits; the application endpoint still claims each wait
-- atomically, so overlapping calls cannot send a follow-up twice.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The secret is provisioned separately in Supabase Vault. Keeping its value
-- out of cron.job and source control allows rotation without a migration.
select cron.schedule(
  'wacrm-automation-waits',
  '* * * * *',
  $job$
    do $body$
    declare
      scheduler_secret text;
    begin
      select decrypted_secret into scheduler_secret
      from vault.decrypted_secrets
      where name = 'wacrm_automation_cron_secret';

      if scheduler_secret is null or scheduler_secret = '' then
        raise exception 'wacrm_automation_cron_secret is missing from Vault';
      end if;

      perform net.http_get(
        url := 'https://wacrm-sage-beta.vercel.app/api/automations/cron',
        headers := jsonb_build_object('x-cron-secret', scheduler_secret),
        timeout_milliseconds := 60000
      );
    end
    $body$;
  $job$
);
