import {
  classifySituationDomain,
  type FirstIntakeQuestionPurpose,
  type SituationRoutingContext,
} from "./situation-routing";

export { classifySituationDomain };

export type IntakeRoutingMetadata = {
  domain: string;
  subtype: string;
  questionPurpose: FirstIntakeQuestionPurpose;
};

export function buildIntakeRoutingMetadata(
  situation: SituationRoutingContext,
): IntakeRoutingMetadata {
  const route = classifySituationDomain(situation);
  return {
    domain: route.domain,
    subtype: route.domain,
    questionPurpose:
      route.domain === "crisis_safety" ? "clarify_risk_or_safety" : "clarify_goal",
  };
}
