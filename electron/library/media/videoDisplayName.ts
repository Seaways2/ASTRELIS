/** Conservative filename cleanup; never rename the source or guess a translated title. */
export function videoDisplayName(filename: string): { name: string; year?: number } {
  const original = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  let title = original.replace(/[._]+/g, " ").trim();
  // Technical release information begins here; anything before it is retained.
  title = title.split(/(?:\b(?:(?:bd)?2160p|(?:bd)?1080[pi]|720p|480p|4k|8k|uhd|bluray|blu-ray|b[dr]rip|b[dr]remux|bdrip|web[ -]?dl|webrip|hdtv|remux|x26[45]|h[ .]?26[45]|hevc|avc|dts|aac|ac3|flac)\b)/i)[0].trim();
  title = title.replace(/^\[(?:[^\]]*(?:字幕|中字|双语|1080|2160|bluray|webrip|reinforce)[^\]]*)\]\s*/i, "");
  const yearMatch = [...title.matchAll(/(?:^|[\s([（])((?:19|20)\d{2})(?=$|[\s)\]）])/g)].at(-1);
  const year = yearMatch && yearMatch.index! > 0 && title.replace(yearMatch[0], "").replace(/[()（）\[\]\s-]/g, "").length ? Number(yearMatch[1]) : undefined;
  if (year && yearMatch) title = title.slice(0, yearMatch.index).trim() || title;
  title = title.replace(/[\s([（_-]+$/, "").trim();
  return { name: title || original, ...(year ? { year } : {}) };
}
