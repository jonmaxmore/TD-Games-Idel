// C# port of packages/sim/src/data.ts. Loads the same docs/data JSON (copied into
// Assets/Resources/data by sync-data.mjs) and converts to integer sim units.
using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace FiveSects.Sim
{
    public class SectDef { public string Element, NameTh, NameEn, Color, Role; public int Cost, Dmg, Cooldown, Range; public bool HitsAir, HitsGround; }
    public class BossMechanics { public string Effect; public List<int> PhasesPct = new List<int>(); public int Count = 1, Ticks; }
    public class EnemyDef { public string Id, NameTh, NameEn, Element, TraitTh, TraitEn; public bool Air; public int Hp, Speed, Bounty, LeakCost = 1; public BossMechanics Boss; }
    public class WaveRecipe { public string Id, NameTh; public List<string> Types = new List<string>(), NeedsRoles = new List<string>(); public int CountPct, HpPct; }
    public class RoleDef { public string Id, NameTh, NameEn, DoesTh; public List<string> Counters = new List<string>(); }
    public class ComboDef { public string Id, NameTh, A, B; }
    public class StageDef
    {
        public string Id, Type, Layout, Variant, UnlocksSect; public int Chapter; public int? Waves, StartSilver; public bool UnlockAll;
        public List<string> Enemies = new List<string>(), Stars = new List<string>(), GuestSects = new List<string>();
        public Dictionary<string, string> ScriptedWaves = new Dictionary<string, string>();
        public List<string> WavePool;
    }
    public class ArtDef { public string Id, NameTh, Glyph, Type; public int Cooldown, Dmg, Radius, Pct, Duration, Charges, RechargeSilver; }
    public class CardDef { public string Id, NameTh, EffectTh, Kind, Element, Needs; public int Pct, Value; }
    // Sect the player joins after the tutorial (sects.json > allegiance); front flow only, no rules use it yet.
    // Sect x role disciple (sects.json > roster): fights with its kit's mechanic (Element), counts as its Sect for Wu Xing.
    public class UnitDef : SectDef { public string Id, Sect, RoleId, Dot, DescTh, DescEn; }
    public class AllegianceDef { public string Element, RuleTh; public int Difficulty; }
    public class UpcomingSectDef { public string Id, NameTh, NameEn; public int OpensMonth; }
    public class EliteAffix { public string Id, NameTh; public int HpPct, SpeedPct, RegenPct; }

    public static class GameData
    {
        public const int TickHz = 20;
        public const int Tile = 1000;
        public static int Ticks(double sec) => JsMath.Round(sec * TickHz);

        public static readonly Dictionary<string, SectDef> Sects = new Dictionary<string, SectDef>();
        public static readonly List<string> SectOrder = new List<string>();
        public static readonly List<AllegianceDef> Allegiance = new List<AllegianceDef>();
        public static readonly Dictionary<string, UnitDef> Units = new Dictionary<string, UnitDef>();
        public static readonly List<UnitDef> UnitList = new List<UnitDef>();
        public static readonly List<string> Roles = new List<string>();
        public static readonly Dictionary<string, RoleDef> RoleDefs = new Dictionary<string, RoleDef>();
        public static readonly List<KeyValuePair<string, List<string>>> RoleUnlocks = new List<KeyValuePair<string, List<string>>>();
        public static readonly List<string> RosterSects = new List<string>();
        public static int FireRampPctPerSec, FireRampMaxPct, WoodSpreadRange, WoodSpreadStacks;
        public static SectDef DefOf(string key) => Units.TryGetValue(key, out var u) ? u : Sects[key];
        public static readonly List<UpcomingSectDef> UpcomingSects = new List<UpcomingSectDef>();
        public static readonly Dictionary<string, string> Generates = new Dictionary<string, string>();
        public static readonly Dictionary<string, string> Overcomes = new Dictionary<string, string>();
        public static readonly List<ComboDef> Combos = new List<ComboDef>();
        public static int UpgradeLevels;
        public static List<string> UpgradeNames = new List<string>();
        public static List<int> CostPct = new List<int>(), StatPct = new List<int>();
        public static readonly Dictionary<string, EnemyDef> Enemies = new Dictionary<string, EnemyDef>();
        public static readonly List<StageDef> StageList = new List<StageDef>();
        public static readonly Dictionary<string, StageDef> Stages = new Dictionary<string, StageDef>();
        public static int StartLives, InterestPct, InterestCap, SellRefundPct, WaveBreak, SpawnInterval, EarlyCallBonus, BountyGrowthPct;
        public static readonly List<ArtDef> Arts = new List<ArtDef>();
        public static readonly List<CardDef> Cards = new List<CardDef>();
        public static int EliteFromWave, EliteChancePct, EliteBountyMult;
        public static readonly List<EliteAffix> Elites = new List<EliteAffix>();
        public static readonly List<WaveRecipe> WaveRecipes = new List<WaveRecipe>();
        public static int MergeFee, ComboDmgPct, InterestCapPerWave, EarlyCallPct;
        public static readonly Dictionary<string, List<string>> Palette = new Dictionary<string, List<string>>();
        public const int CardEveryWaves = 5;
        public static int CardAutoPick => Ticks(15);
        public static bool Loaded { get; private set; }

        /// <param name="read">Returns the JSON text of a data file by base name (e.g. "sects").</param>
        public static void Load(Func<string, string> read)
        {
            if (Loaded) return;
            // Start clean so a failed earlier attempt can't leave duplicates behind.
            Sects.Clear(); SectOrder.Clear(); Allegiance.Clear(); UpcomingSects.Clear(); Units.Clear(); UnitList.Clear(); Roles.Clear(); RoleDefs.Clear(); RoleUnlocks.Clear(); RosterSects.Clear(); Generates.Clear(); Overcomes.Clear(); Combos.Clear(); Enemies.Clear();
            StageList.Clear(); Stages.Clear(); Arts.Clear(); Cards.Clear(); Elites.Clear(); Palette.Clear(); WaveRecipes.Clear();
            var sects = JObject.Parse(read("sects"));
            foreach (var s in sects["sects"])
            {
                string el = (string)s["element"];
                string target = (string)s["target"];
                Sects[el] = new SectDef
                {
                    Element = el, NameTh = (string)s["nameTh"], NameEn = (string)s["name"], Color = (string)s["color"], Role = (string)s["role"], Cost = (int)s["cost"], Dmg = (int)s["dmg"],
                    Cooldown = Ticks(1.0 / (double)s["rate"]), Range = JsMath.Round((double)s["range"] * Tile),
                    HitsAir = target.Contains("air"), HitsGround = target.Contains("ground"),
                };
                SectOrder.Add(el);
            }
            if (sects["roster"] != null)
            {
                var ro = sects["roster"];
                foreach (var r in ro["roles"])
                {
                    Roles.Add((string)r["id"]);
                    RoleDefs[(string)r["id"]] = new RoleDef { Id = (string)r["id"], NameTh = (string)r["nameTh"], NameEn = (string)r["nameEn"], DoesTh = (string)r["doesTh"], Counters = r["counters"]?.Select(x => (string)x).ToList() ?? new List<string>() };
                }
                foreach (var p in (JObject)ro["roleUnlocks"]) RoleUnlocks.Add(new KeyValuePair<string, List<string>>(p.Key, p.Value.Select(x => (string)x).ToList()));
                FireRampPctPerSec = (int)ro["rules"]["fire"]["burnRampPctPerSec"];
                FireRampMaxPct = (int)ro["rules"]["fire"]["burnRampMaxPct"];
                WoodSpreadRange = JsMath.Round((double)ro["rules"]["wood"]["spreadRange"] * Tile);
                WoodSpreadStacks = (int)ro["rules"]["wood"]["spreadStacks"];
                foreach (var u in ro["units"])
                {
                    string target = (string)u["target"], sect = (string)u["sect"];
                    var def = new UnitDef
                    {
                        Id = (string)u["id"], Sect = sect, RoleId = (string)u["role"], Dot = (string)u["dot"],
                        DescTh = (string)u["descTh"], DescEn = (string)u["descEn"],
                        Element = (string)u["kit"], NameTh = (string)u["nameTh"], NameEn = (string)u["nameEn"], Color = Sects[sect].Color, Cost = (int)u["cost"], Dmg = (int)u["dmg"],
                        Cooldown = Ticks(1.0 / (double)u["rate"]), Range = JsMath.Round((double)u["range"] * Tile),
                        HitsAir = target.Contains("air"), HitsGround = target.Contains("ground"),
                    };
                    Units[def.Id] = def; UnitList.Add(def);
                    if (!RosterSects.Contains(sect)) RosterSects.Add(sect);
                }
            }
            if (sects["allegiance"] != null)
            {
                foreach (var a in sects["allegiance"]["launch"])
                    Allegiance.Add(new AllegianceDef { Element = (string)a["element"], RuleTh = (string)a["ruleTh"], Difficulty = (int)a["difficulty"] });
                foreach (var u in sects["allegiance"]["upcoming"])
                    UpcomingSects.Add(new UpcomingSectDef { Id = (string)u["id"], NameTh = (string)u["nameTh"], NameEn = (string)u["nameEn"], OpensMonth = (int)u["opensMonth"] });
            }
            foreach (var p in (JObject)sects["wuxing"]["generates"]) Generates[p.Key] = (string)p.Value;
            foreach (var p in (JObject)sects["wuxing"]["overcomes"]) Overcomes[p.Key] = (string)p.Value;
            foreach (var c in sects["comboTechniques"]["items"])
                Combos.Add(new ComboDef { Id = (string)c["id"], NameTh = (string)c["nameTh"], A = (string)c["from"][0], B = (string)c["from"][1] });
            var up = sects["upgrade"];
            MergeFee = (int)sects["comboTechniques"]["mergeFee"];
            ComboDmgPct = (int)sects["comboTechniques"]["comboDmgPct"];
            UpgradeLevels = (int)up["levels"];
            UpgradeNames = up["names"].Select(x => (string)x).ToList();
            CostPct = up["costMultiplier"].Select(x => JsMath.Round((double)x * 100)).ToList();
            StatPct = up["statMultiplier"].Select(x => JsMath.Round((double)x * 100)).ToList();

            var enemies = JObject.Parse(read("enemies"));
            foreach (var e in enemies["enemies"].Concat(enemies["bosses"]))
            {
                string id = (string)e["id"];
                Enemies[id] = new EnemyDef
                {
                    Id = id, NameTh = (string)e["nameTh"], NameEn = (string)e["name"], TraitEn = (string)e["trait"], Element = (string)e["element"],
                    Air = (string)e["layer"] == "air", Hp = (int)e["hp"],
                    Speed = JsMath.Round(((double)e["speed"] * Tile) / TickHz),
                    Bounty = e["bounty"] != null ? (int)e["bounty"] : 50,
                    TraitTh = (string)e["traitTh"] ?? "",
                    LeakCost = e["leakCost"] != null ? (int)e["leakCost"] : 1,
                };
                var mech = e["mechanics"];
                if (mech != null)
                    Enemies[id].Boss = new BossMechanics
                    {
                        Effect = (string)mech["effect"], PhasesPct = mech["phasesPct"].Select(x => (int)x).ToList(),
                        Count = mech["count"] != null ? (int)mech["count"] : 1, Ticks = Ticks(mech["sec"] != null ? (double)mech["sec"] : 0),
                    };
            }
            foreach (var w in (JObject)enemies["waveRecipes"])
            {
                if (w.Key.StartsWith("_")) continue;
                WaveRecipes.Add(new WaveRecipe
                {
                    Id = w.Key, NameTh = (string)w.Value["nameTh"], Types = w.Value["types"].Select(x => (string)x).ToList(),
                    CountPct = (int)w.Value["countPct"], HpPct = (int)w.Value["hpPct"],
                    NeedsRoles = w.Value["needsRoles"]?.Select(x => (string)x).ToList() ?? new List<string>(),
                });
            }
            var el2 = enemies["elites"];
            EliteFromWave = (int)el2["eliteFromWave"]; EliteChancePct = (int)el2["eliteChancePct"]; EliteBountyMult = (int)el2["bountyMult"];
            foreach (var a in el2["affixes"])
                Elites.Add(new EliteAffix { Id = (string)a["id"], NameTh = (string)a["nameTh"], HpPct = (int)a["hpPct"], SpeedPct = (int)a["speedPct"], RegenPct = (int)a["regenPctPerSec"] });

            var stages = JObject.Parse(read("stages"));
            foreach (var s in stages["stages"])
            {
                var st = new StageDef
                {
                    Id = (string)s["id"], Type = (string)s["type"], Layout = (string)s["layout"], Variant = (string)s["variant"], UnlocksSect = (string)s["unlocksSect"],
                    Chapter = (int)s["chapter"], Waves = (int?)s["waves"], StartSilver = (int?)s["startSilver"], UnlockAll = (bool?)s["unlockAll"] ?? false,
                };
                if (s["enemies"] != null) st.Enemies = s["enemies"].Select(x => (string)x).ToList();
                if (s["stars"] != null) st.Stars = s["stars"].Select(x => (string)x).ToList();
                if (s["guestSects"] != null) st.GuestSects = s["guestSects"].Select(x => (string)x).ToList();
                if (s["scriptedWaves"] != null) foreach (var p in (JObject)s["scriptedWaves"]) st.ScriptedWaves[p.Key] = (string)p.Value;
                if (s["wavePool"] != null) st.WavePool = s["wavePool"].Select(x => (string)x).ToList();
                StageList.Add(st);
                Stages[st.Id] = st;
            }

            Layouts.Load(JObject.Parse(read("maps")));
            foreach (var g in (JObject)JObject.Parse(read("effects"))["render"]["palette"]) Palette[g.Key] = g.Value.Select(x => (string)x).ToList();

            var inRun = JObject.Parse(read("economy"))["inRun"];
            StartLives = (int)inRun["startLives"]; InterestPct = (int)inRun["interestPct"]; InterestCap = (int)inRun["interestCap"];
            SellRefundPct = (int)inRun["sellRefundPct"]; WaveBreak = Ticks((double)inRun["waveBreakSec"]);
            SpawnInterval = Ticks((double)inRun["spawnIntervalSec"]); EarlyCallBonus = (int)inRun["earlyCallBonusSilver"];
            BountyGrowthPct = (int)inRun["bountyGrowthPctPerWave"];
            InterestCapPerWave = (int)inRun["interestCapPerWave"]; EarlyCallPct = (int)inRun["earlyCallPct"];

            var items = JObject.Parse(read("items"));
            foreach (var a in items["secretArts"]["items"])
                Arts.Add(new ArtDef
                {
                    Id = (string)a["id"], NameTh = (string)a["nameTh"], Glyph = (string)a["glyph"] ?? "", Type = (string)a["effectType"],
                    Cooldown = Ticks((double)a["cooldown"]), Dmg = (int?)a["dmg"] ?? 0, Radius = JsMath.Round(((double?)a["radius"] ?? 0) * Tile),
                    Pct = (int?)a["pct"] ?? 0, Duration = Ticks((double?)a["durationSec"] ?? 0),
                    Charges = (int?)a["charges"] ?? 0, RechargeSilver = (int?)a["rechargeSilver"] ?? 0,
                });
            var m = items["manuals"];
            foreach (var group in new[] { "damage", "economy", "ruleBender" })
                foreach (var c in m[group])
                {
                    string kind = (string)c["kind"];
                    if (kind == "disabled") continue;
                    Cards.Add(new CardDef
                    {
                        Id = (string)c["id"], NameTh = (string)c["nameTh"], EffectTh = (string)c["effectTh"] ?? (string)c["effect"], Kind = kind,
                        Element = (string)c["element"], Needs = (string)c["needs"], Pct = (int?)c["pct"] ?? 0, Value = (int?)c["value"] ?? 0,
                    });
                }
            Loaded = true;
        }

        // HP at wave w (1-based), integer math identical to data.ts waveHp.
        public static int WaveHp(int baseHp, int wave)
        {
            long bp = 10000 + 1800L * wave;
            for (int i = 10; i < wave; i++) bp = (bp * 106) / 100;
            return (int)((baseHp * bp) / 10000);
        }
    }
}
