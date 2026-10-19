import { InitialResearchOutputSchema, type InitialResearchOutput } from "./model-contracts";

const RESEARCH_KEYS = ["summary", "facts", "uncertainties", "sources"] as const;

/** Read only whole JSON properties; never repair or expose a partial value. */
export function completedResearchPrefix(outputText: string): InitialResearchOutput | null {
  const start = outputText.search(/\S/);
  if (start < 0 || outputText[start] !== "{") return null;

  const stack = ["{"];
  const fields: Record<string, unknown> = {};
  let fieldStart = start + 1;
  let fieldCount = 0;
  let inString = false;
  let escaped = false;

  for (let index = fieldStart; index < outputText.length; index += 1) {
    const character = outputText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{" || character === "[") { stack.push(character); continue; }
    if (character === "}" || character === "]") {
      if (stack.at(-1) !== (character === "}" ? "{" : "[")) return null;
      stack.pop();
    }
    if ((character !== "," || stack.length !== 1) && stack.length !== 0) continue;

    try {
      const entries = Object.entries(JSON.parse(`{${outputText.slice(fieldStart, index)}}`));
      if (entries.length !== 1 || entries[0][0] !== RESEARCH_KEYS[fieldCount]) return null;
      fields[entries[0][0]] = entries[0][1];
    } catch { return null; }
    fieldCount += 1;
    if (fieldCount === RESEARCH_KEYS.length) {
      const result = InitialResearchOutputSchema.safeParse(fields);
      return result.success ? result.data : null;
    }
    if (stack.length === 0) return null;
    fieldStart = index + 1;
  }
  return null;
}
