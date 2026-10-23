// The committed goldens must be exactly what the current rules and bot produce, and every golden must replay
// to its recorded hashes. A mismatch means a rule changed: if on purpose, rewrite them with npm run sim:golden.
using System.IO;
using System.Linq;
using FiveSects.Sim;
using Newtonsoft.Json.Linq;

static class GoldenTests
{
    [Test]
    public static void CommittedGoldensAreUpToDate()
    {
        foreach (var kv in Goldens.All)
        {
            var committed = File.ReadAllText(Goldens.Path(kv.Key));
            var fresh = Goldens.Serialize(kv.Value());
            Check.True(committed == fresh, $"golden-{kv.Key}.json is stale: run npm run sim:golden (first difference at char {FirstDiff(committed, fresh)})");
        }
    }

    [Test]
    public static void EveryGoldenReplaysToItsHashes()
    {
        foreach (var file in Directory.GetFiles(Repo.Goldens, "golden-*.json").OrderBy(f => f, System.StringComparer.Ordinal))
        {
            var g = JObject.Parse(File.ReadAllText(file));
            var commands = ((JObject)g["commands"]).Properties().ToDictionary(p => int.Parse(p.Name), p => p.Value.Select(Goldens.FromJson).ToList());
            var trace = ((JArray)g["trace"]).Select(t => ((int)t[0], (string)t[1])).ToList();
            int i = 0;
            var end = Goldens.Replay((string)g["stageId"], (uint)(long)g["seed"], (string)g["sect"], commands, s =>
            {
                if (s.Tick % 100 != 0 || i >= trace.Count) return;
                Check.Eq(trace[i].Item2, Canonical.Hash(s), $"{Path.GetFileName(file)} tick {s.Tick}");
                i++;
            });
            Check.Eq((string)g["final"]["hash"], Canonical.Hash(end), Path.GetFileName(file) + " final");
        }
    }

    [Test]
    public static void ActionsGoldenExercisesEveryCommand()
    {
        var all = Goldens.Actions(11)["commands"].Values().SelectMany(v => v).Select(c => (string)c["t"]).ToHashSet();
        foreach (var t in new[] { "merge", "cast", "target", "sell", "pick", "upgrade", "place" }) Check.True(all.Contains(t), "actions golden lacks " + t);
    }

    static int FirstDiff(string a, string b)
    {
        int n = System.Math.Min(a.Length, b.Length);
        for (int i = 0; i < n; i++) if (a[i] != b[i]) return i;
        return n;
    }
}
