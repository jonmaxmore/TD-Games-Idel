// Runs the TypeScript golden replays (npm run sim:golden) through the C# port and requires the same
// canonical hash every 100 ticks. If this fails, the C# rules drifted from packages/sim.
using System.Collections.Generic;
using System.IO;
using FiveSects.Sim;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace FiveSects.Tests
{
    public class ParityTests
    {
        [OneTimeSetUp]
        public void LoadData() =>
            GameData.Load(name => File.ReadAllText(Path.Combine(Application.dataPath, "Resources", "data", name + ".json")));

        [TestCase("1-1")]
        [TestCase("T-1")]
        public void MatchesTypeScriptGolden(string stage)
        {
            var g = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "Editor", "Tests", "golden-" + stage + ".json")));
            var s = Defend.Create(stage, (uint)(long)g["seed"]);
            var commands = (JObject)g["commands"];
            var trace = (JArray)g["trace"];
            int ti = 0;
            while (!s.IsOver && s.Tick < 20 * 60 * 30)
            {
                var list = new List<Command>();
                var tok = commands[s.Tick.ToString()];
                if (tok != null) foreach (var c in tok) list.Add(ToCommand(c));
                Defend.Step(s, list);
                if (s.Tick % 100 == 0 && ti < trace.Count)
                {
                    var expected = trace[ti++];
                    Assert.AreEqual((int)expected[0], s.Tick, "trace tick");
                    Assert.AreEqual((string)expected[1], Canonical.Hash(s), "diverged at tick " + s.Tick + ": " + Canonical.String(s));
                }
            }
            var f = g["final"];
            Assert.AreEqual((string)f["phase"], s.Phase);
            Assert.AreEqual((string)f["hash"], Canonical.Hash(s), "C#: " + Canonical.String(s) + "\nTS: " + (string)f["canonical"]);
        }

        [Test]
        public void HashLayoutMatchesTypeScript()
        {
            Assert.AreEqual("1a47e90b", Canonical.Fnv1a("abc"));
            Assert.AreEqual("0|120|20|0|build|1|||", Canonical.String(Defend.Create("1-1", 1)));
        }

        static Command ToCommand(JToken c) => new Command
        {
            T = (string)c["t"], Sect = (string)c["sect"], Art = (string)c["art"], Card = (string)c["card"], Mode = (string)c["mode"],
            Tx = (int?)c["tx"] ?? 0, Ty = (int?)c["ty"] ?? 0, Id = (int?)c["id"] ?? 0, A = (int?)c["a"] ?? 0, B = (int?)c["b"] ?? 0,
        };
    }
}
