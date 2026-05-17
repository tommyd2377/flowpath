ALTER TABLE profile ADD COLUMN context_constraints_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE intake_sessions ADD COLUMN context_constraints_json TEXT NOT NULL DEFAULT '{}';
