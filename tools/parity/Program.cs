// Replays every golden-*.json (written by `npm run sim:golden` from the TypeScript sim) through the C# port and
// compares the canonical hash every 100 ticks and at the end. Exit code = number of mismatching goldens.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using FiveSects.Sim;
using Newtonsoft.Json.Linq;

static class Program
{
    static int Main(string[] args)
    {
        string root = args.Length > 0 ? args[0] : FindRoot();
        string assets = Path.Combine(root, "prototypes", "unity", "Assets");
        GameData.Load(n => File.ReadAllText(Path.Combine(assets, "Resources", "data", n + ".json")));
        int fails = 0;
        foreach (var file in Directory.GetFiles(Path.Combine(assets, "Editor", "Tests"), "golden-*.json").OrderBy(f => f, StringComparer.Ordinal))
        {
            var g = JObject.Parse(File.ReadAllText(file));
            var s = Defend.Create((string)g["stageId"], (uint)(long)g["seed"]);
            var commands = (JObject)g["commands"];
            var trace = (JArray)g["trace"];
            int ti = 0;
            string diverged = null;
            while (!s.IsOver && s.Tick < 20 * 60 * 30)
            {
                var list = new List<Command>();
                var tok = commands[s.Tick.ToString()];
                if (tok != null)
                    foreach (var c in tok)
                        list.Add(new Command
                        {
                            T = (string)c["t"], Sect = (string)c["sect"], Art = (string)c["art"], Card = (string)c["card"], Mode = (string)c["mode"],
                            Tx = (int?)c["tx"] ?? 0, Ty = (int?)c["ty"] ?? 0, Id = (int?)c["id"] ?? 0, A = (int?)c["a"] ?? 0, B = (int?)c["b"] ?? 0,
                        });
                Defend.Step(s, list);
                if (s.Tick % 100 == 0 && ti < trace.Count && diverged == null)
                    if ((string)trace[ti++][1] != Canonical.Hash(s)) diverged = "tick " + s.Tick + ": " + Canonical.String(s);
            }
            bool ok = diverged == null && (string)g["final"]["hash"] == Canonical.Hash(s);
            Console.WriteLine((ok ? "ok   " : "FAIL ") + Path.GetFileName(file) + "  " + s.Phase + " tick " + s.Tick + " hash " + Canonical.Hash(s));
            if (!ok)
            {
                fails++;
                Console.WriteLine("  C#: " + (diverged ?? Canonical.String(s)));
                Console.WriteLine("  TS: " + (string)g["final"]["canonical"]);
            }
        }
        return fails;
    }

    static string FindRoot()
    {
        var d = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (d != null && !File.Exists(Path.Combine(d.FullName, "CLAUDE.md"))) d = d.Parent;
        return d?.FullName ?? throw new Exception("run from inside the repo");
    }
}
