/** Bounded, conservative release-name cleanup. Brackets may contain the title. */
export function filmSearchQueries(input: string): string[] {
  const noise = /^(?:ViPHD|DBD[- ]?Raws|[\w.-]+[- ](?:Raws|Fansub)|加长版|加長版|导演剪辑版|導演剪輯版|剧场版|劇場版|修复版|修復版|未删减版|未刪減版|国粤双语|中英双字|简繁字幕|BluRay|BDRip|WEB[- .]?DL|WEBRip|REMUX|(?:1080|2160|720)[pi]|4K|UHD|HEVC|AVC|x26[45]|H\.?26[45]|Extended(?: Edition)?|Director.s Cut)$/i;
  const cleaned = input.normalize("NFKC")
    .replace(/\.(?:mkv|mp4|avi|mov|m2ts|ts|wmv)$/i, "")
    .replace(/\[([^\]]*)\]|【([^】]*)】/g, (_all, a: string, b: string) => {
      const text = (a ?? b).trim();
      const website = /^(?:https?:\/\/)?www[.\s][a-z0-9.\s-]+[.\s](?:com|net|org|cn|tv)$/i.test(text);
      return noise.test(text) || website ? " " : ` ${text} `;
    })
    .replace(/\(([^()]*)\)/g, (all, text: string) =>
      /公映|双语|雙語|配音|字幕|国粤|國粵|加长|加長|剪辑|剪輯|修复|修復/.test(text) ? " " : all)
    .replace(/(?:^|[ ._-])(?:2160p|1080p|720p|BluRay|BDRip|WEB-DL|WEBRip|REMUX|HEVC|x264|x265)(?:[ ._-].*)?$/i, " ")
    .replace(/\s+/g, " ").trim();
  const result: string[] = [];
  const add = (s: string) => { s = s.trim(); if (s && !result.includes(s)) result.push(s); };
  add(cleaned || input.trim());
  // Keep English title runs intact (including numbers, e.g. Salyut 7).
  // Only split scripts in bilingual names; English-only film titles stay whole.
  if (/\p{Script=Han}/u.test(cleaned) && /[A-Za-z]/.test(cleaned)) {
    const runs = cleaned.match(/[A-Za-z][A-Za-z0-9\s.'’:&!?(),+-]*/g) || [];
    for (const run of runs) if ((run.match(/[A-Za-z]/g) || []).length >= 2) add(run);
    const chinese = cleaned.replace(/[A-Za-z][A-Za-z0-9\s.'’:&!?(),+-]*/g, " ").replace(/\s+/g, " ").trim();
    if (/\p{Script=Han}{2}/u.test(chinese)) add(chinese);
  }
  // A colon is a reliable title/subtitle separator; do not split arbitrary words.
  const parts = cleaned.split(/[:：]/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    const subtitle = parts.slice(1).join(": ");
    if (/[\p{L}]{2}/u.test(subtitle)) add(subtitle);
    add(parts[0].replace(/(?:第?[一二三四五六七八九十\d]+部?|\s+[IVX]+)$/i, "").trim());
  }
  return result.slice(0, 3);
}
