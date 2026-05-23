import {
  buildDomainAppropriateFirstQuestion,
  classifySituationDomain,
  type SituationRoutingContext,
} from "./situation-routing";

export { classifySituationDomain };

export function buildFirstIntakeQuestion(situation: SituationRoutingContext) {
  return buildDomainAppropriateFirstQuestion(situation);
}
