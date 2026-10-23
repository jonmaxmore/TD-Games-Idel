// Sect x role rosters and the sect rules (sects.json > roster, SPEC-core §4).
using System;
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
