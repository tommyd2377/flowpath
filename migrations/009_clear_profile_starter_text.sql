UPDATE profile
SET personal_profile = ''
WHERE personal_profile = 'Paste durable context about yourself, where you live or the places you need local advice for, your work, your relationships, your craft or practice goals, your current constraints, and what you want FlowPath to remember here.';

UPDATE profile
SET current_season = ''
WHERE current_season = 'Describe the season you are in: building, recovering, distributing, training, exploring, simplifying, or something else.';

UPDATE profile
SET core_priorities = ''
WHERE core_priorities = 'List the few outcomes that should matter most over the next 30-90 days.';

UPDATE profile
SET constraints = ''
WHERE constraints = 'Name time, energy, health, financial, logistical, and emotional constraints the app should respect.';

UPDATE profile
SET operating_principles = ''
WHERE operating_principles = 'Add principles like: choose leverage over volume, ship small, protect health, do not hide inside planning.';

UPDATE profile
SET remember = ''
WHERE remember = 'Add details FlowPath should keep in mind. The app cannot see ChatGPT memories unless you paste context here.';

UPDATE profile
SET challenge_on = ''
WHERE challenge_on = 'Add patterns you want FlowPath to challenge, like avoidance, over-planning, or over-scoping.';
