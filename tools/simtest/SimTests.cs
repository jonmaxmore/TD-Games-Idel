// Core rules: Wu Xing, economy, combat, combos, secret arts and cards, variety, command validation, determinism,
// the canonical hash, maps and data integrity.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using FiveSects.Sim;

static class T
{
    public static DefendState Defend(string id = "T-1", uint seed = 1, string sect = null) => FiveSects.Sim.Defend.Create(id, seed, sect);

    public static List<SimEvent> Run(DefendState s, int ticks, params Command[] cmds)
    {
        var ev = FiveSects.Sim.Defend.Step(s, cmds);
        for (int i = 1; i < ticks; i++) ev.AddRange(FiveSects.Sim.Defend.Step(s, Array.Empty<Command>()));
        return ev;
    }

    public static Command Place(string sect, int tx, int ty) => new Command { T = "place", Sect = sect, Tx = tx, Ty = ty };
    public static Command Up(int id) => new Command { T = "upgrade", Id = id };
    public static readonly Command NextWave = new Command { T = "nextWave" };
}

static class WuxingTests
{
    // SPEC-core §7: x1.2 against the element it overcomes, x0.85 against the one that overcomes it (from sects.json).
    [Test]
    public static void OvercomingAndOvercomeBy()
    {
        Check.Eq(120, Wuxing.OvercomePct(new[] { "metal" }, "wood"), "metal vs wood");
        Check.Eq(85, Wuxing.OvercomePct(new[] { "metal" }, "fire"), "metal vs fire");
        Check.Eq(100, Wuxing.OvercomePct(new[] { "metal" }, "water"), "metal vs water");
        Check.Eq(100, Wuxing.OvercomePct(new[] { "yinyang" }, "fire"), "yinyang vs fire");
    }

    [Test]
    public static void ComboUsesItsBestElement() => Check.Eq(120, Wuxing.OvercomePct(new[] { "metal", "water" }, "fire"), "metal+water vs fire");

    [Test]
    public static void EarthGeneratesMetalNotTheOtherWay()
    {
        Check.True(Wuxing.IsGenerated(new[] { "metal" }, new[] { new[] { "earth" } }), "earth generates metal");
        Check.True(!Wuxing.IsGenerated(new[] { "earth" }, new[] { new[] { "metal" } }), "metal does not generate earth");
    }
}

static class EconomyTests
{
    [Test]
    public static void HpCurveIsIntegerAndGrowsAfterWave10()
    {
        Check.Eq(70, GameData.WaveHp(60, 1), "waveHp(60,1)");
        Check.AtLeast(Math.Floor(100 * (1 + 0.18 * 11)) + 1, GameData.WaveHp(100, 11), "waveHp(100,11)");
    }

    [Test]
    public static void PlaceUpgradeSellCostSilver()
    {
        var s = T.Defend();
        int start = s.Silver;
        T.Run(s, 1, T.Place("metal", 4, 4));
        var d = s.Disciples[0];
        Check.Eq(start - GameData.Sects["metal"].Cost, s.Silver, "after place");
        int up = Defend.UpgradeCost(d);
        Check.Eq(GameData.Sects["metal"].Cost * GameData.CostPct[1] / 100, up, "upgrade cost");
        T.Run(s, 1, T.Up(d.Id));
        Check.Eq(2, d.Level, "level");
        int before = s.Silver;
        T.Run(s, 1, new Command { T = "sell", Id = d.Id });
        Check.Eq(before + (GameData.Sects["metal"].Cost + up) * GameData.SellRefundPct / 100, s.Silver, "after sell");
    }

    [Test]
    public static void CannotBuildOnPathOrOnADisciple()
    {
        var s = T.Defend();
        var ev = T.Run(s, 1, T.Place("metal", 0, 1), T.Place("metal", 4, 4), T.Place("earth", 4, 4));
        Check.Eq(1, s.Disciples.Count, "disciples");
        Check.Eq(2, ev.Count(e => e.E == "error"), "errors");
    }

    [Test]
    public static void StoryStagesOnlyUnlockSectsReachedSoFar()
    {
        Check.Seq(new[] { "metal" }, T.Defend("1-1").Unlocked, "1-1");
        Check.Seq(new[] { "metal", "earth", "fire" }, T.Defend("1-4").Unlocked, "1-4 (fire is a guest sect)");
        Check.Seq(new[] { "metal", "water" }, T.Defend("1-2").Unlocked, "1-2");
        Check.Eq(6, T.Defend("T-1").Unlocked.Count, "T-1");
    }

    // Interest is paid once per wave when the field is clear; calling a wave pays nothing.
    public static int InterestAtClear(DefendState s)
    {
        s.Enemies.Clear(); s.SpawnQueue.Clear(); s.Phase = "clearing";
        return T.Run(s, 1).First(e => e.E == "interest").Amount;
    }

    [Test]
    public static void InterestIsPaidWhenTheFieldIsClearAndCapped()
    {
        var s = T.Defend("1-1");
        Check.True(!T.Run(s, 1, T.NextWave).Any(e => e.E == "interest"), "calling a wave pays no interest");
        s.Silver = 1000; s.Wave = 1;
        Check.Eq(GameData.InterestCap + GameData.InterestCapPerWave, InterestAtClear(s), "capped");
        s.Phase = "spawning"; s.Wave = 5; s.Silver = 100;
        Check.Eq(100 * GameData.InterestPct / 100, InterestAtClear(s), "uncapped");
    }

    [Test]
    public static void EarlyCallOverlapsWavesAndPaysAShareOfTheBountyAtStake()
    {
        var s = T.Defend("1-1");
        T.Run(s, 1, T.Place("metal", 4, 3), T.NextWave);
        T.Run(s, 60);
        Check.True(s.Enemies.Count > 0, "enemies on the field");
        int atStake = s.Enemies.Sum(e => e.Bounty);
        int before = s.Silver;
        var ev = T.Run(s, 1, T.NextWave);
        Check.True(!ev.Any(e => e.E == "interest"), "no interest on an early call");
        Check.Eq(2, s.Wave, "wave");
        Check.AtLeast(GameData.EarlyCallBonus + atStake * GameData.EarlyCallPct / 100, s.Silver - before, "silver gained");
        Check.True(s.SpawnQueue.Count > 0, "next wave queued");
    }
}

static class CombatTests
{
    [Test]
    public static void GeneratedDiscipleOutDamagesALoneOne()
    {
        var lone = T.Defend(); var gen = T.Defend();
        T.Run(lone, 1, T.Place("metal", 3, 3));
        T.Run(gen, 1, T.Place("metal", 3, 3), T.Place("earth", 3, 4));
        SimEvent Hit(DefendState s) => T.Run(s, 1500, T.NextWave).FirstOrDefault(e => e.E == "hit" && e.From == s.Disciples[0].Id && !e.Crit);
        var a = Hit(lone); var b = Hit(gen);
        Check.True(a != null && b != null, "both hit");
        Check.True(b.Dmg > a.Dmg, $"generated {b.Dmg} > lone {a.Dmg}");
    }

    [Test]
    public static void MergingMaxedPairMakesTheRightCombo()
    {
        var s = T.Defend();
        s.Silver = 10000;
        T.Run(s, 1, T.Place("metal", 3, 3), T.Place("water", 4, 3));
        int a = s.Disciples[0].Id, b = s.Disciples[1].Id;
        for (int i = 0; i < 2; i++) T.Run(s, 1, T.Up(a), T.Up(b));
        var ev = T.Run(s, 1, new Command { T = "merge", A = a, B = b });
        Check.True(ev.Any(e => e.E == "combo" && e.Type == "frozen_blade"), "frozen_blade combo event");
        Check.Eq(1, s.Disciples.Count, "disciples");
        Check.Seq(new[] { "metal", "water" }, s.Disciples[0].Els, "els");
    }

    [Test]
    public static void MergeRefusedBelowMaxOrNotAdjacent()
    {
        var s = T.Defend();
        s.Silver = 10000;
        T.Run(s, 1, T.Place("metal", 3, 3), T.Place("water", 6, 3));
        var ev = T.Run(s, 1, new Command { T = "merge", A = s.Disciples[0].Id, B = s.Disciples[1].Id });
        Check.True(ev.Any(e => e.E == "error"), "error");
        Check.Eq(2, s.Disciples.Count, "disciples");
    }

    [Test]
    public static void DefendedStageWinsUndefendedLoses()
    {
        var empty = T.Defend("1-1");
        T.Run(empty, 20 * 60 * 10, T.NextWave);
        Check.Eq("lost", empty.Phase, "undefended");
        var guarded = Bot.Play(T.Defend("1-1"));
        Check.Eq("won", guarded.Phase, "bot");
        Check.True(guarded.Stars != null && guarded.Stars[0], "clear star");
    }
}

static class ComboTests
{
    static DefendState MaxedPair(string a, string b)
    {
        var s = T.Defend();
        s.Silver = 100000;
        T.Run(s, 1, T.Place(a, 3, 3), T.Place(b, 4, 3));
        int x = s.Disciples[0].Id, y = s.Disciples[1].Id;
        for (int i = 0; i < 2; i++) T.Run(s, 1, T.Up(x), T.Up(y));
        T.Run(s, 1, new Command { T = "merge", A = x, B = y });
        return s;
    }

    [Test]
    public static void EveryComboInTheDataHasASignatureEffect()
    {
        string src = File.ReadAllText(Path.Combine(Repo.Sim, "Defend.cs"));
        foreach (var c in GameData.Combos) Check.True(src.Contains("\"" + c.Id + "\""), c.Id + " has no rule in Defend.cs");
    }

    [Test]
    public static void RootQuakeKeepsItsBellStunWhileItsRootTimerRuns()
    {
        var s = MaxedPair("wood", "earth");
        Check.Eq("root_quake", s.Disciples[0].Combo, "combo");
        var ev = T.Run(s, 2500, T.NextWave);
        Check.AtLeast(4, ev.Count(e => e.E == "stun" && e.From == s.Disciples[0].Id), "stuns");
    }

    [Test]
    public static void MoltenEdgeIgnoresBruteArmor()
    {
        var s = MaxedPair("metal", "fire");
        T.Run(s, 2, T.NextWave);
        var e = s.Enemies[0];
        e.Id = 999; e.Type = "brute"; e.El = "earth"; e.Hp = e.MaxHp = 100000; e.D = 3000; e.X = 3500; e.Y = 2500; e.StunT = 1000;
        var hits = T.Run(s, 60).Where(x => x.E == "hit" && x.To == 999 && !x.Crit).ToList();
        // merged damage (sum x comboDmgPct) at level 3, armour not subtracted; earth target is neutral to metal+fire
        int expected = (GameData.Sects["metal"].Dmg + GameData.Sects["fire"].Dmg) * GameData.ComboDmgPct / 100 * GameData.StatPct[2] / 100;
        Check.True(hits.Count > 0, "hits");
        Check.Eq(expected, hits[0].Dmg, "damage");
    }

    [Test]
    public static void YinYangLevel3AddsOnePercentInterest()
    {
        var s = T.Defend();
        s.Silver = 100000;
        T.Run(s, 1, T.Place("yinyang", 10, 0));
        for (int i = 0; i < 2; i++) T.Run(s, 1, T.Up(s.Disciples[0].Id));
        s.Silver = 400;
        s.Wave = 10; // cap 40, so the +1% is visible: 400 * (4 + 1)% = 20
        Check.Eq(20, EconomyTests.InterestAtClear(s), "interest");
    }
}

static class ArtAndCardTests
{
    [Test]
    public static void HeavenSwordHitsThenGoesOnCooldown()
    {
        var s = T.Defend("1-1");
        T.Run(s, 60, T.NextWave);
        int before = s.Enemies.Sum(e => e.Hp);
        var ev = T.Run(s, 1, new Command { T = "cast", Art = "heaven_sword" });
        Check.True(ev.Any(e => e.E == "art" && e.Name == "heaven_sword"), "art event");
        Check.True(s.Enemies.Sum(e => e.Hp) < before, "damage dealt");
        var again = T.Run(s, 1, new Command { T = "cast", Art = "heaven_sword" });
        Check.True(again.Any(e => e.E == "error" && e.Msg == "art on cooldown"), "cooldown error");
    }

    [Test]
    public static void LionRoarStunsEverythingAndReveals()
    {
        var s = T.Defend();
        T.Run(s, 200, T.NextWave);
        T.Run(s, 1, new Command { T = "cast", Art = "lion_roar" });
        Check.True(s.Enemies.All(e => e.StunT > 0), "all stunned");
        Check.True(s.RevealAllT > 0, "reveal");
    }

    [Test]
    public static void OffersThreeCardsAfterWave5AndAutoPicks()
    {
        var s = T.Defend("1-1");
        s.Silver = 10000;
        T.Run(s, 1, new[] { (3, 3), (5, 3), (7, 3), (3, 6), (5, 8), (7, 8) }.Select(p => T.Place("metal", p.Item1, p.Item2)).ToArray());
        while (s.Phase != "picking" && !s.IsOver) Defend.Step(s, s.Phase == "build" || s.Phase == "break" ? new[] { T.NextWave } : Array.Empty<Command>());
        Check.Eq(5, s.Wave, "wave");
        Check.Eq(3, s.Offer.Count, "offer size");
        Check.Eq(3, s.Offer.Distinct().Count(), "distinct cards");
        Check.True(s.Offer.All(id => !new[] { "overheat", "deep_freeze", "mountain_root" }.Contains(id)), "no cards for locked sects");
        string first = s.Offer[0];
        var ev = T.Run(s, 20 * 16);
        Check.True(ev.Any(e => e.E == "picked" && e.Name == first), "auto-picked the first card");
        Check.Seq(new[] { first }, s.Cards, "cards");
    }

    [Test]
    public static void BountyBoardAddsSilverPerKill()
    {
        var a = T.Defend("1-1"); var b = T.Defend("1-1");
        b.Cards.Add("bounty_board");
        foreach (var s in new[] { a, b }) T.Run(s, 1, T.Place("metal", 3, 3), T.NextWave);
        var ka = T.Run(a, 900).FirstOrDefault(e => e.E == "kill"); var kb = T.Run(b, 900).FirstOrDefault(e => e.E == "kill");
        Check.True(ka != null && kb != null, "kills");
        Check.Eq(ka.Amount + 1, kb.Amount, "bounty");
    }
}

static class VarietyTests
{
    [Test]
    public static void TargetModesPickDifferentEnemies()
    {
        // Three stunned enemies in range: lead (d high, mid hp), strong (most hp), weak+close.
        int Pick(string mode)
        {
            var s = T.Defend("1-1");
            T.Run(s, 1, T.Place("metal", 4, 3), T.NextWave);
            T.Run(s, 60);
            var (a, b, c) = (s.Enemies[0], s.Enemies[1], s.Enemies[2]);
            a.D = 6000; a.X = 6500; a.Y = 2500; a.Hp = 50; a.StunT = 999;
            b.D = 5000; b.X = 5500; b.Y = 2500; b.Hp = 90; b.StunT = 999;
            c.D = 4000; c.X = 4500; c.Y = 2500; c.Hp = 20; c.StunT = 999;
            s.Disciples[0].Cd = 0;
            var hit = T.Run(s, 1, new Command { T = "target", Id = s.Disciples[0].Id, Mode = mode }).FirstOrDefault(e => e.E == "hit");
            return hit == null ? -1 : new[] { a.Id, b.Id, c.Id }.ToList().IndexOf(hit.To);
        }
        Check.Eq(0, Pick("first"), "first");
        Check.Eq(1, Pick("strong"), "strong");
        Check.Eq(2, Pick("weak"), "weak");
        Check.Eq(2, Pick("close"), "close");
    }

    [Test]
    public static void WaveEntriesMatchWhatTheNextWaveSpawns()
    {
        var s = T.Defend("1-4");
        int preview = Defend.WaveEntries(s.StageId, s.Wave + 1, s.NextRecipe).Count;
        Check.Eq(preview, T.Run(s, 400, T.NextWave).Count(e => e.E == "spawn"), "spawned");
    }

    [Test]
    public static void ElitesAppearFromWave5()
    {
        var s = T.Defend("T-1");
        s.Wave = 7;
        for (int i = 0; i < 200; i++) Defend.Step(s, Array.Empty<Command>());
        for (int w = 0; w < 3; w++) { s.Phase = "build"; T.Run(s, 300, T.NextWave); }
        var e = s.Enemies.FirstOrDefault(x => x.Elite != null);
        Check.True(e != null, "an elite");
        Check.True(new[] { "golden", "swift", "undying" }.Contains(e.Elite), "affix " + e.Elite);
    }

    [Test]
    public static void RejectsUnknownSects()
    {
        var s = T.Defend("1-1");
        var ev = T.Run(s, 1, T.Place("dragon", 4, 4));
        Check.Eq(0, s.Disciples.Count, "disciples");
        Check.Eq(1, ev.Count(e => e.E == "error"), "errors");
    }

    [Test]
    public static void GreedyBotWinsEarlyStages()
    {
        foreach (var id in new[] { "1-1", "1-2", "1-4", "T-1" }) Check.Eq("won", Bot.Play(T.Defend(id), maxDisciples: 6).Phase, id);
    }
}

static class DeterminismTests
{
    static readonly Dictionary<int, List<Command>> Replay = new Dictionary<int, List<Command>>
    {
        [0] = new List<Command> { T.Place("metal", 3, 2), T.Place("earth", 3, 3), T.NextWave },
        [200] = new List<Command> { T.Place("metal", 6, 5) },
        [600] = new List<Command> { T.Up(1) },
        [900] = new List<Command> { T.Place("earth", 7, 10) },
    };

    static List<string> Trace(uint seed)
    {
        var hashes = new List<string>();
        var end = Goldens.Replay("1-4", seed, null, Replay, s => { if (s.Tick % 100 == 0) hashes.Add(Canonical.Hash(s)); });
        hashes.Add(end.Phase + ":" + Canonical.Hash(end));
        return hashes;
    }

    [Test]
    public static void SameSeedAndCommandsGiveIdenticalHashes()
    {
        var a = Trace(42); var b = Trace(42);
        Check.AtLeast(11, a.Count, "trace length");
        Check.Seq(a, b, "second run");
    }

    [Test]
    public static void ADifferentSeedDiverges() => Check.True(Trace(43).Last() != Trace(42).Last(), "seed 43 vs 42");

    [Test]
    public static void CanonicalStringHasAFixedLayout()
    {
        Check.Eq($"0|120|{GameData.StartLives}|0|build|1|||", Canonical.String(T.Defend("1-1")), "canonical");
        Check.Eq("1a47e90b", Canonical.Fnv1a("abc"), "fnv1a");
    }

    // The rules must give the same result on every device and on the server: no clocks, no system randomness,
    // no engine calls and no single-precision floats (results differ across CPUs and compilers).
    [Test]
    public static void RulesUseNoNonDeterministicApis()
    {
        var banned = new Regex(@"System\.Random|new Random\(|DateTime|Stopwatch|Environment\.TickCount|Guid\.|UnityEngine|\bfloat\b|\bTime\.|GetHashCode\(");
        var files = Directory.GetFiles(Repo.Sim, "*.cs");
        Check.AtLeast(3, files.Length, "sim files");
        foreach (var f in files)
        {
            var src = Regex.Replace(File.ReadAllText(f), @"//[^\n]*", "");
            var m = banned.Match(src);
            Check.True(!m.Success, $"{Path.GetFileName(f)} uses {m.Value}");
        }
    }
}

static class MapTests
{
    [Test]
    public static void DefendLayoutsStartOnTheEdgeEndInsideAndKeepPropsOffThePath()
    {
        bool Edge(Pt p) => p.X == 0 || p.Y == 0 || p.X == Layouts.GridW - 1 || p.Y == Layouts.GridH - 1;
        foreach (var name in Layouts.All.Keys.Where(k => Layouts.All[k].Kind == "defend"))
            foreach (var variant in new[] { null, "mirror" })
            {
                var l = Layouts.Get(name, variant);
                var r = l.Path;
                for (int i = 1; i < r.Length; i++) Check.True(r[i].X == r[i - 1].X || r[i].Y == r[i - 1].Y, $"{name} segment {i}");
                Check.True(Edge(r[0]), name + " spawn on the edge");
                Check.True(!Edge(r[r.Length - 1]), name + " goal inside");
                var path = PathMath.TilesOnPath(r);
                foreach (var p in l.Props)
                {
                    Check.True(Layouts.PropBlocks.ContainsKey(p.Type), $"{name} prop type {p.Type}");
                    Check.True(!path.Contains(p.At.X + "," + p.At.Y), $"{name} prop {p.Type} on the path");
                }
                Check.True(Layouts.Biomes.ContainsKey(l.Biome), name + " biome");
            }
    }

    [Test]
    public static void MirrorTwiceIsTheOriginal()
    {
        foreach (var name in Layouts.All.Keys.Where(k => Layouts.All[k].Kind == "defend"))
        {
            var back = Layouts.Get(name, "mirror").Path.Select(p => (Layouts.GridW - 1 - p.X, p.Y));
            Check.Seq(Layouts.All[name].Path.Select(p => (p.X, p.Y)), back, name);
        }
    }

    [Test]
    public static void StageLayoutsExistAndBlockedTilesStopBuilding()
    {
        foreach (var st in GameData.StageList) if (st.Layout != null) Check.True(Layouts.All.ContainsKey(st.Layout), st.Id + " layout");
        var s = T.Defend("1-1");
        var b = s.Blocked.First().Split(',').Select(int.Parse).ToArray();
        var ev = T.Run(s, 1, T.Place("metal", b[0], b[1]));
        Check.Eq(0, s.Disciples.Count, "disciples");
        Check.True(ev.Any(e => e.E == "error"), "error");
    }
}

static class DataTests
{
    [Test]
    public static void StagesReferenceExistingEnemiesAndLayouts()
    {
        foreach (var id in new[] { "T-1", "1-1", "1-2", "1-3", "1-4" })
        {
            var st = GameData.Stages[id];
            Check.True(st.Layout != null, id + " has a layout");
            foreach (var e in st.Enemies) Check.True(GameData.Enemies.ContainsKey(e), $"{id}: {e}");
        }
    }

    // The Unity client ships Assets/Resources/data; it must be the docs/data source of truth (npm run unity:sync).
    [Test]
    public static void UnityDataIsInSyncWithDocsData()
    {
        foreach (var f in Directory.GetFiles(Repo.DocsData, "*.json"))
        {
            var copy = Path.Combine(Repo.UnityData, Path.GetFileName(f));
            Check.True(File.Exists(copy) && File.ReadAllText(copy) == File.ReadAllText(f), Path.GetFileName(f) + " not synced: run npm run unity:sync");
        }
    }
}
