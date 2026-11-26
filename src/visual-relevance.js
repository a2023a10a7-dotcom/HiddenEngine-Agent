const DEFAULT_STOP_WORDS = new Set(["with","from","that","this","into","over","under","china","modern","technology","factory","industrial","manufacturing","production","assembly","workers","equipment","plant","market","product","line","system","business","city","global","aerial","advanced","company","industry","facility","machine","machines","process"]);

export function tokenizeVisualQuery(value, stopWords = DEFAULT_STOP_WORDS) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2 && !stopWords.has(token));
}

export function scoreVisualCandidate({ query, tags, requirementGroups = [], synonyms = {} }) {
  const normalizedTags = String(tags || "").toLowerCase();
  const tokens = tokenizeVisualQuery(query);
  const matchedTokens = tokens.filter(token =>
    [token, ...(synonyms[token] || [])].some(term => normalizedTags.includes(term))
  );
  const matchedGroups = requirementGroups.map(group =>
    (Array.isArray(group) ? group : []).some(term => {
      const value = String(term || "").toLowerCase().trim();
      if (!value) return false;
      if (normalizedTags.includes(value)) return true;
      return tokenizeVisualQuery(value).some(token =>
        [token, ...(synonyms[token] || [])].some(term => normalizedTags.includes(term))
      );
    })
  );
  const specificSingleTerm = matchedTokens.length === 1 && matchedTokens[0].length >= 10;
  const queryIsSpecificEnough = matchedTokens.length >= 2 || specificSingleTerm || matchedGroups.filter(Boolean).length >= 2;
  const requiredGroupsSatisfied = requirementGroups.length === 0 || matchedGroups.some(Boolean);
  const score = matchedTokens.reduce((total, token) => total + (token.length > 5 ? 5 : 3), 0)
    + matchedGroups.filter(Boolean).length * 3;
  return {
    score,
    matchedTokens,
    matchedGroups,
    accepted: queryIsSpecificEnough && requiredGroupsSatisfied
  };
}
