/**
 * HLTV Team Matches → iCal feed
 * --------------------------------
 * Exposes an ICS calendar for any HLTV team (by id + slug), e.g. FaZe (6667/faze).
 *
 * Example: GET /team/6667/faze.ics   → subscribable iCal
 * Optional query: ?duration=150 (minutes per event, default 120)
 */

const express = require('express');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Basic in-memory cache to avoid hammering HLTV.
const CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

function nowUtcISOString() {
  return new Date().toISOString();
}

function fmtIcsDateUTC(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function icsEscape(text = '') {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line) {
  const limit = 75;
  if (line.length <= limit) return line;
  const parts = [];
  while (line.length > limit) {
    parts.push(line.slice(0, limit));
    line = ' ' + line.slice(limit);
  }
  parts.push(line);
  return parts.join('\r\n');
}

function buildICS({ events = [], calName = 'HLTV Matches', prodId = '-//hltv-ical//EN' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${icsEscape(calName)}`,
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  const dtstamp = fmtIcsDateUTC(new Date());
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldIcsLine(`UID:${icsEscape(ev.uid)}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${fmtIcsDateUTC(ev.start)}`);
    if (ev.end) lines.push(`DTEND:${fmtIcsDateUTC(ev.end)}`);
    if (ev.summary) lines.push(foldIcsLine(`SUMMARY:${icsEscape(ev.summary)}`));
    if (ev.description) lines.push(foldIcsLine(`DESCRIPTION:${icsEscape(ev.description)}`));
    if (ev.url) lines.push(foldIcsLine(`URL:${icsEscape(ev.url)}`));
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(foldIcsLine(`DESCRIPTION:${icsEscape(ev.summary || 'HLTV Match')}`));
    lines.push('TRIGGER:-PT15M');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function fetchWithCache(url) {
  const cached = CACHE.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.body;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'HLTV-iCal/1.0 (+https://example.com) Node.js',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  CACHE.set(url, { ts: now, body: text });
  return text;
}

function parseMatches(html, teamLabelForSummary = '') {
  const $ = cheerio.load(html);
  const events = [];
  $('table.match-table').each((_, tbl) => {
    const $tbl = $(tbl);
    const siblings = $tbl.children('thead, tbody');
    let currentEventName = '';
    siblings.each((__, sib) => {
      const $sib = $(sib);
      if ($sib.is('thead')) {
        const name = $sib.find('tr.event-header-cell a').first().text().trim();
        if (name) currentEventName = name;
      } else if ($sib.is('tbody')) {
        $sib.find('tr.team-row').each((___, tr) => {
          const $tr = $(tr);
          const unixStr = $tr.find('td.date-cell span[data-unix]').first().attr('data-unix');
          if (!unixStr) return;
          const start = new Date(Number(unixStr));
          const team1 = $tr.find('.team-center-cell a.team-name.team-1').first().text().trim();
          const team2 = $tr.find('.team-center-cell a.team-name.team-2').first().text().trim();
          const matchRelUrl = $tr.find('td.matchpage-button-cell a.matchpage-button').attr('href');
          const matchUrl = matchRelUrl ? new URL(matchRelUrl, 'https://www.hltv.org').toString() : undefined;
          let uid = `hltv-${start.getTime()}`;
          const idMatch = matchRelUrl && matchRelUrl.match(/\/matches\/(\d+)\//);
          if (idMatch) uid = `hltv-match-${idMatch[1]}`;
          const summary = `${team1 || teamLabelForSummary} vs ${team2 || ''}`.replace(/\s+vs\s+$/, '').trim() + (currentEventName ? ` — ${currentEventName}` : '');
          const description = [
            currentEventName ? `Event: ${currentEventName}` : '',
            team1 && team2 ? `Match: ${team1} vs ${team2}` : '',
            matchUrl ? `HLTV: ${matchUrl}` : '',
          ].filter(Boolean).join('\n');
          events.push({ uid, start, team1, team2, summary, description, url: matchUrl });
        });
      }
    });
  });
  return events;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: nowUtcISOString() });
});

app.get(['/team/:id/:slug.ics', '/team/:id.ics'], async (req, res) => {
  try {
    const { id, slug } = req.params;
    const minutes = Math.max(1, Math.min(24 * 60, parseInt(req.query.duration, 10) || 120));
    const teamSlug = slug || 'team';
    const url = `https://www.hltv.org/team/${encodeURIComponent(id)}/${encodeURIComponent(teamSlug)}#tab-matchesBox`;
    const html = await fetchWithCache(url);
    const eventsRaw = parseMatches(html);
    const now = Date.now();
    const upcoming = eventsRaw
      .map((e) => ({ ...e, end: new Date(e.start.getTime() + minutes * 60 * 1000) }))
      .filter((e) => e.start && e.end && e.end.getTime() >= now - 5 * 60 * 1000)
      .sort((a, b) => a.start - b.start);
    let calName = 'HLTV';
    try {
      const u = new URL(url);
      const slugName = u.pathname.split('/').filter(Boolean)[2] || '';
      calName = `HLTV — ${slugName}`;
    } catch {}
    const ics = buildICS({ events: upcoming, calName });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, max-age=120');
    res.status(200).send(ics);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`HLTV iCal service listening on http://localhost:${PORT}`);
});
