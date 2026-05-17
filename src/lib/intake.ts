import type { SituationUrgency } from "./types";
import {
  immediateDangerCopy,
  isCrisisSupportText,
  isDatingOrSexualConnectionSituation,
  isImmediateDangerText,
  isSocialConnectionSituation,
  usCrisisSupportCopy,
} from "./social-connection";

type SituationPromptContext = {
  title: string;
  category: string;
  urgency: SituationUrgency;
};

function situationOpeningQuestion(situation: SituationPromptContext) {
  const focus = `${situation.category} ${situation.title}`.toLowerCase();

  if (situation.urgency === "crisis") {
    return "Before we plan steps, what would make this situation safer or more stable in the next few hours?";
  }

  if (isSocialConnectionSituation(situation)) {
    if (isDatingOrSexualConnectionSituation(situation)) {
      return "What kind of connection are you trying to build right now, and are there any consent, boundary, or safety constraints FlowPath should account for?";
    }

    if (
      focus.includes("lonely") ||
      focus.includes("isolat") ||
      focus.includes("no friends") ||
      focus.includes("social life")
    ) {
      return "Which feels closest right now: not enough people in your life, people around you but not enough closeness, lost touch, not knowing where you belong, avoiding reaching out, or something else?";
    }

    if (focus.includes("breakup")) {
      return "What kind of connection are you trying to rebuild after this change: regular contact, friendship, community, dating, or something else?";
    }

    return "What kind of connection are you trying to build or repair, and what makes it hard right now?";
  }

  if (situation.urgency === "high") {
    return "What would make this feel less risky or more under control in the next 24 hours?";
  }

  if (focus.includes("housing")) {
    return "What would make this housing situation safer or more stable in the next 24 hours?";
  }

  if (focus.includes("money") || focus.includes("financial")) {
    return "What would make this money situation more stable or less exposed in the next 24 hours?";
  }

  if (focus.includes("health")) {
    return "What would a realistic, body-respecting improvement look like in the next 24-72 hours?";
  }

  if (focus.includes("business") || focus.includes("startup")) {
    return "What concrete outcome would make this business situation meaningfully more real, validated, or unstuck over the next 24-72 hours?";
  }

  if (focus.includes("career") || focus.includes("job")) {
    return "What would count as real progress on this career situation over the next 24-72 hours?";
  }

  if (focus.includes("creative") || focus.includes("acting")) {
    return "What would make this creative situation measurably more alive, shipped, or unstuck over the next 24-72 hours?";
  }

  if (focus.includes("overwhelm")) {
    return "What would make this feel simpler or more contained by the end of today?";
  }

  if (focus.includes("recovery") || focus.includes("recover")) {
    return "What would a small stabilizing step look like today?";
  }

  if (focus.includes("stuck")) {
    return "What would make this feel meaningfully unstuck in the next 24-72 hours?";
  }

  return "What would meaningful progress look like in the next 24-72 hours?";
}

export function buildFirstIntakeQuestion(situation: SituationPromptContext) {
  const situationText = `${situation.category} ${situation.title}`;
  if (isImmediateDangerText(situationText)) {
    return immediateDangerCopy;
  }
  if (isCrisisSupportText(situationText)) {
    return usCrisisSupportCopy;
  }

  return situationOpeningQuestion(situation);
}
