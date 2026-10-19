/** A visibly shortened UI preview. The caller retains and can reveal the original. */
export function compactResearchText(value: string, limit = 500): { text: string; shortened: boolean } {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('A research preview needs at least two characters.');
  const characters = Array.from(value);
  if (characters.length <= limit) return { text: value, shortened: false };
  let preview = characters.slice(0, limit - 1).join('');
  const sentence = [...preview.matchAll(/[.!?]["'’”)\]]*(?=\s|$)/gu)].at(-1);
  const sentenceEnd = sentence ? sentence.index + sentence[0].length : 0;
  if (sentenceEnd >= preview.length / 2) preview = preview.slice(0, sentenceEnd);
  else {
    const boundary = preview.search(/\s+\S*$/u);
    if (boundary >= preview.length / 2) preview = preview.slice(0, boundary);
  }
  return { text: `${preview.trimEnd()}…`, shortened: true };
}
