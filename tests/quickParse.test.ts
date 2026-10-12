import { describe, expect, it } from 'vitest';
import { isUnderstood, parseQuickEvent, toEventInput } from '../shared/quickParse';

// Wednesday 14 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0);
const p = (text: string, now = NOW) => parseQuickEvent(text, now);

describe('English', () => {
  it.each([
    ['Call Ana tomorrow at 3pm', 'Call Ana', '2026-10-15', '15:00'],
    ['Dentist next monday 9am', 'Dentist', '2026-10-19', '09:00'],
    ['Gym today at 18:00', 'Gym', '2026-10-14', '18:00'],
    ['Call mom at noon tomorrow', 'Call mom', '2026-10-15', '12:00'],
    ['Party on the 20th at 8pm', 'Party', '2026-10-20', '20:00'],
    ['Exam 25/11 at 8', 'Exam', '2026-11-25', '08:00'],
    ['Meeting on May 3 at 2pm', 'Meeting', '2027-05-03', '14:00'],
    ['Lunch on 3 May at 1pm', 'Lunch', '2027-05-03', '13:00'],
    ['tomorrow 3pm Call Ana', 'Call Ana', '2026-10-15', '15:00'],
    ['Plan trip day after tomorrow at 11:30', 'Plan trip', '2026-10-16', '11:30'],
    ['Taxes on friday', 'Taxes', '2026-10-16', undefined],
    ['Review on mon at 4pm', 'Review', '2026-10-19', '16:00'],
  ])('%s', (text, title, date, time) => {
    const r = p(text);
    expect(r.title).toBe(title);
    expect(r.date).toBe(date);
    expect(r.time).toBe(time);
  });

  it('chooses am or pm sensibly when it is not stated', () => {
    expect(p('Walk tomorrow at 3').time).toBe('15:00');
    expect(p('Breakfast tomorrow at 7').time).toBe('07:00');
    expect(p('Dinner tomorrow at 8').time).toBe('20:00');
    expect(p('Meeting tomorrow at 12').time).toBe('12:00');
    expect(p('Flight tomorrow at 14:45').time).toBe('14:45');
    expect(p('Alarm tomorrow at 12am').time).toBe('00:00');
    expect(p('Brunch tomorrow at 10 in the morning').time).toBe('10:00');
    expect(p('Movie tomorrow at 9 in the evening').time).toBe('21:00');
  });

  it('reads durations', () => {
    expect(p('Lunch with Bob friday at 1pm for 2 hours').durationMinutes).toBe(120);
    expect(p('Coffee tomorrow 10am 30 min').durationMinutes).toBe(30);
    expect(p('Yoga for 45 minutes tomorrow at 7am').durationMinutes).toBe(45);
    expect(p('Review half an hour friday 4pm').durationMinutes).toBe(30);
    expect(p('Workshop tomorrow 9am for 1h30').durationMinutes).toBe(90);
    expect(p('Nap tomorrow at 2pm for an hour').durationMinutes).toBe(60);
    expect(p('Lunch with Bob friday at 1pm for 2 hours').title).toBe('Lunch with Bob');
  });

  it('knows relative dates', () => {
    expect(p('Haircut in 3 days').date).toBe('2026-10-17');
    expect(p('Review in 2 weeks').date).toBe('2026-10-28');
    expect(p('Planning next week').date).toBe('2026-10-21');
    expect(p('Dinner tonight')).toMatchObject({ date: '2026-10-14', time: '20:00' });
    expect(p('Deadline 2026-12-01').date).toBe('2026-12-01');
  });

  it('resolves weekdays to their next occurrence, never today', () => {
    expect(p('Yoga wednesday').date).toBe('2026-10-21'); // today is Wednesday
    expect(p('Yoga thursday').date).toBe('2026-10-15');
    expect(p('Yoga sunday').date).toBe('2026-10-18');
  });
});

describe('Portuguese', () => {
  it.each([
    ['Reunião com o João amanhã às 15h', 'Reunião com o João', '2026-10-15', '15:00'],
    ['Dentista dia 20 às 9h', 'Dentista', '2026-10-20', '09:00'],
    ['Almoço sexta 13h', 'Almoço', '2026-10-16', '13:00'],
    ['Prova de cálculo 25/11 às 8h', 'Prova de cálculo', '2026-11-25', '08:00'],
    ['Jantar sábado às 8 da noite', 'Jantar', '2026-10-17', '20:00'],
    ['Aula de inglês segunda às 3 da tarde', 'Aula de inglês', '2026-10-19', '15:00'],
    ['Médico depois de amanhã às 10', 'Médico', '2026-10-16', '10:00'],
    ['Reunião 3 de maio às 14h', 'Reunião', '2027-05-03', '14:00'],
    ['Churrasco próximo sábado', 'Churrasco', '2026-10-17', undefined],
    ['Futebol sexta-feira às 19h30', 'Futebol', '2026-10-16', '19:30'],
    ['Feira domingo que vem às 9h', 'Feira', '2026-10-18', '09:00'],
    ['Estudar em 2 dias', 'Estudar', '2026-10-16', undefined],
    ['Cinema hoje à noite', 'Cinema', '2026-10-14', '20:00'],
  ])('%s', (text, title, date, time) => {
    const r = p(text);
    expect(r.title).toBe(title);
    expect(r.date).toBe(date);
    expect(r.time).toBe(time);
  });

  it('reads durations in Portuguese', () => {
    expect(p('Almoço sexta 13h por 2 horas').durationMinutes).toBe(120);
    expect(p('Reunião amanhã às 10h por 45 minutos').durationMinutes).toBe(45);
    expect(p('Treino amanhã 7h por meia hora').durationMinutes).toBe(30);
    expect(p('Aula amanhã às 9h por 1h30').durationMinutes).toBe(90);
    expect(p('Almoço sexta 13h por 2 horas').title).toBe('Almoço');
  });

  it('treats "meio-dia" as noon and does not mistake the verb "ter" for Tuesday', () => {
    expect(p('Café com a Ana meio-dia').time).toBe('12:00');
    expect(p('Ter reunião às 10h').date).toBeUndefined();
    expect(p('Ter reunião às 10h').title).toBe('Ter reunião');
  });
});

describe('text that is not an event', () => {
  it('leaves plain text alone', () => {
    const r = p('Buy milk');
    expect(r).toMatchObject({ title: 'Buy milk', date: undefined, time: undefined });
    expect(isUnderstood(r)).toBe(false);
  });

  it('does not invent dates from ordinary words and numbers', () => {
    expect(p('Sun cream shopping').date).toBeUndefined();
    expect(p('Room 5 meeting').time).toBeUndefined();
    expect(p('I sat down to think about it').date).toBeUndefined();
    expect(p('Pitch at 25:00').time).toBeUndefined();
    expect(p('May the force be with you').date).toBeUndefined();
    expect(p('Version 2.5 release').time).toBeUndefined();
  });

  it('never returns an empty title', () => {
    expect(p('tomorrow at 3pm').title).toBe('Tomorrow at 3pm');
    expect(p('amanhã').title).toBe('Amanhã');
  });

  it('keeps the original capitalisation of the title', () => {
    expect(p('Call ANA tomorrow 3pm').title).toBe('Call ANA');
    expect(p('lunch tomorrow 1pm').title).toBe('Lunch');
  });
});

describe('turning it into an event', () => {
  it('a date and a time make a timed event with the duration', () => {
    expect(toEventInput(p('Almoço sexta 13h por 2 horas'), NOW)).toEqual({ title: 'Almoço', start: '2026-10-16T13:00', durationMinutes: 120 });
  });

  it('a date alone makes an all-day event', () => {
    expect(toEventInput(p('Dentista dia 20'), NOW)).toEqual({ title: 'Dentista', start: '2026-10-20', allDay: true });
  });

  it('a time alone means the next time that clock time comes round', () => {
    expect(toEventInput(p('Standup at 9:30'), NOW).start).toBe('2026-10-15T09:30'); // 09:30 has passed (it is 10:00)
    expect(toEventInput(p('Lunch at 1pm'), NOW).start).toBe('2026-10-14T13:00');
  });

  it('nothing understood gives no start', () => {
    expect(toEventInput(p('Buy milk'), NOW)).toEqual({ title: 'Buy milk', start: '' });
  });

  it('rolls dates that already passed to next year, and ignores days that do not exist', () => {
    expect(p('Birthday 3/2').date).toBe('2027-02-03'); // 3 February has passed this year
    expect(p('Birthday 31/2').date).toBeUndefined();
    expect(p('Birthday 29/2/2028').date).toBe('2028-02-29'); // a real leap day
    expect(p('Birthday 29/2/2027').date).toBeUndefined();
  });
});
