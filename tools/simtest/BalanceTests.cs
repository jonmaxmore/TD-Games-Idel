// Balance gates from docs/research/design-review.md §6 (B1, B2, B4-B7 + boss mechanics) and SPEC-core §4 (S1/S2),
// measured with the deterministic rules and the greedy bot on fixed seeds.
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

    [Test]
    public static void B2_NoSingleSectSolvesTheFinale()
    {
        int mixed = Seeds.Count(seed => Bot.Play("1-12", seed, earlyCall: true).Phase == "won");
        int mono = Seeds.Count(seed => Bot.Play("1-12", seed, earlyCall: true, sects: new List<string> { "metal" }).Phase == "won");
        Check.AtLeast(3, mixed, "mixed build wins");
        Check.AtMost(1, mono, "metal alone wins");
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
    public static void B5_TwentyWaveStagesTakeAtMost10Minutes()
    {
        foreach (var id in new[] { "T-1", "1-12" })
            foreach (var seed in Seeds.Take(2))
            {
                var s = Bot.Play(id, seed, earlyCall: true);
                Check.Eq("won", s.Phase, $"{id} seed {seed}");
                Check.AtMost(10, s.Tick / 20.0 / 60, $"{id} seed {seed} minutes");
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

    // Jump straight to the boss wave with eight maxed disciples of the first unlocked sect, then play it out.
    static List<SimEvent> BossWave(string stageId, int bossWave)
    {
        var s = Defend.Create(stageId, 3);
        s.Silver = 100000;
        var tiles = new[] { (4, 3), (6, 4), (3, 7), (5, 9), (7, 7), (3, 12), (7, 12), (5, 13) };
        Defend.Step(s, tiles.Select(t => T.Place(s.Unlocked[0], t.Item1, t.Item2)).ToArray());
        for (int i = 0; i < 2; i++) Defend.Step(s, s.Disciples.Select(d => T.Up(d.Id)).ToArray());
        s.Wave = bossWave - 1;
        var ev = Defend.Step(s, new[] { T.NextWave });
        while (!s.IsOver && s.Wave == bossWave && s.Tick < 20 * 60 * 20) ev.AddRange(Defend.Step(s, Array.Empty<Command>()));
        return ev;
    }

    [Test]
    public static void Boss_BanditKingDisablesDisciplesAtHpThresholds() => Check.AtLeast(2, BossWave("1-10", 10).Count(e => e.E == "disable"), "disables");

    [Test]
    public static void Boss_EnvoySealsTheMostUsedSect() => Check.True(BossWave("1-12", 20).Any(e => e.E == "seal" && e.El != null), "seal");

    [Test]
    public static void S1S2_EachRosterSectWinsTheFinaleOnMostSeedsAndTheyAreClose()
    {
        var wins = new[] { "fire", "wood" }.Select(sect => Seeds.Count(seed => Bot.Play("1-12", seed, sect, earlyCall: true).Phase == "won")).ToList();
        foreach (var w in wins) Check.AtLeast(3, w, "wins");
        Check.AtMost(1, Math.Abs(wins[0] - wins[1]), "fire vs wood");
    }
}
