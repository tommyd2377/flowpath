type SituationText = {
  title: string;
  description?: string;
  category: string;
};

const socialConnectionPattern =
  /\b(lonely|loneliness|isolated|isolation|no friends?|social life|make friends?|friendships?|community|belonging|dating|boyfriend|girlfriend|partner|spouse|romance|romantic|sex|sexual connection|intimacy|hookup|dating apps?|breakup|ghosted|rejection|remote work isolation|no one to talk to|disconnected|people do not know me|don't know where i belong|do not know where i belong)\b/i;

const datingPattern =
  /\b(dating|boyfriend|girlfriend|partner|spouse|romance|romantic|sexual connection|sex|hookup|intimacy|dating apps?|breakup|ghosted)\b/i;

const immediateDangerPattern =
  /\b(immediate danger|active violence|someone is going to hurt|about to hurt|medical emergency|call 911|unsafe right now|imminent harm|in danger now)\b/i;

const crisisSupportPattern =
  /\b(suicidal|suicide|kill myself|end my life|self[- ]?harm|hurt myself|severe emotional crisis|crisis support|can't stay safe|cannot stay safe|want to die)\b/i;

export const usCrisisSupportCopy =
  "If you are in the U.S., call or text 988, or use the 988 Lifeline chat at https://988lifeline.org/chat. They provide 24/7 crisis support. If you are outside the U.S., contact your local crisis line or emergency number.";

export const immediateDangerCopy =
  "If you or someone else is in immediate danger, call 911 or your local emergency number now.";

export function isSocialConnectionSituation(situation: SituationText) {
  return socialConnectionPattern.test(
    `${situation.category} ${situation.title} ${situation.description ?? ""}`,
  );
}

export function isDatingOrSexualConnectionSituation(situation: SituationText) {
  return datingPattern.test(
    `${situation.category} ${situation.title} ${situation.description ?? ""}`,
  );
}

export function isImmediateDangerText(text: string) {
  if (/\bnot (in )?immediate danger\b/i.test(text)) return false;
  if (/\bno immediate danger\b/i.test(text)) return false;
  return immediateDangerPattern.test(text);
}

export function isCrisisSupportText(text: string) {
  return crisisSupportPattern.test(text);
}
