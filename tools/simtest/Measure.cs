// Balance report for tuning (not a test): win rate, lives lost and minutes per stage and sect over 8 seeds,
// for a bot that calls waves early and one that does not.  dotnet run --project tools/simtest -- --measure
using System;
using System.Linq;
using FiveSects.Sim;

static class Measure
{
    public static void Report()
    {
        var only = Environment.GetEnvironmentVariable("MEASURE_STAGES");
        var stages = only != null ? only.Split(',') : new[] { "1-1", "1-2", "1-4", "1-6", "1-12", "T-1" };
        var sects = Environment.GetEnvironmentVariable("MEASURE_LEGACY") == "0" ? new[] { "fire", "wood" } : new[] { "fire", "wood", null };
        int n = int.TryParse(Environment.GetEnvironmentVariable("MEASURE_SEEDS"), out var m) ? m : 8;
        var seeds = Enumerable.Range(1, n).Select(i => (uint)i).ToArray();
        Console.WriteLine("stage  sect    early  wins  livesLost  min   stars");
        foreach (var st in stages)
            foreach (var sect in sects)
                foreach (var early in new[] { true, false })
                {
                    var runs = seeds.Select(seed => Bot.Play(st, seed, sect, earlyCall: early)).ToList();
                    if (Environment.GetEnvironmentVariable("MEASURE_DETAIL") == "1")
                        Console.WriteLine("  " + string.Join(" ", runs.Select((r, i) => $"{seeds[i]}:{(r.Phase == "won" ? "W" : "L")}{r.Wave}")));
                    int wins = runs.Count(r => r.Phase == "won");
                    double lost = runs.Average(r => r.LivesLost);
                    double min = runs.Average(r => r.Tick / 20.0 / 60);
                    double stars = runs.Average(r => r.Stars?.Count(x => x) ?? 0);
                    Console.WriteLine($"{st,-6} {sect ?? "legacy",-7} {(early ? "yes" : "no"),-6} {wins}/{n}  {lost,5:0.0}     {min,4:0.0}  {stars:0.0}");
                }
    }
}

