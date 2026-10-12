/**
 * Finding video-call links in calendar events, and deciding which external links the app may open.
 * Pure functions, shared by the main process (calendar mapping, link opening) and the UI.
 */

/** Hosts of video-meeting services. A host matches itself and any subdomain. */
const MEETING_HOSTS = [
  'zoom.us', 'zoom.com', 'zoomgov.com', 'teams.microsoft.com', 'teams.live.com', 'meet.google.com',
  'webex.com', 'whereby.com', 'gotomeeting.com', 'goto.com', 'bluejeans.com', 'meet.jit.si', 'chime.aws', 'around.co',
];

const GOOGLE_HOSTS = ['google.com'];

const hostMatches = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

function httpsHost(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export const isMeetingUrl = (url: string): boolean => {
  const host = httpsHost(url);
  return !!host && hostMatches(host, MEETING_HOSTS);
};

/** Links the interface is allowed to open in the browser: Google pages and video-meeting services, over https only. */
export const isAllowedExternalUrl = (url: string): boolean => {
  const host = httpsHost(url);
  return !!host && hostMatches(host, [...GOOGLE_HOSTS, ...MEETING_HOSTS]);
};

const URL_PATTERN = /https:\/\/[^\s<>"')\]]+/gi;

/** The first video-meeting link found in the given texts (location, description, ...), without trailing punctuation. */
export function findMeetingLink(...texts: (string | undefined | null)[]): string | undefined {
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.match(URL_PATTERN) ?? []) {
      const url = match.replace(/[.,;:!?]+$/, '');
      if (isMeetingUrl(url)) return url;
    }
  }
  return undefined;
}

/** Minutes before the start of an event during which the "Join" button is offered. */
export const JOIN_WINDOW_MINUTES = 15;

/** True when it is time to offer joining: shortly before the start, and until the event ends. */
export function canJoinNow(event: { start: string; end: string; joinUrl?: string; allDay?: boolean }, now = new Date()): boolean {
  if (!event.joinUrl || event.allDay) return false;
  const start = +new Date(event.start);
  const end = +new Date(event.end);
  return +now >= start - JOIN_WINDOW_MINUTES * 60_000 && +now < end;
}
