-- The audit log is append-only (docs/DATABASE.md rule 4).
-- UPDATE is always rejected. DELETE is rejected unless the transaction sets
-- `firstreply.allow_audit_delete = 'on'` — only the demo reset (seed) does that.
CREATE OR REPLACE FUNCTION actions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('firstreply.allow_audit_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'actions is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER actions_append_only
  BEFORE UPDATE OR DELETE ON actions
  FOR EACH ROW EXECUTE FUNCTION actions_append_only();
