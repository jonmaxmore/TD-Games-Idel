// C# port of packages/sim/src/defend.ts (+ commands.ts validation). Keep the order of every loop and
// every Math.floor exactly as in TypeScript: ParityTests compares canonical hashes tick by tick.
using System;
using System.Collections.Generic;
using System.Linq;

namespace FiveSects.Sim
{
    public class Command
    {
        public string T;            // place | upgrade | sell | merge | nextWave | cast | pick | target
        public string Sect, Art, Card, Mode;
        public int Tx, Ty, Id, A, B;
    }

    public class SimEvent
    {
        public string E;            // hit | kill | leak | spawn | placed | combo | wave | interest | stun | error | art | offer | picked | newEnemy | end
        public int From, To, Id, Dmg, Pct, X, Y, Amount, Wave;
        public bool Crit, Won;
        public string El, Msg, Name, Type;
        public List<string> Cards;
        public List<bool> Stars;
    }

    public class Disciple
    {
        public int Id, Level = 1, Tx, Ty, X, Y, Cd, Hits, Spent, RootT, PushT, BellT;
        public List<string> Els = new List<string>();
        public string Combo;
        public string Target = "first";
    }

    public class Enemy
    {
        public int Id, Hp, MaxHp, D, Speed, Bounty, X, Y, SlowT, SlowPct, BurnT, BurnDps, Poison, PoisonT, PoisonDps, StunT, LastElT, Age, RegenPct;
        public string Type, El, LastEl, Elite;
        public bool Air, Revealed, Small;
    }

    public class DefendState
    {
        public string StageId, Phase = "build";
        public int Tick, Silver, Lives, Wave, TotalWaves, SpawnT, BreakT, NextId = 1, PathLen, LivesLost, CombosMade, PeakDisciples, BountyMultT, RevealAllT, OfferT;
        public uint Rng;
        public List<string> SpawnQueue = new List<string>();
        public List<Disciple> Disciples = new List<Disciple>();
        public List<Enemy> Enemies = new List<Enemy>();
        public List<string> Unlocked = new List<string>();
        public List<Pt> Path = new List<Pt>();
        public HashSet<string> PathTiles = new HashSet<string>();
        public HashSet<string> Blocked = new HashSet<string>();
        public MapLayout Layout;
        public int[] ArtCd;
        public List<string> Cards = new List<string>();
        public List<string> Offer;
        public List<string> SeenTypes = new List<string>();
        public List<bool> Stars;
        public bool IsOver => Phase == "won" || Phase == "lost";
    }

    public static class Defend
    {
        const int Tile = GameData.Tile, Hz = GameData.TickHz;
        static int AutoStartTicks => 30 * Hz;
        const int DotEvery = GameData.TickHz / 2;

        // Same values as the FX table in defend.ts.
        const int MetalCritPct = 15, MetalEvery = 6, WoodPoisonDps = 8, WoodVulnPct = 25, WaterSlowPct = 30, WaterFreezeEvery = 5;
        const int FireBurnDps = 6, FireSplash = 800, FireExplodeDmg = 30, EarthSplash = Tile, YyReveal = 3 * Tile, YyRatePct = 120;
        const int DashDist = 2 * Tile, HealRange = 1500, HealPct = 5, BruteArmor = 5, AdjacencyPct = 115;
        static readonly int WoodPoisonTicks = 3 * Hz, WoodRootEvery = 8 * Hz, WoodRootTicks = 1 * Hz, WaterSlowTicks = 2 * Hz;
        static readonly int WaterFreezeTicks = JsMath.Round(1.2 * Hz), WaterPushEvery = 12 * Hz, FireBurnTicks = 3 * Hz;
        static readonly int EarthBellEvery = 10 * Hz, EarthBellTicks = 2 * Hz, EarthQuakeTicks = 1 * Hz, DashEvery = 4 * Hz;
        static readonly int HealEvery = Hz, MimicTicks = 3 * Hz;

        static int MaxLevel => GameData.UpgradeLevels;

        public static DefendState Create(string stageId, uint seed)
        {
            var stage = GameData.Stages[stageId];
            var layout = Layouts.Get(stage.Layout, stage.Variant);
            var path = PathMath.ToMilli(layout.Path);
            return new DefendState
            {
                StageId = stageId, Rng = seed, Silver = stage.StartSilver ?? 100, Lives = GameData.StartLives,
                TotalWaves = stage.Waves ?? 10, Unlocked = UnlockedSects(stageId), Path = path, PathLen = PathMath.Length(path),
                PathTiles = PathMath.TilesOnPath(layout.Path), Blocked = Layouts.Blocked(layout), Layout = layout, ArtCd = new int[GameData.Arts.Count],
            };
        }

        public static List<string> UnlockedSects(string stageId)
        {
            var stage = GameData.Stages[stageId];
            if (stage.UnlockAll) return new List<string>(GameData.SectOrder);
            var o = new List<string>();
            foreach (var s in GameData.StageList)
            {
                if (s.Chapter > stage.Chapter) continue;
                if (s.UnlocksSect != null && CompareStage(s.Id, stageId) <= 0) o.Add(s.UnlocksSect);
            }
            foreach (var g in stage.GuestSects) if (!o.Contains(g)) o.Add(g);
            return o;
        }

        // Matches compareStage in TS for "chapter-stage" ids (non-numeric parts compare as "equal" like NaN || ...).
        static int CompareStage(string a, string b)
        {
            var pa = a.Split('-'); var pb = b.Split('-');
            bool okA = int.TryParse(pa[0], out int ac), okB = int.TryParse(pb[0], out int bc);
            if (okA && okB && ac != bc) return ac - bc;
            // TS yields NaN for a non-numeric stage part, and NaN <= 0 is false: never "earlier".
            if (!int.TryParse(pa.Length > 1 ? pa[1] : "", out int as_) || !int.TryParse(pb.Length > 1 ? pb[1] : "", out int bs)) return 1;
            return as_ - bs;
        }

        public static int PlaceCost(string sect) => GameData.Sects[sect].Cost;

        public static int UpgradeCost(Disciple d)
        {
            if (d.Combo != null || d.Level >= MaxLevel) return 0;
            return JsMath.FloorDiv((long)GameData.Sects[d.Els[0]].Cost * GameData.CostPct[d.Level], 100);
        }

        static CardDef Card(DefendState s, string kind) => GameData.Cards.FirstOrDefault(c => c.Kind == kind && s.Cards.Contains(c.Id));

        public static int SellValue(Disciple d, DefendState s)
        {
            int v = Card(s, "sellRefundPct")?.Value ?? 0;
            int pct = v != 0 ? v : GameData.SellRefundPct;
            return JsMath.FloorDiv((long)d.Spent * pct, 100);
        }

        public static bool CanBuild(DefendState s, int tx, int ty)
        {
            if (tx < 0 || ty < 0 || tx >= Layouts.GridW || ty >= Layouts.GridH) return false;
            if (s.PathTiles.Contains(tx + "," + ty) || s.Blocked.Contains(tx + "," + ty)) return false;
            return !s.Disciples.Any(d => d.Tx == tx && d.Ty == ty);
        }

        public static ComboDef FindCombo(string a, string b) => GameData.Combos.FirstOrDefault(c => (c.A == a && c.B == b) || (c.A == b && c.B == a));

        static bool Adjacent(Disciple a, Disciple b) => a != b && Math.Abs(a.Tx - b.Tx) <= 1 && Math.Abs(a.Ty - b.Ty) <= 1;

        static bool Valid(Command c)
        {
            switch (c.T)
            {
                case "place": return GameData.SectOrder.Contains(c.Sect);
                case "upgrade": case "sell": case "nextWave": return true;
                case "target": return c.Mode == "first" || c.Mode == "strong" || c.Mode == "weak" || c.Mode == "close";
                case "merge": return c.A != c.B;
                case "cast": return GameData.Arts.Any(a => a.Id == c.Art);
                case "pick": return GameData.Cards.Any(k => k.Id == c.Card);
                default: return false;
            }
        }

        static void Err(List<SimEvent> ev, string msg) => ev.Add(new SimEvent { E = "error", Msg = msg });

        static void Apply(DefendState s, Command c, List<SimEvent> ev)
        {
            if (!Valid(c)) { Err(ev, "invalid command"); return; }
            switch (c.T)
            {
                case "place":
                {
                    if (!s.Unlocked.Contains(c.Sect)) { Err(ev, "sect locked"); return; }
                    if (!CanBuild(s, c.Tx, c.Ty)) { Err(ev, "cannot build here"); return; }
                    int cost = PlaceCost(c.Sect);
                    if (s.Silver < cost) { Err(ev, "not enough silver"); return; }
                    s.Silver -= cost;
                    int id = s.NextId++;
                    var d = new Disciple { Id = id, Tx = c.Tx, Ty = c.Ty, X = c.Tx * Tile + Tile / 2, Y = c.Ty * Tile + Tile / 2, Spent = cost };
                    d.Els.Add(c.Sect);
                    s.Disciples.Add(d);
                    s.PeakDisciples = Math.Max(s.PeakDisciples, s.Disciples.Count);
                    ev.Add(new SimEvent { E = "placed", Id = id });
                    return;
                }
                case "upgrade":
                {
                    var d = s.Disciples.FirstOrDefault(x => x.Id == c.Id);
                    if (d == null || d.Combo != null || d.Level >= MaxLevel) { Err(ev, "cannot upgrade"); return; }
                    int cost = UpgradeCost(d);
                    if (s.Silver < cost) { Err(ev, "not enough silver"); return; }
                    s.Silver -= cost; d.Spent += cost; d.Level++;
                    return;
                }
                case "sell":
                {
                    int i = s.Disciples.FindIndex(x => x.Id == c.Id);
                    if (i < 0) { Err(ev, "no such disciple"); return; }
                    s.Silver += SellValue(s.Disciples[i], s);
                    s.Disciples.RemoveAt(i);
                    return;
                }
                case "merge":
                {
                    var a = s.Disciples.FirstOrDefault(x => x.Id == c.A);
                    var b = s.Disciples.FirstOrDefault(x => x.Id == c.B);
                    if (a == null || b == null || !Adjacent(a, b)) { Err(ev, "merge needs two adjacent disciples"); return; }
                    if (a.Combo != null || b.Combo != null || a.Level < MaxLevel || b.Level < MaxLevel) { Err(ev, "both must be max level"); return; }
                    var combo = FindCombo(a.Els[0], b.Els[0]);
                    if (combo == null) { Err(ev, "no combo for this pair"); return; }
                    a.Els = new List<string> { a.Els[0], b.Els[0] };
                    a.Combo = combo.Id; a.Spent += b.Spent; a.Cd = 0;
                    s.Disciples.Remove(b);
                    s.CombosMade++;
                    ev.Add(new SimEvent { E = "combo", Id = a.Id, Name = combo.NameTh, Type = combo.Id });
                    return;
                }
                case "nextWave":
                    if (s.Phase == "build") StartWave(s, ev);
                    else if (s.Phase == "break") { s.Silver += GameData.EarlyCallBonus; StartWave(s, ev); }
                    return;
                case "cast": CastArt(s, c.Art, ev); return;
                case "target":
                {
                    var d = s.Disciples.FirstOrDefault(x => x.Id == c.Id);
                    if (d == null) { Err(ev, "no such disciple"); return; }
                    d.Target = c.Mode;
                    return;
                }
                case "pick":
                    if (s.Phase != "picking" || s.Offer == null || !s.Offer.Contains(c.Card)) { Err(ev, "no such card on offer"); return; }
                    PickCard(s, c.Card, ev);
                    return;
            }
        }

        static void CastArt(DefendState s, string id, List<SimEvent> ev)
        {
            int i = GameData.Arts.FindIndex(a => a.Id == id);
            var art = GameData.Arts[i];
            if (s.ArtCd[i] > 0) { Err(ev, "art on cooldown"); return; }
            var alive = s.Enemies.Where(e => e.Hp > 0).ToList();
            if (alive.Count == 0) { Err(ev, "no enemies"); return; }
            int x = 0, y = 0;
            switch (art.Type)
            {
                case "strike":
                {
                    var lead = alive[0];
                    foreach (var e in alive) if (e.D > lead.D) lead = e;
                    x = lead.X; y = lead.Y;
                    foreach (var e in alive) if (PathMath.Within(x, y, e.X, e.Y, art.Radius)) e.Hp -= art.Dmg;
                    break;
                }
                case "slowAll":
                    foreach (var e in alive) { e.SlowT = Math.Max(e.SlowT, art.Duration); e.SlowPct = Math.Max(e.SlowPct, art.Pct); }
                    break;
                case "bountyMult": s.BountyMultT = art.Duration; break;
                case "stunAll":
                    foreach (var e in alive) e.StunT = Math.Max(e.StunT, art.Duration);
                    s.RevealAllT = art.Duration;
                    break;
            }
            s.ArtCd[i] = art.Cooldown;
            ev.Add(new SimEvent { E = "art", Name = art.Id, X = x, Y = y });
        }

        static void OfferCards(DefendState s, List<SimEvent> ev)
        {
            var pool = GameData.Cards.Where(c => !s.Cards.Contains(c.Id) && (c.Needs == null || s.Unlocked.Contains(c.Needs))).ToList();
            var offer = new List<string>();
            while (offer.Count < 3 && pool.Count > 0)
            {
                int i = (int)Math.Floor(Rng.Next(ref s.Rng) * pool.Count);
                offer.Add(pool[i].Id);
                pool.RemoveAt(i);
            }
            if (offer.Count == 0) { s.Phase = "break"; s.BreakT = GameData.WaveBreak; return; }
            s.Offer = offer; s.OfferT = GameData.CardAutoPick; s.Phase = "picking";
            ev.Add(new SimEvent { E = "offer", Cards = offer });
        }

        static void PickCard(DefendState s, string id, List<SimEvent> ev)
        {
            s.Cards.Add(id); s.Offer = null; s.Phase = "break"; s.BreakT = GameData.WaveBreak;
            ev.Add(new SimEvent { E = "picked", Name = id });
        }

        public static List<string> WaveTypes(string stageId, int wave)
        {
            var types = GameData.Stages[stageId].Enemies.Where(t => GameData.Enemies.ContainsKey(t) && !t.StartsWith("boss")).ToList();
            var available = types.Take(Math.Min(types.Count, 1 + (wave - 1) / 2)).ToList();
            var o = new List<string>();
            for (int i = 0; i < 4 + wave; i++) o.Add(available[(i + wave) % available.Count]);
            return o;
        }

        static void StartWave(DefendState s, List<SimEvent> ev)
        {
            s.Wave++;
            s.SpawnQueue = WaveTypes(s.StageId, s.Wave);
            s.SpawnT = 0; s.Phase = "spawning";
            ev.Add(new SimEvent { E = "wave", Wave = s.Wave });
        }

        static Enemy Spawn(DefendState s, string type, List<SimEvent> ev, int at = 0, bool small = false)
        {
            var def = GameData.Enemies[type];
            int hp = small ? Math.Max(1, GameData.WaveHp(def.Hp, s.Wave) / 4) : GameData.WaveHp(def.Hp, s.Wave);
            int speed = def.Speed;
            int bounty = small ? 1 : JsMath.FloorDiv((long)def.Bounty * (100 + GameData.BountyGrowthPct * (s.Wave - 1)), 100);
            EliteAffix elite = null;
            if (!small && s.Wave >= GameData.EliteFromWave && Rng.RollPct(ref s.Rng) < GameData.EliteChancePct)
            {
                elite = GameData.Elites[(int)Math.Floor(Rng.Next(ref s.Rng) * GameData.Elites.Count)];
                hp = JsMath.FloorDiv((long)hp * elite.HpPct, 100);
                speed = JsMath.FloorDiv((long)speed * elite.SpeedPct, 100);
                bounty *= GameData.EliteBountyMult;
            }
            var p = PathMath.PointAt(s.Path, at);
            var e = new Enemy
            {
                Id = s.NextId++, Type = type, El = def.Element, Air = def.Air, Hp = hp, MaxHp = hp, D = at, Speed = speed, Bounty = bounty,
                X = p.X, Y = p.Y, Small = small, Elite = elite?.Id, RegenPct = elite?.RegenPct ?? 0,
            };
            s.Enemies.Add(e);
            ev.Add(new SimEvent { E = "spawn", Id = e.Id });
            if (!small && !s.SeenTypes.Contains(type)) { s.SeenTypes.Add(type); ev.Add(new SimEvent { E = "newEnemy", Type = type }); }
            return e;
        }

        static int StatPct(int level) => GameData.StatPct[level - 1];

        struct Stats { public int Dmg, Cooldown, Range; public bool HitsAir, HitsGround; }

        static Stats DiscipleStats(DefendState s, Disciple d)
        {
            var defs = d.Els.Select(el => GameData.Sects[el]).ToList();
            int dmg = d.Combo != null ? defs.Sum(x => x.Dmg) : defs[0].Dmg;
            dmg = JsMath.FloorDiv((long)dmg * StatPct(d.Level), 100);
            var neighbours = s.Disciples.Where(o => Adjacent(d, o)).ToList();
            if (Wuxing.IsGenerated(d.Els, neighbours.Select(n => (IList<string>)n.Els)))
            {
                int v = Card(s, "adjacencyPct")?.Value ?? 0;
                dmg = JsMath.FloorDiv((long)dmg * (v != 0 ? v : AdjacencyPct), 100);
            }
            var el = Card(s, "elementDmg");
            if (el != null && el.Element != null && d.Els.Contains(el.Element)) dmg = JsMath.FloorDiv((long)dmg * (100 + el.Pct), 100);
            var mono = Card(s, "monoSectPct");
            if (mono != null && s.Disciples.All(o => o.Els[0] == s.Disciples[0].Els[0])) dmg = JsMath.FloorDiv((long)dmg * (100 + mono.Pct), 100);
            int cooldown = defs.Min(x => x.Cooldown);
            if (neighbours.Any(n => n.Els.Contains("yinyang") && n.Level >= 2)) cooldown = JsMath.FloorDiv((long)cooldown * 100, YyRatePct);
            return new Stats
            {
                Dmg = dmg, Cooldown = Math.Max(1, cooldown), Range = defs.Max(x => x.Range),
                HitsAir = defs.Any(x => x.HitsAir), HitsGround = defs.Any(x => x.HitsGround),
            };
        }

        static bool CanTarget(Enemy e, bool air, bool ground) => e.Hp > 0 && (e.Air ? air : ground) && (e.Type != "assassin" || e.Revealed);

        static bool HasLevel(DefendState s, string el, int level) => s.Disciples.Any(d => d.Els.Contains(el) && d.Level >= level);

        static void DealDamage(DefendState s, Disciple d, Enemy e, int raw, bool crit, List<SimEvent> ev)
        {
            int pct = Wuxing.OvercomePct(d.Els, e.El);
            int dmg = JsMath.FloorDiv((long)raw * pct, 100);
            if (e.Poison > 0 && HasLevel(s, "wood", 3)) dmg = JsMath.FloorDiv((long)dmg * (100 + WoodVulnPct), 100);
            if (e.Type == "mimic" && e.LastElT > 0 && e.LastEl != null && d.Els.Contains(e.LastEl)) dmg = JsMath.FloorDiv(dmg, 2);
            var freeze = Card(s, "slowedVuln");
            if (freeze != null && e.SlowT > 0) dmg = JsMath.FloorDiv((long)dmg * (100 + freeze.Pct), 100);
            var heavy = Card(s, "vsHeavyPct");
            if (heavy != null && (e.Type == "brute" || e.Type.StartsWith("boss"))) dmg = JsMath.FloorDiv((long)dmg * (100 + heavy.Pct), 100);
            if (e.Type == "brute" && d.Combo != "molten_edge") dmg -= BruteArmor;
            dmg = Math.Max(1, dmg);
            e.Hp -= dmg;
            e.LastEl = d.Els[0];
            e.LastElT = MimicTicks;
            ev.Add(new SimEvent { E = "hit", From = d.Id, To = e.Id, Dmg = dmg, Pct = pct, Crit = crit, El = d.Els[0] });
        }

        static long Dist2(Disciple d, Enemy e) { long dx = d.X - e.X, dy = d.Y - e.Y; return dx * dx + dy * dy; }

        static bool Better(Disciple d, Enemy e, Enemy cur)
        {
            switch (d.Target)
            {
                case "strong": return e.Hp > cur.Hp;
                case "weak": return e.Hp < cur.Hp;
                case "close": return Dist2(d, e) < Dist2(d, cur);
                default: return e.D > cur.D;
            }
        }

        static void Attack(DefendState s, Disciple d, List<SimEvent> ev)
        {
            d.RootT++; d.PushT++; d.BellT++;
            var st = DiscipleStats(s, d);
            int lvl = d.Level;

            int bellCard = Card(s, "bellEverySec")?.Value ?? 0;
            int bellEvery = bellCard * Hz != 0 ? bellCard * Hz : EarthBellEvery;
            if (d.Els.Contains("earth") && lvl >= 2 && d.BellT >= bellEvery)
            {
                d.BellT = 0;
                int r = lvl >= 3 ? 2 * Tile : Tile;
                int t = d.Combo == "iron_mountain" ? EarthBellTicks + Hz : lvl >= 3 ? EarthQuakeTicks : EarthBellTicks;
                foreach (var e in s.Enemies)
                    if (!e.Air && e.Hp > 0 && PathMath.Within(d.X, d.Y, e.X, e.Y, r))
                    {
                        e.StunT = Math.Max(e.StunT, t);
                        if (d.Combo == "root_quake") { e.Poison = Math.Min(3, e.Poison + 1); e.PoisonT = WoodPoisonTicks; e.PoisonDps = Math.Max(e.PoisonDps, WoodPoisonDps); }
                        ev.Add(new SimEvent { E = "stun", Id = e.Id, From = d.Id });
                    }
            }

            if (d.Cd > 0) { d.Cd--; return; }
            Enemy target = null;
            foreach (var e in s.Enemies)
            {
                if (!CanTarget(e, st.HitsAir, st.HitsGround) || !PathMath.Within(d.X, d.Y, e.X, e.Y, st.Range)) continue;
                if (target == null || Better(d, e, target)) target = e;
            }
            if (target == null) return;
            d.Cd = st.Cooldown - 1;
            d.Hits++;

            bool crit = false;
            if (d.Els.Contains("metal"))
                crit = Rng.RollPct(ref s.Rng) < MetalCritPct + (Card(s, "critChance")?.Pct ?? 0) || (lvl >= 2 && d.Hits % MetalEvery == 0);
            if (d.Combo == "frozen_blade" && target.StunT > 0) crit = true;
            int raw = crit ? st.Dmg * 2 : st.Dmg;
            DealDamage(s, d, target, raw, crit, ev);

            foreach (var el in d.Els)
            {
                switch (el)
                {
                    case "metal":
                        if (crit && lvl >= 3)
                        {
                            var second = s.Enemies.FirstOrDefault(e => e != target && CanTarget(e, st.HitsAir, st.HitsGround) && PathMath.Within(d.X, d.Y, e.X, e.Y, st.Range));
                            if (second != null) DealDamage(s, d, second, raw, true, ev);
                        }
                        break;
                    case "wood":
                        target.Poison = Math.Min(3, target.Poison + 1);
                        target.PoisonT = WoodPoisonTicks;
                        target.PoisonDps = Math.Max(target.PoisonDps, JsMath.FloorDiv((long)WoodPoisonDps * StatPct(lvl), 100));
                        if (lvl >= 2 && d.RootT >= WoodRootEvery)
                        {
                            d.RootT = 0;
                            target.StunT = Math.Max(target.StunT, WoodRootTicks);
                            ev.Add(new SimEvent { E = "stun", Id = target.Id, From = d.Id });
                        }
                        break;
                    case "water":
                        target.SlowT = WaterSlowTicks;
                        target.SlowPct = Math.Max(target.SlowPct, WaterSlowPct);
                        if (lvl >= 2 && d.Hits % WaterFreezeEvery == 0)
                        {
                            target.StunT = Math.Max(target.StunT, WaterFreezeTicks);
                            ev.Add(new SimEvent { E = "stun", Id = target.Id, From = d.Id });
                        }
                        if (lvl >= 3 && d.PushT >= WaterPushEvery) { d.PushT = 0; target.D = Math.Max(0, target.D - Tile); }
                        break;
                    case "fire":
                    {
                        int dps = JsMath.FloorDiv((long)FireBurnDps * StatPct(lvl), 100);
                        foreach (var e in s.Enemies)
                            if (e.Hp > 0 && (e == target || PathMath.Within(target.X, target.Y, e.X, e.Y, FireSplash)))
                            {
                                e.BurnT = FireBurnTicks;
                                e.BurnDps = Math.Max(e.BurnDps, dps);
                            }
                        break;
                    }
                    case "earth":
                    {
                        bool volcano = d.Combo == "volcano_fist";
                        int r = volcano ? EarthSplash * 3 / 2 : EarthSplash;
                        foreach (var e in s.Enemies.ToList())
                            if (e != target && !e.Air && e.Hp > 0 && PathMath.Within(target.X, target.Y, e.X, e.Y, r))
                                DealDamage(s, d, e, volcano ? raw : JsMath.FloorDiv(raw, 2), false, ev);
                        break;
                    }
                }
            }
            if (d.Combo != null) ComboOnHit(s, d, target, crit);
        }

        static void ComboOnHit(DefendState s, Disciple d, Enemy target, bool crit)
        {
            void Splash(int r, Action<Enemy> f)
            {
                foreach (var e in s.Enemies) if (e.Hp > 0 && (e == target || PathMath.Within(target.X, target.Y, e.X, e.Y, r))) f(e);
            }
            switch (d.Combo)
            {
                case "thorn_sword":
                    if (crit) { target.Poison = 3; target.PoisonT = WoodPoisonTicks; target.PoisonDps = Math.Max(target.PoisonDps, WoodPoisonDps); }
                    break;
                case "spring_rain":
                    Splash(Tile, e =>
                    {
                        e.SlowT = WaterSlowTicks; e.SlowPct = Math.Max(e.SlowPct, WaterSlowPct);
                        e.Poison = Math.Min(3, e.Poison + 1); e.PoisonT = WoodPoisonTicks; e.PoisonDps = Math.Max(e.PoisonDps, WoodPoisonDps);
                    });
                    break;
                case "steam_palm":
                    Splash(FireSplash, e => { e.SlowT = WaterSlowTicks; e.SlowPct = Math.Max(e.SlowPct, WaterSlowPct); });
                    break;
                case "quicksand":
                    target.SlowPct = Math.Max(target.SlowPct, 50);
                    break;
            }
        }

        static void MoveEnemies(DefendState s, List<SimEvent> ev)
        {
            var yy = s.Disciples.Where(d => d.Els.Contains("yinyang")).ToList();
            foreach (var e in s.Enemies)
            {
                e.Age++;
                e.Revealed = s.RevealAllT > 0 || yy.Any(d => PathMath.Within(d.X, d.Y, e.X, e.Y, YyReveal));
                if (e.LastElT > 0) e.LastElT--;
                if (e.Age % DotEvery == 0)
                {
                    if (e.BurnT > 0) e.Hp -= Math.Max(1, JsMath.FloorDiv(e.BurnDps, 2));
                    if (e.PoisonT > 0 && e.Poison > 0) e.Hp -= Math.Max(1, JsMath.FloorDiv((long)e.Poison * e.PoisonDps, 2));
                }
                if (e.BurnT > 0) e.BurnT--;
                if (e.PoisonT > 0) e.PoisonT--; else e.Poison = 0;
                if (e.RegenPct > 0 && e.Age % Hz == 0) e.Hp = Math.Min(e.MaxHp, e.Hp + JsMath.FloorDiv((long)e.MaxHp * e.RegenPct, 100));
                if (e.Type == "healer" && e.Age % HealEvery == 0)
                    foreach (var o in s.Enemies)
                        if (o != e && o.Hp > 0 && PathMath.Within(e.X, e.Y, o.X, o.Y, HealRange))
                            o.Hp = Math.Min(o.MaxHp, o.Hp + JsMath.FloorDiv((long)o.MaxHp * HealPct, 100));
                if (e.StunT > 0) { e.StunT--; continue; }
                int sp = e.Speed;
                if (e.SlowT > 0) { e.SlowT--; sp = JsMath.FloorDiv((long)sp * (100 - e.SlowPct), 100); } else e.SlowPct = 0;
                e.D += sp;
                if (e.Type == "runner" && e.Age % DashEvery == 0) e.D += DashDist;
                var p = PathMath.PointAt(s.Path, e.D);
                e.X = p.X; e.Y = p.Y;
            }
            foreach (var e in s.Enemies)
                if (e.Hp > 0 && e.D >= s.PathLen)
                {
                    e.Hp = 0; e.Bounty = 0;
                    s.Lives = Math.Max(0, s.Lives - 1);
                    s.LivesLost++;
                    ev.Add(new SimEvent { E = "leak", Id = e.Id });
                }
        }

        static void ResolveDeaths(DefendState s, List<SimEvent> ev)
        {
            var dead = s.Enemies.Where(e => e.Hp <= 0).ToList();
            if (dead.Count == 0) return;
            s.Enemies = s.Enemies.Where(e => e.Hp > 0).ToList();
            var yy3 = s.Disciples.Where(d => d.Els.Contains("yinyang") && d.Level >= 3).ToList();
            bool fireExplodes = HasLevel(s, "fire", 2);
            foreach (var e in dead)
            {
                if (e.Bounty == 0 && e.D >= s.PathLen) continue; // leaked
                int bounty = e.Bounty;
                if (yy3.Any(d => PathMath.Within(d.X, d.Y, e.X, e.Y, YyReveal))) bounty++;
                bounty += Card(s, "bountyFlat")?.Value ?? 0;
                if (s.BountyMultT > 0) bounty *= 2;
                s.Silver += bounty;
                ev.Add(new SimEvent { E = "kill", Id = e.Id, X = e.X, Y = e.Y, Amount = bounty });
                if (e.Type == "puppet" && !e.Small) for (int i = 0; i < 3; i++) Spawn(s, "puppet", ev, Math.Max(0, e.D - i * 300), true);
                if (e.BurnT > 0 && s.Disciples.Any(q => q.Combo == "wildfire_flute"))
                    foreach (var o in s.Enemies.Where(o => o.Hp > 0 && PathMath.Within(e.X, e.Y, o.X, o.Y, 1500)).Take(2).ToList())
                    { o.BurnT = FireBurnTicks; o.BurnDps = Math.Max(o.BurnDps, e.BurnDps); }
                if (fireExplodes && e.BurnT > 0)
                    foreach (var o in s.Enemies) if (PathMath.Within(e.X, e.Y, o.X, o.Y, Tile)) o.Hp -= FireExplodeDmg;
            }
        }

        static void WaveFlow(DefendState s, List<SimEvent> ev)
        {
            switch (s.Phase)
            {
                case "build":
                    if (s.Tick >= AutoStartTicks) StartWave(s, ev);
                    break;
                case "spawning":
                    if (s.SpawnT > 0) s.SpawnT--;
                    else
                    {
                        if (s.SpawnQueue.Count > 0) { var type = s.SpawnQueue[0]; s.SpawnQueue.RemoveAt(0); Spawn(s, type, ev); }
                        s.SpawnT = GameData.SpawnInterval - 1;
                        if (s.SpawnQueue.Count == 0) s.Phase = "clearing";
                    }
                    break;
                case "clearing":
                    if (s.Enemies.Count == 0)
                    {
                        int pct = GameData.InterestPct + (HasLevel(s, "yinyang", 3) ? 1 : 0) + (Card(s, "interestPct")?.Value ?? 0);
                        int interest = Math.Min(GameData.InterestCap, JsMath.FloorDiv((long)s.Silver * pct, 100));
                        s.Silver += interest;
                        ev.Add(new SimEvent { E = "interest", Amount = interest });
                        if (s.Wave >= s.TotalWaves) Finish(s, true, ev);
                        else if (s.Wave % GameData.CardEveryWaves == 0) OfferCards(s, ev);
                        else { s.Phase = "break"; s.BreakT = GameData.WaveBreak; }
                    }
                    break;
                case "break":
                    if (--s.BreakT <= 0) StartWave(s, ev);
                    break;
                case "picking":
                    if (--s.OfferT <= 0 && s.Offer != null) PickCard(s, s.Offer[0], ev);
                    break;
            }
        }

        public static List<bool> EvaluateStars(DefendState s, bool won)
        {
            return GameData.Stages[s.StageId].Stars.Select(key =>
            {
                if (!won) return false;
                switch (key)
                {
                    case "clear": return true;
                    case "no_life_lost": return s.LivesLost == 0;
                    case "under_3min": return s.Tick <= 3 * 60 * Hz;
                    case "hold_200_silver": return s.Silver >= 200;
                    case "max_6_disciples": return s.PeakDisciples <= 6;
                    case "use_combo": return s.CombosMade > 0;
                    default: return false;
                }
            }).ToList();
        }

        static void Finish(DefendState s, bool won, List<SimEvent> ev)
        {
            s.Phase = won ? "won" : "lost";
            s.Stars = EvaluateStars(s, won);
            ev.Add(new SimEvent { E = "end", Won = won, Stars = s.Stars });
        }

        /// <summary>Advances exactly one tick (1/20 s). Commands apply at the start of the tick.</summary>
        public static List<SimEvent> Step(DefendState s, IList<Command> commands)
        {
            var ev = new List<SimEvent>();
            if (s.IsOver) return ev;
            if (commands != null) foreach (var c in commands) Apply(s, c, ev);
            for (int i = 0; i < s.ArtCd.Length; i++) if (s.ArtCd[i] > 0) s.ArtCd[i]--;
            if (s.BountyMultT > 0) s.BountyMultT--;
            if (s.RevealAllT > 0) s.RevealAllT--;
            WaveFlow(s, ev);
            MoveEnemies(s, ev);
            foreach (var d in s.Disciples.ToList()) Attack(s, d, ev);
            ResolveDeaths(s, ev);
            s.Tick++;
            if (s.Lives <= 0) Finish(s, false, ev);
            return ev;
        }
    }
}
