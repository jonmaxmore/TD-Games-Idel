// The client half of the lockstep: the same sim as the server, stepped only on the server's frames. Shared by the browser
// client and the headless test clients, so both play exactly what the server played.
import { battleHash, battleOver, createBattle, stepBattle, type BattleCommand, type BattleEvent, type BattleState, type Side } from '@five-sects/sim';
import { HASH_EVERY, INPUT_DELAY, PVP_OPTS, pvpSetup, type ClientMsg, type NetCommand, type ServerMsg } from './index';

export class Lockstep {
  readonly s: BattleState;
  readonly seat: Side;
  readonly log: Record<number, BattleCommand[]> = {}; // every tick that had commands, as a BattleRecord's commands
  private ahead = new Map<number, NetCommand[]>();

  // A match from its start message; on a reconnect it replays the history up to the server's tick first.
  constructor(readonly start: Extract<ServerMsg, { t: 'start' }>) {
    this.seat = start.seat;
    this.s = createBattle(start.seed, pvpSetup(start.teams[0]), pvpSetup(start.teams[1]), PVP_OPTS);
    while (this.s.tick < start.tick && !battleOver(this.s)) this.apply(start.frames[String(this.s.tick)] ?? []);
  }

  frame(tick: number, cmds: NetCommand[]): void { if (tick >= this.s.tick) this.ahead.set(tick, cmds); }
  get buffered(): number { return this.ahead.size; }

  // Steps every frame that has arrived, in order; returns the hash messages to send (every HASH_EVERY ticks).
  run(onTick?: (ev: BattleEvent[]) => void, max = Infinity): ClientMsg[] {
    const out: ClientMsg[] = [];
    for (let n = 0; n < max && !battleOver(this.s); n++) {
      const cmds = this.ahead.get(this.s.tick);
      if (!cmds) break;
      this.ahead.delete(this.s.tick);
      const ev = this.apply(cmds);
      onTick?.(ev);
      if (this.s.tick % HASH_EVERY === 0 || battleOver(this.s)) out.push({ t: 'hash', tick: this.s.tick, h: battleHash(this.s) });
    }
    return out;
  }

  // A command of ours, stamped for INPUT_DELAY ticks after the latest frame we have stepped.
  cmd(c: NetCommand): ClientMsg { return { t: 'cmd', tick: this.s.tick + INPUT_DELAY, c }; }

  private apply(cmds: NetCommand[]): BattleEvent[] {
    if (cmds.length > 0) this.log[this.s.tick] = cmds;
    return stepBattle(this.s, cmds);
  }
}
