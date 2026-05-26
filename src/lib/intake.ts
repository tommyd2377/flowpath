import {
  buildDomainAppropriateFirstQuestion,
  buildFirstIntakePlan,
  classifySituationDomain,
  type SituationRoutingContext,
} from "./situation-routing";

export { buildFirstIntakePlan, classifySituationDomain };

export function buildFirstIntakeQuestion(situation: SituationRoutingContext) {
  return buildDomainAppropriateFirstQuestion(situation);
}
