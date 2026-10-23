// Sect x role rosters and the sect rules (sects.json > roster, SPEC-core §4).
using System;
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;

static class SectTests
{
    [Test]
    public static void RolesUnlockAlongChapter1AndAllOnTrainingGrounds()
    {
        Check.Seq(new[] { "crimson_phoenix_striker", "crimson_phoenix_burst" }, Defend.UnlockedUnits("fire", "1-1"), "fire 1-1");
        Check.Seq(new[] { "jade_bamboo_striker", "jade_bamboo_burst", "jade_bamboo_control" }, Defend.UnlockedUnits("wood", "1-2"), "wood 1-2");
        Check.Eq(5, Defend.UnlockedUnits("fire", "1-12").Count, "fire 1-12");
        Check.Eq(5, Defend.UnlockedUnits("wood", "T-0").Count, "wood T-0");
    }

    [Test]
    public static void ASectWithoutARosterPlaysLegacyDisciples()
    {
        var s = T.Defend("1-1", 1, "metal");
        Check.Eq(null, s.Sect, "sect");
        Check.Seq(new[] { "metal" }, s.Unlocked, "unlocked");
    }

    [Test]
    public static void ARosterUnitFightsWithItsKitButCountsAsItsSect()
    {
        var s = T.Defend("1-12", 1, "fire");
        T.Run(s, 1, T.Place("crimson_phoenix_striker", 3, 3));
        var d = s.Disciples[0];
        Check.Seq(new[] { "metal" }, d.Els, "kit");
        Check.Eq("fire", d.El, "sect element");
        Check.Eq("crimson_phoenix_striker", d.Unit, "unit");
        Check.Eq(T.Defend("1-12", 1, "fire").Silver - GameData.Units["crimson_phoenix_striker"].Cost, s.Silver, "silver");
    }

    [Test]
    public static void RejectsMergingRosterDisciples()
    {
        var s = T.Defend("1-12", 1, "wood");
        s.Silver = 10000;
        T.Run(s, 1, T.Place("jade_bamboo_striker", 3, 3), T.Place("jade_bamboo_burst", 4, 3));
        for (int i = 0; i < 2; i++) T.Run(s, 1, s.Disciples.Select(d => T.Up(d.Id)).ToArray());
        Check.True(T.Run(s, 1, new Command { T = "merge", A = 1, B = 2 }).Any(e => e.E == "error"), "error");
    }

    static int BurnLoss(string sect)
    {
        var s = T.Defend("1-12", 1, sect);
        Defend.Step(s, new[] { T.NextWave });
        while (s.Enemies.Count == 0) Defend.Step(s, Array.Empty<Command>());
        var e = s.Enemies[0];
        e.Hp = e.MaxHp = 100000;
        int lost = 0;
        for (int t = 0; t < 100; t++) { e.BurnT = 60; e.BurnDps = 20; int before = e.Hp; Defend.Step(s, Array.Empty<Command>()); lost += before - e.Hp; }
        return lost;
    }

    [Test]
    public static void FireABurnThatKeepsGoingHitsHarder() => Check.True(BurnLoss("fire") > BurnLoss(null), "fire ramp");

    [Test]
    public static void WoodAPoisonedEnemyThatDiesPoisonsItsNeighbours()
    {
        var s = T.Defend("1-12", 1, "wood");
        Defend.Step(s, new[] { T.NextWave });
        while (s.Enemies.Count < 2) Defend.Step(s, Array.Empty<Command>());
        var (a, b) = (s.Enemies[0], s.Enemies[1]);
        b.X = a.X; b.Y = a.Y; b.Poison = 0;
        a.Poison = 2; a.PoisonT = 40; a.PoisonDps = 10; a.Hp = 0;
        Defend.Step(s, Array.Empty<Command>());
        Check.True(b.Poison > 0, "neighbour poisoned");
    }
}

// Rules added in the polish pass (plan phase 1): each one written once, here and in Defend.cs.
static class RosterRuleTests
{
    [Test]
    public static void RosterGamesGetTheirSectCardsAndNeverTheMixingCards()
    {
        var seen = new HashSet<string>();
        foreach (uint seed in new uint[] { 1, 2, 3, 4, 5, 6, 7, 8 })
        {
            var s = T.Defend("1-12", seed, "fire");
            s.Wave = 5; s.Phase = "clearing";
            T.Run(s, 1);
            Check.Eq("picking", s.Phase, "offer after wave 5 boundary");
            seen.UnionWith(s.Offer);
        }
        Check.True(!seen.Contains("five_harmony") && !seen.Contains("single_path"), "mixing cards offered: " + string.Join(",", seen));
        var cards = GameData.Cards.Where(c => c.Needs == "fire").Select(c => c.Id).ToList();
        Check.True(cards.Count > 0, "fire has a sect card");
        Check.True(GameData.Cards.Where(c => c.Needs != null && c.Needs != "fire").All(c => !seen.Contains(c.Id)), "other sects' cards offered");
    }

    [Test]
    public static void HealersCannotMendBurningOrPoisonedAlliesAndBossesOnlyOnePercent()
    {
        var s = T.Defend("1-12", 1, "fire");
        T.Run(s, 1, T.NextWave);
        while (s.Enemies.Count < 3) T.Run(s, 1);
        var (h, a, b) = (s.Enemies[0], s.Enemies[1], s.Enemies[2]);
        h.Type = "healer"; h.Age = 0;
        foreach (var e in new[] { a, b }) { e.X = h.X; e.Y = h.Y; e.MaxHp = 1000; e.Hp = 500; e.StunT = 100; }
        h.StunT = 100;
        a.BurnT = 100; a.BurnDps = 0;
        // Let one heal tick land.
        for (int i = 0; i < 20; i++) { a.Hp = Math.Max(a.Hp, 500); T.Run(s, 1); }
        Check.True(b.Hp > 500, "healthy ally healed");
        Check.True(a.Hp <= 500, "burning ally not healed");
        var boss = s.Enemies[2];
        boss.Type = "boss_ch1b"; boss.MaxHp = 100000; boss.Hp = 50000;
        int before = boss.Hp;
        for (int i = 0; i < 20; i++) T.Run(s, 1);
        Check.AtMost(before + 100000 / 100, boss.Hp, "boss heal capped at 1%/s");
    }

    [Test]
    public static void WaveShapesNeedARoleThePlayerHas()
    {
        // 1-1: only striker and burst; "rush" needs a binder, so it must never be rolled.
        foreach (uint seed in new uint[] { 1, 2, 3, 4, 5, 6, 7, 8 })
        {
            var s = T.Defend("1-1", seed, "wood");
            var shapes = new List<string>();
            while (s.Wave < s.TotalWaves) { Defend.Step(s, new[] { T.NextWave }); shapes.Add(s.Recipe); }
            Check.True(!shapes.Contains("rush"), $"seed {seed}: {string.Join(",", shapes)}");
        }
    }

    static Enemy StrikerCrit(string sect, string unit)
    {
        var s = T.Defend("1-12", 1, sect);
        T.Run(s, 1, T.Place(unit, 4, 3), T.NextWave);
        while (s.Enemies.Count == 0) T.Run(s, 1);
        var e = s.Enemies[0];
        e.X = 4500; e.Y = 2500; e.StunT = 999; e.Hp = e.MaxHp = 100000; e.Type = "cultist";
        var d = s.Disciples[0];
        d.Hits = 5; d.Cd = 0; d.Level = 2; // level 2: every 6th hit is a sure crit
        T.Run(s, 1);
        return e;
    }

    [Test]
    public static void ARosterStrikersCritFeedsItsSectDot()
    {
        Check.True(StrikerCrit("fire", "crimson_phoenix_striker").BurnT > 0, "fire striker crit burns");
        Check.True(StrikerCrit("wood", "jade_bamboo_striker").Poison > 0, "wood striker crit poisons");
    }

    [Test]
    public static void FireTier3PhoenixSweepsThePathEvery20Seconds()
    {
        var s = T.Defend("1-12", 1, "fire");
        s.Silver = 100000;
        T.Run(s, 1, T.Place("crimson_phoenix_burst", 4, 3), T.NextWave);
        var d = s.Disciples[0];
        for (int i = 0; i < 2; i++) T.Run(s, 1, T.Up(d.Id));
        Check.Eq(3, d.Level, "level");
        var ev = T.Run(s, 20 * 21);
        var sweep = ev.FindIndex(e => e.E == "phoenix" && e.From == d.Id);
        Check.True(sweep >= 0, "phoenix event within 21 s");
    }

    [Test]
    public static void Max2SectsStarCountsSectsPlaced()
    {
        var s = T.Defend("T-1");
        s.Silver = 10000;
        T.Run(s, 1, T.Place("metal", 3, 3), T.Place("water", 5, 3));
        Check.Eq(2, s.SectsUsed.Count, "two sects");
        T.Run(s, 1, T.Place("fire", 7, 3));
        Check.Eq(3, s.SectsUsed.Count, "three sects");
    }
}
