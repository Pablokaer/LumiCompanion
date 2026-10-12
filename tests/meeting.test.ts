import { describe, expect, it } from 'vitest';
import { canJoinNow, findMeetingLink, isAllowedExternalUrl, isMeetingUrl, JOIN_WINDOW_MINUTES } from '../shared/meeting';

describe('meeting links', () => {
  it('recognises the common video services, including subdomains', () => {
    for (const url of [
      'https://us02web.zoom.us/j/123456789?pwd=abc', 'https://zoom.us/my/someone', 'https://teams.microsoft.com/l/meetup-join/xyz',
      'https://meet.google.com/abc-defg-hij', 'https://acme.webex.com/meet/room', 'https://whereby.com/room', 'https://meet.jit.si/Room',
    ]) expect(isMeetingUrl(url), url).toBe(true);
  });

  it('rejects look-alikes, other sites and insecure links', () => {
    for (const url of [
      'http://zoom.us/j/1', 'https://zoom.us.evil.com/j/1', 'https://evilzoom.us/j/1', 'https://example.com/zoom.us', 'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe', 'not a url', 'https://notmeet.google.com.evil.io/',
    ]) expect(isMeetingUrl(url), url).toBe(false);
  });

  it('finds the first meeting link in free text, ignoring trailing punctuation and other links', () => {
    expect(findMeetingLink(undefined, 'Docs: https://example.com/x and join https://us02web.zoom.us/j/999?pwd=a1. See you!'))
      .toBe('https://us02web.zoom.us/j/999?pwd=a1');
    expect(findMeetingLink('Room 4', '<a href="https://teams.microsoft.com/l/meetup-join/abc">Join</a>')).toBe('https://teams.microsoft.com/l/meetup-join/abc');
    expect(findMeetingLink('No link here', 'https://example.com/only')).toBeUndefined();
    expect(findMeetingLink(undefined, null, '')).toBeUndefined();
  });

  it('only lets the interface open Google pages and meeting services over https', () => {
    expect(isAllowedExternalUrl('https://mail.google.com/mail/u/0/#drafts')).toBe(true);
    expect(isAllowedExternalUrl('https://docs.google.com/document/d/abc/edit')).toBe(true);
    expect(isAllowedExternalUrl('https://us02web.zoom.us/j/1')).toBe(true);
    expect(isAllowedExternalUrl('https://example.com')).toBe(false);
    expect(isAllowedExternalUrl('http://mail.google.com')).toBe(false);
    expect(isAllowedExternalUrl('https://google.com.evil.io')).toBe(false);
    expect(isAllowedExternalUrl('ms-msdt:/id PCWDiagnostic')).toBe(false);
  });
});

describe('when the join button is offered', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m);
  const event = (extra = {}) => ({ start: at(10).toISOString(), end: at(11).toISOString(), joinUrl: 'https://meet.google.com/abc', ...extra });

  it(`from ${JOIN_WINDOW_MINUTES} minutes before the start until the end`, () => {
    expect(canJoinNow(event(), at(9, 30))).toBe(false);
    expect(canJoinNow(event(), at(9, 44))).toBe(false);
    expect(canJoinNow(event(), at(9, 45))).toBe(true);
    expect(canJoinNow(event(), at(10, 30))).toBe(true);
    expect(canJoinNow(event(), at(11, 0))).toBe(false);
  });

  it('needs a link, and never applies to all-day events', () => {
    expect(canJoinNow(event({ joinUrl: undefined }), at(10, 5))).toBe(false);
    expect(canJoinNow(event({ allDay: true }), at(10, 5))).toBe(false);
  });
});
