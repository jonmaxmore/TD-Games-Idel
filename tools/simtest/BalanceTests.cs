// Balance gates from docs/research/design-review.md §6 (B1, B2, B4-B7 + boss mechanics) and SPEC-core §4 (story curve
// for the roster sects), measured with the deterministic rules and the greedy bot on fixed seeds. The story is played
// with a roster sect (sect pick offers only those); the element-mixing build lives on the training ground T-1.
// npm test -- --measure prints the full table these gates were tuned from.
using System;
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;

static class BalanceTests
{
    static readonly uint[] Seeds = { 1, 2, 3, 4 };

    // Direct damage per second per 100 silver at level 1 (metal adds its 15% crit chance), plus DoT on one target.
    [Test]
    public static void B1_CostEfficiencyWithin30To55DpsPer100Silver()
    {
        var dot = new Dictionary<string, double> { ["wood"] = 10, ["fire"] = 6 };
        foreach (var el in new[] { "metal", "wood", "water", "fire", "earth" })
        {
            var s = GameData.Sects[el];
            double rate = 20.0 / s.Cooldown;
            double direct = s.Dmg * rate * (el == "metal" ? 1.15 : 1);
            double per100 = (direct + (dot.TryGetValue(el, out var d) ? d : 0)) * 100 / s.Cost;
            Check.AtLeast(30, per100, el);
            Check.AtMost(55, per100, el);
        }
    }

    // The training ground (all six element sects): mixing wins, any single element alone does not.
    [Test]
    public static void B2_OnTheTrainingGroundNoSingleElementWins()
    {
        int mixed = Seeds.Count(seed => Bot.Play("T-1", seed, earlyCall: true).Phase == "won");
        Check.AtLeast(4, mixed, "mixed build wins");
        foreach (var el in new[] { "metal", "water", "earth" })
            Check.AtMost(1, Seeds.Count(seed => Bot.Play("T-1", seed, earlyCall: true, sects: new List<string> { el }).Phase == "won"), el + " alone wins");
    }

    [Test]
    public static void B4_MergingIsWorthItButNotMandatory()
    {
        foreach (var c in GameData.Combos)
        {
            var A = GameData.Sects[c.A]; var B = GameData.Sects[c.B];
            double separate = (double)A.Dmg / A.Cooldown + (double)B.Dmg / B.Cooldown;
            double merged = (double)((A.Dmg + B.Dmg) * GameData.ComboDmgPct / 100) / ((A.Cooldown + B.Cooldown) / 2);
            Check.AtLeast(1.1, merged / separate, c.Id);
            Check.AtMost(1.3, merged / separate, c.Id);
        }
    }

    [Test]
    public static void B5_TwentyWaveStagesTakeAtMost10MinutesWhenCallingEarly()
    {
        foreach (var seed in Seeds.Take(2))
        {
            var s = Bot.Play("T-1", seed, earlyCall: true);
            Check.Eq("won", s.Phase, $"T-1 seed {seed}");
            Check.AtMost(10, s.Tick / 20.0 / 60, $"T-1 seed {seed} minutes");
        }
        foreach (var sect in new[] { "fire", "wood" })
            foreach (var seed in Seeds)
            {
                var s = Bot.Play("1-12", seed, sect, earlyCall: true);
                if (s.Phase == "won") Check.AtMost(10, s.Tick / 20.0 / 60, $"1-12 {sect} seed {seed} minutes");
            }
    }

    [Test]
    public static void B6_AtLeast3CommandsAMinute()
    {
        foreach (var id in new[] { "1-2", "1-12" })
        {
            var rec = new Dictionary<int, List<Command>>();
            var s = Bot.Play(id, 1, earlyCall: true, record: rec);
            Check.AtLeast(3, rec.Values.Sum(v => v.Count) / (s.Tick / 20.0 / 60), id);
        }
    }

    [Test]
    public static void B7_SeedsChangeWaveShapes()
    {
        List<string> Shapes(uint seed)
        {
            var s = Defend.Create("T-1", seed);
            var o = new List<string>();
            // Waves can be called back to back without fighting: the shape sequence depends only on the seed.
            while (s.Wave < s.TotalWaves) { Defend.Step(s, new[] { T.NextWave }); o.Add(s.Recipe); }
            return o;
        }
        var a = Shapes(1); var b = Shapes(2);
        Check.AtLeast(4, a.Distinct().Count(), "distinct shapes");
        Check.AtLeast(0.5, (double)a.Where((r, i) => r != b[i]).Count() / a.Count, "differ by seed");
        for (int i = 1; i < a.Count; i++) if (a[i] != "mixed") Check.True(a[i] != a[i - 1], $"wave {i + 1} repeats");
    }

    // Jump straight to the boss wave with eight maxed disciples (rotating through what is unlocked), then play it out.
    static List<SimEvent> BossWave(string stageId, int bossWave, string sect = null)
    {
        var s = Defend.Create(stageId, 3, sect);
        s.Silver = 100000;
        s.Lives = 1000; // the test is about the boss mechanic, not about holding the wave
        var tiles = new[] { (4, 3), (6, 4), (3, 7), (5, 9), (7, 7), (3, 12), (7, 12), (5, 13) };
        Defend.Step(s, tiles.Select((t, i) => T.Place(s.Unlocked[i % s.Unlocked.Count], t.Item1, t.Item2)).ToArray());
        for (int i = 0; i < 2; i++) Defend.Step(s, s.Disciples.Select(d => T.Up(d.Id)).ToArray());
        s.Wave = bossWave - 1;
        var ev = Defend.Step(s, new[] { T.NextWave });
        while (!s.IsOver && s.Wave == bossWave && s.Tick < 20 * 60 * 20) ev.AddRange(Defend.Step(s, Array.Empty<Command>()));
        return ev;
    }

    [Test]
    public static void Boss_BanditKingDisablesDisciplesAtHpThresholds() => Check.AtLeast(2, BossWave("1-10", 10).Count(e => e.E == "disable"), "disables");

    [Test]
    public static void Boss_EnvoySealsTheMostUsedSect() => Check.True(BossWave("1-12", 20, "fire").Any(e => e.E == "seal" && e.El != null), "seal");

    // Story curve for the player's path (roster sects, a bot that reads the next-wave bar and does not call early):
    // the tutorial is safe, mid-chapter stages are won almost always, the finale is a real test that costs lives,
    // and the two sects end within 15 points of each other (SPEC-core §4 S1/S2).
    static readonly uint[] StorySeeds = Enumerable.Range(1, 24).Select(i => (uint)i).ToArray();

    static (double win, double lost) Rate(string stage, string sect)
    {
        var runs = StorySeeds.Select(seed => Bot.Play(stage, seed, sect)).ToList();
        return (runs.Count(r => r.Phase == "won") / (double)runs.Count, runs.Average(r => r.LivesLost));
    }

    [Test]
    public static void StoryCurveRisesToARealFinaleForBothSects()
    {
        var finale = new Dictionary<string, double>();
        foreach (var sect in new[] { "fire", "wood" })
        {
            Check.AtLeast(1, Rate("1-1", sect).win, sect + " 1-1");
            foreach (var st in new[] { "1-2", "1-4", "1-6" }) Check.AtLeast(0.85, Rate(st, sect).win, $"{sect} {st}");
            var (win, lost) = Rate("1-12", sect);
            Check.AtLeast(0.55, win, sect + " 1-12 win rate");
            Check.AtMost(0.9, win, sect + " 1-12 win rate");
            Check.AtLeast(1, lost, sect + " 1-12 lives lost on average");
            finale[sect] = win;
        }
        Check.AtMost(0.15, Math.Abs(finale["fire"] - finale["wood"]), "fire vs wood on 1-12");
    }
}
