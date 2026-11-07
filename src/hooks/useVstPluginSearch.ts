import { useMemo } from "react";
import Fuse from "fuse.js";

/** Shared plugin search used by both the full database and channel strip. */
export function useVstPluginSearch(plugins: VstPluginInfo[], query: string, includeUnavailable = false) {
  const search = useMemo(() => new Fuse(plugins, {
    includeScore: true,
    threshold: .34,
    distance: 80,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "name", weight: .58 },
      { name: "manufacturer", weight: .15 },
      { name: "category", weight: .11 },
      { name: "format", weight: .07 },
      { name: "version", weight: .04 },
      { name: "path", weight: .05 }
    ]
  }), [plugins]);

  return useMemo(() => {
    const visiblePlugins = plugins.filter(plugin => includeUnavailable || plugin.loadable);
    const visibleIds = new Set(visiblePlugins.map(plugin => plugin.id));
    const normalized = query.trim();
    if (!normalized) return visiblePlugins;
    if (normalized.length === 1) {
      const letter = normalized.toLocaleLowerCase();
      return visiblePlugins.filter(plugin => plugin.name.toLocaleLowerCase().includes(letter));
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 1)
      return search.search(normalized).map(result => result.item).filter(plugin => visibleIds.has(plugin.id));

    const scores = new Map<string, { item: VstPluginInfo; score: number; matches: number }>();
    for (const token of tokens) {
      for (const result of search.search(token)) {
        const current = scores.get(result.item.id) || { item: result.item, score: 0, matches: 0 };
        current.score += result.score ?? 1;
        current.matches += 1;
        scores.set(result.item.id, current);
      }
    }
    return [...scores.values()]
      .filter(result => result.matches === tokens.length && visibleIds.has(result.item.id))
      .sort((left, right) => left.score - right.score)
      .map(result => result.item);
  }, [plugins, query, includeUnavailable, search]);
}
