// Golden replays: a seed plus the commands a player sent, with the canonical hash every 100 ticks and the final
// state. The Unity Test Runner (Assets/Editor/Tests/ParityTests.cs) and GoldenTests below replay them; any rule
// change that alters an outcome shows up as a hash mismatch until the goldens are rewritten on purpose.
// File layout (unchanged from the TypeScript era): { stageId, seed, sect?, commands: {tick: Command[]}, trace: [[tick, hash]], final }
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using FiveSects.Sim;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

static class Goldens
{
    public static readonly string[] TargetModes = { "first", "strong", "weak", "close" };

    public static readonly Dictionary<string, Func<JObject>> All = new Dictionary<string, Func<JObject>>
    {
        ["1-1"] = () => Golden("1-1", 42),
        ["T-1"] = () => Golden("T-1", 7),
        ["T-1-actions"] = () => Actions(11),
        // Chapter finale won by the fire sect: both boss waves (disable at 10, seal at 20), healers, stealth, wave recipes.
        ["1-12-bosses"] = () => Golden("1-12", 1, sect: "fire"),
        // Sect games with waves called mid-fight: fire roster (burn ramp, striker burn, phoenix), wood roster (poison
        // spread, poison through armour). Seeds chosen so both reach and win wave 20 (SPEC-core §4).
        ["fire-1-12"] = () => Golden("1-12", 2, earlyCall: true, sect: "fire"),
        ["wood-1-12"] = () => Golden("1-12", 2, earlyCall: true, sect: "wood"),
    };

    public static JObject Golden(string stageId, uint seed, bool earlyCall = false, string sect = null)
    {
        var commands = new Dictionary<int, List<Command>>();
        Bot.Play(stageId, seed, sect, record: commands, earlyCall: earlyCall);
        return Trace(stageId, seed, sect, commands);
    }

    // Scripted run that exercises the commands the bot never uses: merge, every secret art, every target mode,
    // sell and manual card picks.
    public static JObject Actions(uint seed)
    {
        const string stageId = "T-1";
        var s = Defend.Create(stageId, seed);
        var commands = new Dictionary<int, List<Command>>();
        var script = new Dictionary<int, List<Command>>
        {
            [0] = new List<Command>
            {
                Place("metal", 3, 3), Place("water", 4, 3), Place("fire", 5, 3), Place("earth", 3, 6), new Command { T = "nextWave" },
            },
            [1] = new List<Command> { new Command { T = "upgrade", Id = 1 }, new Command { T = "upgrade", Id = 2 } },
            [2] = new List<Command> { new Command { T = "upgrade", Id = 1 }, new Command { T = "upgrade", Id = 2 } },
            [3] = new List<Command> { new Command { T = "merge", A = 1, B = 2 } },
            [4] = new List<Command> { Place("wood", 6, 3), Place("yinyang", 7, 3) },
        };
        for (int i = 0; i < TargetModes.Length; i++) script[10 + i] = new List<Command> { new Command { T = "target", Id = 3, Mode = TargetModes[i] } };
        for (int i = 0; i < GameData.Arts.Count; i++) script[300 + i * 250] = new List<Command> { new Command { T = "cast", Art = GameData.Arts[i].Id } };
        script[1500] = new List<Command> { new Command { T = "sell", Id = 4 } };
        int picks = 0;
        while (!s.IsOver && s.Tick < 20 * 60 * 30)
        {
            var cmds = script.TryGetValue(s.Tick, out var sc) ? new List<Command>(sc) : new List<Command>();
            if (s.Phase == "picking" && s.Offer != null && picks < 2) { cmds.Add(new Command { T = "pick", Card = s.Offer[s.Offer.Count - 1] }); picks++; }
            if (s.Phase == "break" && s.Wave % 3 == 0) cmds.Add(new Command { T = "nextWave" });
            if (cmds.Count > 0) commands[s.Tick] = cmds;
            Defend.Step(s, cmds);
        }
        return Trace(stageId, seed, null, commands);
    }

    static Command Place(string sect, int tx, int ty) => new Command { T = "place", Sect = sect, Tx = tx, Ty = ty };

    // Replays the commands from a fresh state and records the hash trace, exactly as a server would verify a run.
    public static DefendState Replay(string stageId, uint seed, string sect, IReadOnlyDictionary<int, List<Command>> commands, Action<DefendState> onTick = null)
    {
        var s = Defend.Create(stageId, seed, sect);
        while (!s.IsOver && s.Tick < 20 * 60 * 30)
        {
            Defend.Step(s, commands.TryGetValue(s.Tick, out var c) ? c : new List<Command>());
            onTick?.Invoke(s);
        }
        return s;
    }

    static JObject Trace(string stageId, uint seed, string sect, Dictionary<int, List<Command>> commands)
    {
        var trace = new JArray();
        var end = Replay(stageId, seed, sect, commands, st => { if (st.Tick % 100 == 0) trace.Add(new JArray(st.Tick, Canonical.Hash(st))); });
        var g = new JObject { ["stageId"] = stageId, ["seed"] = seed };
        if (sect != null) g["sect"] = sect;
        var cmds = new JObject();
        foreach (var kv in commands.OrderBy(k => k.Key)) cmds[kv.Key.ToString()] = new JArray(kv.Value.Select(ToJson));
        g["commands"] = cmds;
        g["trace"] = trace;
        g["final"] = new JObject
        {
            ["phase"] = end.Phase, ["wave"] = end.Wave, ["lives"] = end.Lives, ["silver"] = end.Silver, ["tick"] = end.Tick,
            ["hash"] = Canonical.Hash(end), ["canonical"] = Canonical.String(end),
        };
        return g;
    }

    // Only the fields each command uses, in a fixed order, so files stay small and diffable.
    public static JObject ToJson(Command c)
    {
        var o = new JObject { ["t"] = c.T };
        switch (c.T)
        {
            case "place": o["sect"] = c.Sect; o["tx"] = c.Tx; o["ty"] = c.Ty; break;
            case "upgrade": case "sell": o["id"] = c.Id; break;
            case "merge": o["a"] = c.A; o["b"] = c.B; break;
            case "target": o["id"] = c.Id; o["mode"] = c.Mode; break;
            case "cast": o["art"] = c.Art; if (c.Tx != 0 || c.Ty != 0) { o["tx"] = c.Tx; o["ty"] = c.Ty; } break;
            case "pick": o["card"] = c.Card; break;
        }
        return o;
    }

    public static Command FromJson(JToken c) => new Command
    {
        T = (string)c["t"], Sect = (string)c["sect"], Art = (string)c["art"], Card = (string)c["card"], Mode = (string)c["mode"],
        Tx = (int?)c["tx"] ?? 0, Ty = (int?)c["ty"] ?? 0, Id = (int?)c["id"] ?? 0, A = (int?)c["a"] ?? 0, B = (int?)c["b"] ?? 0,
    };

    public static string Path(string name) => System.IO.Path.Combine(Repo.Goldens, $"golden-{name}.json");

    // One-space indentation and \n line ends, matching the files the TypeScript generator wrote.
    public static string Serialize(JObject g)
    {
        var sw = new StringWriter { NewLine = "\n" };
        using (var w = new JsonTextWriter(sw) { Formatting = Formatting.Indented, Indentation = 1, IndentChar = ' ' }) g.WriteTo(w);
        return sw + "\n";
    }

    public static void WriteAll()
    {
        foreach (var kv in All)
        {
            var g = kv.Value();
            File.WriteAllText(Path(kv.Key), Serialize(g));
            Console.WriteLine($"{kv.Key} {g["final"]["phase"]} ticks {g["final"]["tick"]} trace {((JArray)g["trace"]).Count} hash {g["final"]["hash"]}");
        }
    }
}
