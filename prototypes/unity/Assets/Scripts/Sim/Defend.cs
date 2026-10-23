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
        public string E;            // hit | kill | leak | spawn | placed | combo | wave | interest | stun | error | art | offer | picked | newEnemy | disable | seal | end
        public int From, To, Id, Dmg, Pct, X, Y, Amount, Wave;
        public bool Crit, Won;
        public string El, Msg, Name, Type;
        public List<string> Cards;
        public List<bool> Stars;
    }

    public class Disciple
    {
        public int Id, Level = 1, Tx, Ty, X, Y, Cd, Hits, Spent, RootT, PushT, BellT, OffT;
        public List<string> Els = new List<string>();
        public string Combo, Unit, El; // Unit: roster unit id; El: its sect element (null = legacy)
        public string Target = "first";
    }

    public class Enemy
    {
        public int Id, Hp, MaxHp, D, Speed, Bounty, X, Y, SlowT, SlowPct, BurnT, BurnDps, BurnAge, Poison, PoisonT, PoisonDps, StunT, LastElT, Age, RegenPct, Phase;
        public string Type, El, LastEl, Elite;
        public bool Air, Revealed, Small;
    }

    public class QueuedEnemy { public string Type; public int Wave, HpPct; }

    public class DefendState
    {
        public string StageId, Phase = "build";
        public int Tick, Silver, Lives, Wave, TotalWaves, SpawnT, BreakT, NextId = 1, PathLen, LivesLost, CombosMade, PeakDisciples, BountyMultT, RevealAllT, OfferT;
        public uint Rng;
        public List<QueuedEnemy> SpawnQueue = new List<QueuedEnemy>();
        public string Recipe = "mixed", NextRecipe = "mixed", SealEl, Sect; // Sect: the player's sect when it has a roster
        public int CardsOffered, SealT;
        public int[] ArtCharges;
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
        public List<string> SectsUsed = new List<string>(); // distinct sect elements ever placed (max_2_sects star)
        public bool IsOver => Phase == "won" || Phase == "lost";
    }

    public static class Defend
    {
        const int Tile = GameData.Tile, Hz = GameData.TickHz;
        static int AutoStartTicks => 30 * Hz;
        const int DotEvery = GameData.TickHz / 2;

        // Same values as the FX table in defend.ts.
        const int MetalCritPct = 15, MetalEvery = 6, WoodPoisonDps = 10, WoodVulnPct = 25, WaterSlowPct = 30, WaterFreezeEvery = 5;
        const int FireBurnDps = 6, FireSplash = 800, FireExplodeDmg = 30, EarthSplash = Tile, YyReveal = 3 * Tile, YyRatePct = 120;
        const int DashDist = 2 * Tile, HealRange = 1500, HealPct = 5, HealBossPct = 1, BruteArmor = 5, AdjacencyPct = 115;
        static readonly int WoodPoisonTicks = 3 * Hz, WoodRootEvery = 8 * Hz, WoodRootTicks = 1 * Hz, WaterSlowTicks = 2 * Hz;
        static readonly int WaterFreezeTicks = JsMath.Round(1.2 * Hz), WaterPushEvery = 12 * Hz, FireBurnTicks = 3 * Hz;
        static readonly int PhoenixEvery = 20 * Hz, EarthBellEvery = 10 * Hz, EarthBellTicks = 2 * Hz, EarthQuakeTicks = 1 * Hz, DashEvery = 4 * Hz;
        static readonly int HealEvery = Hz, MimicTicks = 3 * Hz;

        static int MaxLevel => GameData.UpgradeLevels;

        public static DefendState Create(string stageId, uint seed, string sect = null)
        {
            string rosterSect = sect != null && GameData.RosterSects.Contains(sect) ? sect : null;
            var stage = GameData.Stages[stageId];
            var layout = Layouts.Get(stage.Layout, stage.Variant);
            var path = PathMath.ToMilli(layout.Path);
            return new DefendState
            {
                StageId = stageId, Rng = seed, Silver = stage.StartSilver ?? 100, Lives = GameData.StartLives,
                TotalWaves = stage.Waves ?? 10, Sect = rosterSect, Unlocked = rosterSect != null ? UnlockedUnits(rosterSect, stageId) : UnlockedSects(stageId), Path = path, PathLen = PathMath.Length(path),
                PathTiles = PathMath.TilesOnPath(layout.Path), Blocked = Layouts.Blocked(layout), Layout = layout, ArtCd = new int[GameData.Arts.Count],
                ArtCharges = GameData.Arts.Select(a => a.Charges).ToArray(),
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

        public static int PlaceCost(string key) => GameData.DefOf(key).Cost;

        // Roster units of a sect unlocked up to this stage (sects.json > roster.roleUnlocks), in role order.
        public static List<string> UnlockedUnits(string sect, string stageId)
        {
            bool all = GameData.Stages.TryGetValue(stageId, out var st) && st.UnlockAll;
            var roles = new HashSet<string>();
            foreach (var p in GameData.RoleUnlocks) if (all || CompareStage(p.Key, stageId) <= 0) foreach (var r in p.Value) roles.Add(r);
            var o = new List<string>();
            foreach (var r in GameData.Roles)
                if (roles.Contains(r)) foreach (var u in GameData.UnitList) if (u.Sect == sect && u.RoleId == r) o.Add(u.Id);
            return o;
        }

        static List<SectDef> DefsOf(Disciple d) => d.Unit != null ? new List<SectDef> { GameData.Units[d.Unit] } : d.Els.Select(el => GameData.Sects[el]).ToList();
        // Wu Xing elements of a disciple: a roster unit counts as its sect's element, whatever its kit.
        static List<string> Wux(Disciple d) => d.El != null ? new List<string> { d.El } : d.Els;
        static string DotKind(Disciple d) => d.Unit != null ? GameData.Units[d.Unit].Dot : null;

        public static int UpgradeCost(Disciple d)
        {
            if (d.Combo != null || d.Level >= MaxLevel) return 0;
            return JsMath.FloorDiv((long)DefsOf(d)[0].Cost * GameData.CostPct[d.Level], 100);
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
                case "place": return GameData.SectOrder.Contains(c.Sect) || GameData.Units.ContainsKey(c.Sect);
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
                    if (GameData.Units.TryGetValue(c.Sect, out var unit)) { d.Els.Add(unit.Element); d.Unit = unit.Id; d.El = unit.Sect; }
                    else d.Els.Add(c.Sect);
                    s.Disciples.Add(d);
                    s.PeakDisciples = Math.Max(s.PeakDisciples, s.Disciples.Count);
                    if (!s.SectsUsed.Contains(Wux(d)[0])) s.SectsUsed.Add(Wux(d)[0]);
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
                    if (a.Unit != null || b.Unit != null) { Err(ev, "roster disciples cannot merge yet"); return; }
                    var combo = FindCombo(a.Els[0], b.Els[0]);
                    if (combo == null) { Err(ev, "no combo for this pair"); return; }
                    if (s.Silver < GameData.MergeFee) { Err(ev, "not enough silver"); return; }
                    s.Silver -= GameData.MergeFee;
                    a.Els = new List<string> { a.Els[0], b.Els[0] };
                    a.Combo = combo.Id; a.Spent += b.Spent + GameData.MergeFee; a.Cd = 0;
                    s.Disciples.Remove(b);
                    s.CombosMade++;
                    ev.Add(new SimEvent { E = "combo", Id = a.Id, Name = combo.NameTh, Type = combo.Id });
                    return;
                }
                case "nextWave":
                    if (s.Wave >= s.TotalWaves) { Err(ev, "no more waves"); return; }
                    if (s.Phase == "build") StartWave(s, ev);
                    else if (s.Phase == "break") { s.Silver += GameData.EarlyCallBonus; StartWave(s, ev); }
                    else if (s.Phase == "spawning" || s.Phase == "clearing")
                    {
                        // Calling while enemies are still alive overlaps two waves; the bonus pays for that risk.
                        int atStake = 0;
                        foreach (var e in s.Enemies) if (e.Hp > 0) atStake += e.Bounty;
                        s.Silver += GameData.EarlyCallBonus + JsMath.FloorDiv((long)atStake * GameData.EarlyCallPct, 100);
                        StartWave(s, ev);
                    }
                    else Err(ev, "cannot call a wave now");
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
            // Free charges first, then each cast costs silver.
            if (s.ArtCharges[i] > 0) s.ArtCharges[i]--;
            else if (s.Silver >= art.RechargeSilver) s.Silver -= art.RechargeSilver;
            else { Err(ev, "not enough silver"); return; }
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
            // Sect-locked cards follow the player's sect in a roster game (Unlocked then holds unit ids, not elements);
            // cards built on mixing sects (Roster == false) are never offered there.
            var pool = GameData.Cards.Where(c => !s.Cards.Contains(c.Id)
                && (c.Needs == null || (s.Sect != null ? c.Needs == s.Sect : s.Unlocked.Contains(c.Needs)))
                && (s.Sect == null || c.Roster)).ToList();
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

        static WaveRecipe RecipeById(string id) => GameData.WaveRecipes.FirstOrDefault(r => r.Id == id) ?? GameData.WaveRecipes[0];

        static List<string> AvailableTypes(string stageId, int wave)
        {
            var types = GameData.Stages[stageId].Enemies.Where(t => GameData.Enemies.ContainsKey(t) && GameData.Enemies[t].Boss == null).ToList();
            if (types.Count == 0) throw new Exception("stage " + stageId + " has no regular enemies");
            return types.Take(Math.Min(types.Count, 1 + (wave - 1) / 2)).ToList();
        }

        static List<string> RecipeTypes(string stageId, int wave, string recipeId)
        {
            var avail = AvailableTypes(stageId, wave);
            var r = RecipeById(recipeId);
            var picked = r.Types.Count > 0 ? avail.Where(t => r.Types.Contains(t)).ToList() : avail;
            return picked.Count > 0 ? picked : avail;
        }

        static string RollRecipe(DefendState s, int wave)
        {
            var stage = GameData.Stages[s.StageId];
            if (wave <= 2 || stage.ScriptedWaves.ContainsKey(wave.ToString())) return "mixed";
            var avail = AvailableTypes(s.StageId, wave);
            var pool = (stage.WavePool ?? GameData.WaveRecipes.Select(r => r.Id).ToList()).Where(id =>
            {
                var r = RecipeById(id);
                return (r.Types.Count == 0 || r.Types.Any(t => avail.Contains(t))) && Answerable(s, r);
            }).ToList();
            var choices = pool.Count > 1 ? pool.Where(id => id != s.Recipe).ToList() : pool;
            if (choices.Count == 0) return "mixed";
            return choices[(int)Math.Floor(Rng.Next(ref s.Rng) * choices.Count)];
        }

        // A roster player must hold at least one of the roles a wave shape asks for ("air": any unit that hits air).
        static bool Answerable(DefendState s, WaveRecipe r)
        {
            if (s.Sect == null || r.NeedsRoles.Count == 0) return true;
            var units = s.Unlocked.Where(GameData.Units.ContainsKey).Select(k => GameData.Units[k]).ToList();
            return r.NeedsRoles.Any(n => n == "air" ? units.Any(u => u.HitsAir) : units.Any(u => u.RoleId == n));
        }

        public static List<QueuedEnemy> WaveEntries(string stageId, int wave, string recipeId)
        {
            var r = RecipeById(recipeId);
            var types = RecipeTypes(stageId, wave, recipeId);
            int n = Math.Max(1, JsMath.FloorDiv((long)(4 + wave) * r.CountPct, 100));
            var o = new List<QueuedEnemy>();
            for (int i = 0; i < n; i++) o.Add(new QueuedEnemy { Type = types[(i + wave) % types.Count], Wave = wave, HpPct = r.HpPct });
            if (GameData.Stages[stageId].ScriptedWaves.TryGetValue(wave.ToString(), out var boss)) o.Add(new QueuedEnemy { Type = boss, Wave = wave, HpPct = 100 });
            return o;
        }

        public static List<string> WaveTypes(string stageId, int wave) => WaveEntries(stageId, wave, "mixed").Select(q => q.Type).ToList();

        // Interest is paid once per wave, when the field is clear, capped by how far the run is. Calling the next wave
        // before the field is clear skips it: that is the price of the early-call bonus.
        static void PayInterest(DefendState s, List<SimEvent> ev)
        {
            int pct = GameData.InterestPct + (HasLevel(s, "yinyang", 3) ? 1 : 0) + (Card(s, "interestPct")?.Value ?? 0);
            int cap = GameData.InterestCap + GameData.InterestCapPerWave * s.Wave;
            int interest = Math.Min(cap, JsMath.FloorDiv((long)s.Silver * pct, 100));
            s.Silver += interest;
            ev.Add(new SimEvent { E = "interest", Amount = interest });
        }

        static void StartWave(DefendState s, List<SimEvent> ev)
        {
            s.Wave++;
            s.Recipe = s.NextRecipe;
            s.SpawnQueue.AddRange(WaveEntries(s.StageId, s.Wave, s.Recipe));
            if (s.Phase != "spawning") { s.SpawnT = 0; s.Phase = "spawning"; }
            if (s.Wave < s.TotalWaves) s.NextRecipe = RollRecipe(s, s.Wave + 1);
            ev.Add(new SimEvent { E = "wave", Wave = s.Wave });
        }

        static Enemy Spawn(DefendState s, QueuedEnemy q, List<SimEvent> ev, int at = 0, bool small = false)
        {
            string type = q.Type;
            var def = GameData.Enemies[type];
            // Bosses use their data HP as-is; regular enemies scale with the wave curve.
            int bas = def.Boss != null ? def.Hp : JsMath.FloorDiv((long)GameData.WaveHp(def.Hp, q.Wave) * q.HpPct * GameData.Stages[s.StageId].HpPct, 100 * 100);
            int hp = small ? Math.Max(1, JsMath.FloorDiv(bas, 4)) : Math.Max(1, bas);
            int speed = def.Speed;
            int bounty = small ? 1 : JsMath.FloorDiv((long)def.Bounty * (100 + GameData.BountyGrowthPct * (q.Wave - 1)), 100);
            EliteAffix elite = null;
            if (!small && def.Boss == null && q.Wave >= GameData.EliteFromWave && Rng.RollPct(ref s.Rng) < GameData.EliteChancePct)
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

        // Poison/burn per second, scaled by level and by the Wu Xing match when applied.
        static int DotDps(Disciple d, Enemy e, int bas, int lvl) =>
            JsMath.FloorDiv((long)JsMath.FloorDiv((long)bas * StatPct(lvl), 100) * Wuxing.OvercomePct(Wux(d), e.El), 100);

        struct Stats { public int Dmg, Cooldown, Range; public bool HitsAir, HitsGround; }

        static Stats DiscipleStats(DefendState s, Disciple d)
        {
            var defs = DefsOf(d);
            // Merged form: summed damage x comboDmgPct, attacking at the average cooldown.
            int dmg = d.Combo != null ? JsMath.FloorDiv((long)defs.Sum(x => x.Dmg) * GameData.ComboDmgPct, 100) : defs[0].Dmg;
            dmg = JsMath.FloorDiv((long)dmg * StatPct(d.Level), 100);
            var neighbours = s.Disciples.Where(o => Adjacent(d, o)).ToList();
            if (Wuxing.IsGenerated(Wux(d), neighbours.Select(n => (IList<string>)Wux(n))))
            {
                int v = Card(s, "adjacencyPct")?.Value ?? 0;
                dmg = JsMath.FloorDiv((long)dmg * (v != 0 ? v : AdjacencyPct), 100);
            }
            var el = Card(s, "elementDmg");
            if (el != null && el.Element != null && Wux(d).Contains(el.Element)) dmg = JsMath.FloorDiv((long)dmg * (100 + el.Pct), 100);
            var mono = Card(s, "monoSectPct");
            if (mono != null && s.Disciples.All(o => Wux(o)[0] == Wux(s.Disciples[0])[0])) dmg = JsMath.FloorDiv((long)dmg * (100 + mono.Pct), 100);
            int cooldown = d.Combo != null ? JsMath.FloorDiv(defs.Sum(x => x.Cooldown), defs.Count) : defs[0].Cooldown;
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
            int pct = Wuxing.OvercomePct(Wux(d), e.El);
            int dmg = JsMath.FloorDiv((long)raw * pct, 100);
            if (HasLevel(s, "wood", 3) && (s.Sect == "fire" ? e.BurnT > 0 : e.Poison > 0)) dmg = JsMath.FloorDiv((long)dmg * (100 + WoodVulnPct), 100); // roster: the sect DoT
            if (e.Type == "mimic" && e.LastElT > 0 && e.LastEl != null && Wux(d).Contains(e.LastEl)) dmg = JsMath.FloorDiv(dmg, 2);
            var freeze = Card(s, "slowedVuln");
            if (freeze != null && e.SlowT > 0) dmg = JsMath.FloorDiv((long)dmg * (100 + freeze.Pct), 100);
            var heavy = Card(s, "vsHeavyPct");
            if (heavy != null && (e.Type == "brute" || e.Type.StartsWith("boss"))) dmg = JsMath.FloorDiv((long)dmg * (100 + heavy.Pct), 100);
            if (e.Type == "brute" && d.Combo != "molten_edge") dmg -= BruteArmor;
            dmg = Math.Max(1, dmg);
            e.Hp -= dmg;
            e.LastEl = Wux(d)[0];
            e.LastElT = MimicTicks;
            ev.Add(new SimEvent { E = "hit", From = d.Id, To = e.Id, Dmg = dmg, Pct = pct, Crit = crit, El = Wux(d)[0] });
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
            if (d.OffT > 0) { d.OffT--; return; }
            if (s.SealT > 0 && s.SealEl != null && d.Els.Contains(s.SealEl)) return;
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

            // Fire tier 3 "เพลิงคืนชีพ": every 20 s a phoenix sweeps the path; every enemy on it is hit and set burning.
            // PushT doubles as its timer (only the water kit uses PushT otherwise).
            if (d.Combo == null && d.Els.Contains("fire") && lvl >= 3 && d.PushT >= PhoenixEvery)
            {
                d.PushT = 0;
                ev.Add(new SimEvent { E = "phoenix", From = d.Id });
                foreach (var e in s.Enemies.ToList())
                    if (e.Hp > 0 && (e.Type != "assassin" || e.Revealed))
                    {
                        DealDamage(s, d, e, st.Dmg, false, ev);
                        e.BurnT = FireBurnTicks;
                        e.BurnDps = Math.Max(e.BurnDps, DotDps(d, e, FireBurnDps * 2, lvl));
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
                        // A roster striker's crit feeds its sect's damage over time (fire burn, wood poison), so it plays
                        // into the sect rule instead of being a generic sword.
                        if (crit && DotKind(d) == "burn") { target.BurnT = FireBurnTicks; target.BurnDps = Math.Max(target.BurnDps, DotDps(d, target, FireBurnDps, lvl)); }
                        else if (crit && DotKind(d) == "poison")
                        { target.Poison = Math.Min(3, target.Poison + 1); target.PoisonT = WoodPoisonTicks; target.PoisonDps = Math.Max(target.PoisonDps, DotDps(d, target, WoodPoisonDps, lvl)); }
                        if (crit && lvl >= 3)
                        {
                            var second = s.Enemies.FirstOrDefault(e => e != target && CanTarget(e, st.HitsAir, st.HitsGround) && PathMath.Within(d.X, d.Y, e.X, e.Y, st.Range));
                            if (second != null) DealDamage(s, d, second, raw, true, ev);
                        }
                        break;
                    case "wood":
                        if (DotKind(d) == "burn")
                        {
                            // Fire-sect stacker: its damage over time is a burn, worth two poison stacks, that the sect rule ramps.
                            target.BurnT = WoodPoisonTicks;
                            target.BurnDps = Math.Max(target.BurnDps, DotDps(d, target, WoodPoisonDps * 2, lvl));
                        }
                        else
                        {
                            target.Poison = Math.Min(3, target.Poison + 1);
                            target.PoisonT = WoodPoisonTicks;
                            target.PoisonDps = Math.Max(target.PoisonDps, DotDps(d, target, WoodPoisonDps, lvl));
                        }
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
                        foreach (var e in s.Enemies)
                            if (e.Hp > 0 && (e == target || PathMath.Within(target.X, target.Y, e.X, e.Y, FireSplash)))
                            {
                                if (DotKind(d) == "poison")
                                {
                                    // Wood-sect burst: the splash poisons (one stack) instead of burning.
                                    e.Poison = Math.Min(3, e.Poison + 1);
                                    e.PoisonT = WoodPoisonTicks;
                                    e.PoisonDps = Math.Max(e.PoisonDps, DotDps(d, e, WoodPoisonDps, lvl));
                                }
                                else
                                {
                                    e.BurnT = FireBurnTicks;
                                    e.BurnDps = Math.Max(e.BurnDps, DotDps(d, e, FireBurnDps, lvl));
                                }
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
                e.Revealed = s.RevealAllT > 0 || e.StunT > 0 || e.SlowT > 0 || yy.Any(d => PathMath.Within(d.X, d.Y, e.X, e.Y, YyReveal));
                if (e.LastElT > 0) e.LastElT--;
                if (e.Age % DotEvery == 0)
                {
                    int armour = e.Type == "brute" ? 2 : 1; // Iron Shirt halves damage over time too
                    // Fire sect rule: a burn that keeps going hits harder, +rampPctPerSec per second up to +rampMaxPct.
                    int ramp = s.Sect == "fire" ? Math.Min(GameData.FireRampMaxPct, e.BurnAge / Hz * GameData.FireRampPctPerSec) : 0;
                    if (e.BurnT > 0) e.Hp -= Math.Max(1, JsMath.FloorDiv((long)e.BurnDps * (100 + ramp), 200 * armour));
                    // Wood sect rule: its poison seeps through Iron Shirt (brute armour does not halve it).
                    int poisonArmour = s.Sect == "wood" ? 1 : armour;
                    if (e.PoisonT > 0 && e.Poison > 0) e.Hp -= Math.Max(1, JsMath.FloorDiv((long)e.Poison * e.PoisonDps, 2 * poisonArmour));
                }
                if (e.BurnT > 0) { e.BurnT--; e.BurnAge++; } else e.BurnAge = 0;
                if (e.PoisonT > 0) e.PoisonT--; else e.Poison = 0;
                if (e.RegenPct > 0 && e.Age % Hz == 0) e.Hp = Math.Min(e.MaxHp, e.Hp + JsMath.FloorDiv((long)e.MaxHp * e.RegenPct, 100));
                // Healers mend allies nearby; burning or poisoned allies cannot be healed (SPEC-core §3.2), bosses only 1%.
                if (e.Type == "healer" && e.Age % HealEvery == 0 && e.BurnT == 0 && e.PoisonT == 0)
                    foreach (var o in s.Enemies)
                        if (o != e && o.Hp > 0 && o.BurnT == 0 && o.PoisonT == 0 && PathMath.Within(e.X, e.Y, o.X, o.Y, HealRange))
                            o.Hp = Math.Min(o.MaxHp, o.Hp + JsMath.FloorDiv((long)o.MaxHp * (GameData.Enemies[o.Type].Boss != null ? HealBossPct : HealPct), 100));
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
                    int cost = GameData.Enemies[e.Type].LeakCost;
                    s.Lives = Math.Max(0, s.Lives - cost);
                    s.LivesLost += cost;
                    ev.Add(new SimEvent { E = "leak", Id = e.Id });
                }
        }

        // Boss mechanics fire once per HP threshold (enemies.json bosses[].mechanics).
        static void BossPhases(DefendState s, List<SimEvent> ev)
        {
            foreach (var e in s.Enemies)
            {
                var m = GameData.Enemies[e.Type].Boss;
                if (m == null || e.Hp <= 0) continue;
                while (e.Phase < m.PhasesPct.Count && (long)e.Hp * 100 <= (long)e.MaxHp * m.PhasesPct[e.Phase])
                {
                    e.Phase++;
                    if (m.Effect == "disable")
                    {
                        for (int k = 0; k < m.Count; k++)
                        {
                            var free = s.Disciples.Where(d => d.OffT == 0).ToList();
                            if (free.Count == 0) break;
                            var d = free[(int)Math.Floor(Rng.Next(ref s.Rng) * free.Count)];
                            d.OffT = m.Ticks;
                            ev.Add(new SimEvent { E = "disable", Id = d.Id, From = e.Id });
                        }
                    }
                    else if (m.Effect == "seal" && s.Disciples.Count > 0)
                    {
                        string best = null; int bestN = 0;
                        foreach (var el in GameData.SectOrder)
                        {
                            int n = s.Disciples.Count(d => d.Els[0] == el);
                            if (n > bestN) { best = el; bestN = n; }
                        }
                        s.SealEl = best; s.SealT = m.Ticks;
                        ev.Add(new SimEvent { E = "seal", El = best, From = e.Id });
                    }
                }
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
                if (e.Type == "puppet" && !e.Small) for (int i = 0; i < 3; i++) Spawn(s, new QueuedEnemy { Type = "puppet", Wave = s.Wave, HpPct = 100 }, ev, Math.Max(0, e.D - i * 300), true);
                if (e.BurnT > 0 && s.Disciples.Any(q => q.Combo == "wildfire_flute"))
                    foreach (var o in s.Enemies.Where(o => o.Hp > 0 && PathMath.Within(e.X, e.Y, o.X, o.Y, 1500)).Take(2).ToList())
                    { o.BurnT = FireBurnTicks; o.BurnDps = Math.Max(o.BurnDps, e.BurnDps); }
                // Wood sect rule: a poisoned enemy that dies passes its poison to everything near it.
                if (s.Sect == "wood" && e.Poison > 0)
                    foreach (var o in s.Enemies)
                        if (o.Hp > 0 && PathMath.Within(e.X, e.Y, o.X, o.Y, GameData.WoodSpreadRange))
                        {
                            o.Poison = Math.Min(3, o.Poison + GameData.WoodSpreadStacks);
                            o.PoisonT = WoodPoisonTicks;
                            o.PoisonDps = Math.Max(o.PoisonDps, e.PoisonDps);
                        }
                if (fireExplodes && (e.BurnT > 0 || (s.Sect == "wood" && e.Poison > 0))) // roster: the sect DoT
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
                        if (s.SpawnQueue.Count > 0) { var q = s.SpawnQueue[0]; s.SpawnQueue.RemoveAt(0); Spawn(s, q, ev); }
                        s.SpawnT = GameData.SpawnInterval - 1;
                        if (s.SpawnQueue.Count == 0) s.Phase = "clearing";
                    }
                    break;
                case "clearing":
                    if (s.Enemies.Count == 0)
                    {
                        PayInterest(s, ev);
                        if (s.Wave >= s.TotalWaves) Finish(s, true, ev);
                        else if (s.Wave / GameData.CardEveryWaves > s.CardsOffered)
                        {
                            s.CardsOffered = s.Wave / GameData.CardEveryWaves;
                            OfferCards(s, ev);
                        }
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
                    case "max_2_sects": return s.SectsUsed.Count <= 2;
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
            if (s.SealT > 0 && --s.SealT == 0) s.SealEl = null;
            WaveFlow(s, ev);
            MoveEnemies(s, ev);
            foreach (var d in s.Disciples.ToList()) Attack(s, d, ev);
            BossPhases(s, ev);
            ResolveDeaths(s, ev);
            s.Tick++;
            if (s.Lives <= 0) Finish(s, false, ev);
            return ev;
        }
    }
}
