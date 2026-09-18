// Turns the on-air XML into a flat list of {artist, title, time} entries.
//
// The station is free to rename or restructure its fields at any time, and the
// feed is not documented anywhere, so nothing here is hard-coded to one shape:
// elements and attributes are matched by what their names mean, and a feed that
// packs "Artist - Title" into a single field is split on the separator.

import { parseXml, textOf } from './xml.js';

const IGNORED_SUFFIX = /(id|guid|code|url|uri|link|image|img|pic|logo|cover|artwork|file|path|type|kind|lang|index|num|number|count|duration|length)$/;

const ROLE_RULES = [
  { role: 'artist', re: /^(artist|artists|artistname|performer|performers|singer|band|composer|interpret|trackartist|songartist|מבצע|מבצעים|אמן|אמנית|זמר|זמרת|להקה)$/ },
  { role: 'title', re: /^(title|titles|songtitle|tracktitle|songname|trackname|song|track|שיר|שםהשיר)$/ },
  { role: 'combined', re: /^(nowplaying|nowonair|onair|current|currentsong|currenttrack|playing|nowplayingtext|display|displaytext|caption)$/ },
  { role: 'time', re: /^(time|starttime|startdate|playtime|playeddate|playedat|airtime|timestamp|date|datetime|hour|start|שעה|תאריך)$/ },
  { role: 'artist', re: /(artist|performer|singer|vocalist|מבצע)/ },
  { role: 'title', re: /(songtitle|tracktitle|songname|trackname)/ },
  { role: 'time', re: /(time|date|clock)/ },
];

// Fields that describe the programme rather than the song.
const PROGRAMME = /(program|programme|show|presenter|host|broadcast|channel|station|announcer|תוכנית|מגיש)/;

const SEPARATORS = [' - ', ' – ', ' — ', ' | ', ' / ', ' ~ ', ' * '];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9֐-׿]/g, '');
}

function roleOf(key) {
  const normalized = normalizeKey(key);
  if (!normalized || PROGRAMME.test(normalized)) return null;
  if (IGNORED_SUFFIX.test(normalized) && !/^(date|time|start)$/.test(normalized)) return null;
  for (const rule of ROLE_RULES) {
    if (rule.re.test(normalized)) return rule.role;
  }
  return null;
}

const isLeaf = (node) => node.children.length === 0;
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Field name -> value, taken from the node's attributes and its leaf children. */
function fieldsOf(node, ownOnly = false) {
  const fields = [];
  for (const [key, value] of Object.entries(node.attrs)) {
    if (clean(value)) fields.push([key, clean(value)]);
  }
  for (const child of ownOnly ? [] : node.children) {
    if (!isLeaf(child)) continue;
    for (const [key, value] of Object.entries(child.attrs)) {
      if (clean(value)) fields.push([`${child.name}${key}`, clean(value)]);
    }
    if (clean(child.text)) fields.push([child.name, clean(child.text)]);
  }
  if (isLeaf(node) && clean(node.text)) fields.push([node.name, clean(node.text)]);
  return fields;
}

function splitCombined(value) {
  for (const separator of SEPARATORS) {
    const at = value.indexOf(separator);
    if (at > 0 && at < value.length - separator.length) {
      return {
        artist: clean(value.slice(0, at)),
        title: clean(value.slice(at + separator.length)),
      };
    }
  }
  return null;
}

function entryFrom(node, ownOnly = false) {
  const fields = fieldsOf(node, ownOnly);
  const picked = { artist: '', title: '', time: '', combined: '' };
  for (const [key, value] of fields) {
    const role = roleOf(key);
    if (role && !picked[role]) picked[role] = value;
  }

  if (!picked.artist && picked.combined) {
    const split = splitCombined(picked.combined);
    if (split) Object.assign(picked, split);
    else if (!picked.title) picked.title = picked.combined;
  }
  if (!picked.artist && picked.title) {
    const split = splitCombined(picked.title);
    if (split) Object.assign(picked, split);
  }
  if (!picked.artist && !picked.title) return null;

  return {
    artist: picked.artist,
    title: picked.title,
    time: picked.time,
    raw: clean(textOf(node)),
    element: node.name,
    structured: true,
  };
}

// A leaf child that is a whole song on its own ("<song artist=.. title=..>", or
// "<track>Artist - Title</track>"). Such children are siblings in a list, so they
// must not be folded into a single entry on their parent.
function standaloneChildren(node) {
  const entries = [];
  for (const child of node.children) {
    if (!isLeaf(child)) continue;
    const entry = entryFrom(child, true);
    if (entry && entry.artist && entry.title) entries.push(entry);
  }
  return entries;
}

function timeOf(node) {
  for (const [key, value] of fieldsOf(node)) {
    if (roleOf(key) === 'time') return value;
  }
  return '';
}

function collect(node, out) {
  const standalone = standaloneChildren(node);
  if (standalone.length > 0) {
    const fallbackTime = timeOf(node);
    for (const entry of standalone) {
      if (!entry.time) entry.time = fallbackTime;
      out.push(entry);
    }
    for (const child of node.children) {
      if (!isLeaf(child)) collect(child, out);
    }
    return;
  }

  const entry = entryFrom(node);
  if (entry) out.push(entry);
  for (const child of node.children) {
    // Once a node produced an entry, its leaf children are that entry's fields;
    // only deeper structures (a history list, a "next up" block) can hold more.
    if (entry && isLeaf(child)) continue;
    collect(child, out);
  }
}

/**
 * @param {string} xml raw feed body
 * @returns {Array<{artist: string, title: string, time: string, raw: string, structured: boolean}>}
 */
export function parseEntries(xml) {
  const document = parseXml(xml);
  const collected = [];
  collect(document, collected);

  const seen = new Set();
  const entries = [];
  for (const entry of collected) {
    const key = JSON.stringify([entry.artist, entry.title, entry.time]).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  if (entries.length === 0) {
    // Unknown shape: keep the text so the watchlist can still be matched against
    // it, and let the caller warn that the feed was not understood.
    const raw = clean(textOf(document));
    if (raw) entries.push({ artist: '', title: '', time: '', raw, element: '', structured: false });
  }
  return entries;
}

export function describeEntry(entry) {
  if (entry.artist && entry.title) return `${entry.artist} – ${entry.title}`;
  return entry.artist || entry.title || entry.raw;
}
