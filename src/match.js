// Deciding whether a feed entry is one of the artists being watched.
//
// Feeds are written by hand by whoever is on shift, so the same band shows up as
// "Imagine Dragons", "IMAGINE DRAGONS", "Imagine Dragons feat. JID" or in Hebrew
// transliteration. Everything is normalized before comparing, and Hebrew aliases
// are compared after stripping the geresh, which is typed half a dozen ways.

const GERESH = /['‘’׳״"“”]/g;

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(GERESH, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9֐-׿]+/g, ' ')
    .trim();
}

function aliasesOf(artist) {
  const names = [artist.name, ...(artist.aliases ?? [])];
  return [...new Set(names.map(normalize).filter(Boolean))];
}

function contains(haystack, needle) {
  if (!haystack || !needle) return false;
  // Word-boundary-ish check so "dragon" does not match "dragonfly".
  return ` ${haystack} `.includes(` ${needle} `)
    || haystack === needle
    || haystack.startsWith(`${needle} `)
    || haystack.endsWith(` ${needle}`);
}

/**
 * @returns {{artist: string, field: string} | null}
 */
export function matchEntry(entry, artists) {
  for (const artist of artists) {
    const aliases = aliasesOf(artist);
    const fields = entry.structured
      ? (artist.matchFields ?? ['artist', 'title'])
      : ['raw'];
    for (const field of fields) {
      const value = normalize(entry[field]);
      if (!value) continue;
      if (aliases.some((alias) => contains(value, alias))) {
        return { artist: artist.name, field };
      }
    }
  }
  return null;
}

export function matchEntries(entries, artists) {
  const hits = [];
  for (const entry of entries) {
    const match = matchEntry(entry, artists);
    if (match) hits.push({ ...entry, match });
  }
  return hits;
}
