ALTER TABLE plans ADD COLUMN recommendation_basis_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plans ADD COLUMN restraint_guidance_json TEXT NOT NULL DEFAULT '{"should_push":true,"reason":"This plan was created before restraint guidance was stored.","minimum_viable_move":"Do the smallest useful version of the top action.","recovery_move":"Protect basic recovery before adding more work.","scope_boundary":"Do not expand the plan beyond today."}';
ALTER TABLE plans ADD COLUMN friction_pattern TEXT NOT NULL DEFAULT 'No friction pattern was stored for this older plan.';
ALTER TABLE plans ADD COLUMN local_reality_scout_json TEXT NOT NULL DEFAULT '{"used_web_search":false,"location_basis":"","findings":[],"missing_location_question":""}';
ALTER TABLE plans ADD COLUMN human_help_boundary TEXT NOT NULL DEFAULT 'Use appropriate human, professional, or emergency help when the situation exceeds planning support.';

ALTER TABLE next_move_plans ADD COLUMN recommendation_basis_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE next_move_plans ADD COLUMN restraint_guidance_json TEXT NOT NULL DEFAULT '{"should_push":true,"reason":"This plan was created before restraint guidance was stored.","minimum_viable_move":"Do the smallest useful version of the highest-leverage move.","recovery_move":"Protect basic recovery before adding more work.","scope_boundary":"Do not expand the plan beyond the current situation."}';
ALTER TABLE next_move_plans ADD COLUMN friction_pattern TEXT NOT NULL DEFAULT 'No friction pattern was stored for this older plan.';
ALTER TABLE next_move_plans ADD COLUMN local_reality_scout_json TEXT NOT NULL DEFAULT '{"used_web_search":false,"location_basis":"","findings":[],"missing_location_question":""}';
ALTER TABLE next_move_plans ADD COLUMN safety_boundary_json TEXT NOT NULL DEFAULT '{"risk_level":"low","professional_help_signal":"Use appropriate human or professional help when the situation exceeds planning support.","do_not_rely_on_ai_for":"Do not rely on FlowPath for legal, medical, financial, emergency, or crisis decisions.","urgent_support_guidance":"If there is immediate danger, contact local emergency services or a trusted person nearby now."}';

ALTER TABLE tasks ADD COLUMN friction_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN friction_note TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_friction ON tasks(friction_type, status);
