// The wire boundary: only messages exactly in the protocol parse; anything else throws ProtocolError.
import { describe, expect, it } from 'vitest';
import { battleCardIds } from '@five-sects/sim';
import { CODE_ALPHABET, MAX_CLIENT_BYTES, ProtocolError, cleanName, leaderPool, normalizeCode, parseClient, parseServer, teamError } from '../src';

const card = leaderPool()[0]!, card2 = leaderPool()[1]!;
const bad = (x: unknown) => expect(() => parseClient(typeof x === 'string' ? x : JSON.stringify(x))).toThrow(ProtocolError);

describe('client messages', () => {
  it('accepts each message type in its exact shape', () => {
    const ok = [
      { t: 'hello', v: 1, name: 'ลมปราณ' }, { t: 'hello', v: 1, name: 'a', token: 'A'.repeat(43) }, { t: 'create' }, { t: 'join', code: 'ABC234' },
      { t: 'team', team: { leader: card, sub: card2 } }, { t: 'ready', on: true }, { t: 'leave' },
      { t: 'cmd', tick: 10, c: { t: 'summon', side: 1, card, d: 1200 } }, { t: 'cmd', tick: 0, c: { t: 'cannon', side: 0, d: 0 } },
      { t: 'hash', tick: 100, h: '0123abcd' }, { t: 'ping', n: 7 },
    ];
    for (const m of ok) expect(parseClient(JSON.stringify(m))).toEqual(m);
  });

  it('rejects unknown types, unknown or missing fields, wrong types and bad values', () => {
    bad('not json'); bad('[]'); bad('null'); bad({}); bad({ t: 'nope' }); bad({ t: '__proto__' }); bad({ t: 'toString' });
    bad({ t: 'create', extra: 1 }); bad({ t: 'join' }); bad({ t: 'join', code: 5 }); bad({ t: 'ready', on: 'yes' });
    bad({ t: 'hello', v: 1, name: 'x', token: 'short' }); bad({ t: 'hello', v: 1.5, name: 'x' });
    bad({ t: 'cmd', tick: -1, c: { t: 'summon', side: 0, card, d: 0 } }); bad({ t: 'cmd', tick: 1, c: { t: 'summon', side: 2, card, d: 0 } });
    bad({ t: 'cmd', tick: 1, c: { t: 'summon', side: 0, card: 'not_a_card', d: 0 } }); bad({ t: 'cmd', tick: 1, c: { t: 'summon', side: 0, card, d: 0.5 } });
    bad({ t: 'cmd', tick: 1, c: { t: 'redraw', side: 0 } }); bad({ t: 'cmd', tick: 1, c: { t: 'cannon', side: 0, d: 0, card } });
    bad({ t: 'hash', tick: 100, h: 'XYZ' }); bad({ t: 'team', team: { leader: card } });
    bad('{"t":"create","__proto__":{"x":1}}');
  });

  it('rejects a message over the size limit before parsing it', () => {
    bad(JSON.stringify({ t: 'hello', v: 1, name: 'x'.repeat(MAX_CLIENT_BYTES) }));
    expect(() => parseClient(new Uint8Array([0xff, 0xfe]))).toThrow(ProtocolError);
  });
});

describe('server messages', () => {
  it('parses what the server sends and rejects the rest', () => {
    const start = { t: 'start', seat: 1, seed: 5, teams: [{ leader: card, sub: card2 }, { leader: card2, sub: card }], names: ['a', 'b'], inMs: 2000, tick: 0, frames: { 3: [{ t: 'cannon', side: 0, d: 10 }] } };
    expect(parseServer(JSON.stringify(start))).toEqual(start);
    expect(() => parseServer(JSON.stringify({ ...start, frames: { abc: [] } }))).toThrow(ProtocolError);
    expect(() => parseServer(JSON.stringify({ t: 'error', code: 'whatever' }))).toThrow(ProtocolError);
  });
});

describe('codes, names and teams', () => {
  it('room codes: case and dashes forgiven, lookalikes refused', () => {
    expect(normalizeCode('abc-234')).toBe('ABC234');
    expect(normalizeCode('ABC23O')).toBeNull(); // O is not in the alphabet
    expect(normalizeCode('ABC23')).toBeNull();
    for (const ch of '01OILUV') expect(CODE_ALPHABET.includes(ch)).toBe(false);
  });
  it('names keep Thai letters and refuse markup and control characters', () => {
    expect(cleanName('  เจ้า  สำนัก ')).toBe('เจ้า สำนัก');
    expect(cleanName('<b>x</b>')).toBeNull();
    expect(cleanName('a\u0000b')).toBeNull();
    expect(cleanName('x'.repeat(17))).toBeNull();
  });
  it('a team is two different non-basic cards of the ranked pool', () => {
    expect(teamError({ leader: card, sub: card2 })).toBeNull();
    expect(teamError({ leader: card, sub: card })).not.toBeNull();
    const basic = battleCardIds.find((c) => !leaderPool().includes(c))!;
    expect(teamError({ leader: basic, sub: card })).not.toBeNull();
  });
});
