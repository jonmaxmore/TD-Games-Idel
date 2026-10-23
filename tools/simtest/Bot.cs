// Simple greedy player used for balance checks and golden replays: builds on the tiles that cover the most path,
// alternates the unlocked sects, and upgrades once it has enough disciples.
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;

static class Bot
{
    public static List<(int tx, int ty)> BestTiles(DefendState s, int range = 2500)
    {
        var path = s.PathTiles.Select(k => k.Split(',')).Select(p => (x: int.Parse(p[0]), y: int.Parse(p[1]))).ToList();
        var scored = new List<(int tx, int ty, int score)>();
        double r = range / 1000.0;
        for (int ty = 0; ty < Layouts.GridH; ty++)
            for (int tx = 0; tx < Layouts.GridW; tx++)
            {
                if (!Defend.CanBuild(s, tx, ty)) continue;
                int score = path.Count(p => (p.x - tx) * (p.x - tx) + (p.y - ty) * (p.y - ty) <= r * r);
                scored.Add((tx, ty, score));
            }
        return scored.OrderByDescending(x => x.score).ThenBy(x => x.ty).ThenBy(x => x.tx).Select(x => (x.tx, x.ty)).ToList();
    }

    // earlyCall: also calls the next wave once the current one has fully spawned and at most 3 enemies remain.
    public static DefendState Play(DefendState s, int maxDisciples = 8, List<string> sects = null, Dictionary<int, List<Command>> record = null, bool earlyCall = false)
    {
        sects ??= s.Unlocked;
        int placed = 0;
        while (!s.IsOver && s.Tick < 20 * 60 * 30)
        {
            var cmds = s.Tick == 0 ? new List<Command> { new Command { T = "nextWave" } } : new List<Command>();
            if (earlyCall && s.Phase == "clearing" && s.Enemies.Count <= 3 && s.Wave < s.TotalWaves) cmds.Add(new Command { T = "nextWave" });
            string sect = sects[placed % sects.Count];
            var lowest = s.Disciples.OrderBy(d => d.Level).FirstOrDefault();
            // Past the cap, keep spending: once every disciple is maxed, place more instead of hoarding silver.
            bool allMaxed = lowest != null && lowest.Level >= 3;
            bool wantPlace = placed < 3 || ((placed < maxDisciples || allMaxed) && (lowest == null || lowest.Level >= 2));
            if (wantPlace)
            {
                var spots = BestTiles(s, GameData.DefOf(sect).Range);
                if (spots.Count > 0 && s.Silver >= Defend.PlaceCost(sect)) { cmds.Add(new Command { T = "place", Sect = sect, Tx = spots[0].tx, Ty = spots[0].ty }); placed++; }
            }
            else if (lowest != null && lowest.Level < 3 && s.Silver >= Defend.UpgradeCost(lowest)) cmds.Add(new Command { T = "upgrade", Id = lowest.Id });
            if (record != null && cmds.Count > 0) record[s.Tick] = cmds;
            Defend.Step(s, cmds);
        }
        return s;
    }

    public static DefendState Play(string stageId, uint seed, string sect = null, int maxDisciples = 8, List<string> sects = null, Dictionary<int, List<Command>> record = null, bool earlyCall = false)
        => Play(Defend.Create(stageId, seed, sect), maxDisciples, sects, record, earlyCall);
}
