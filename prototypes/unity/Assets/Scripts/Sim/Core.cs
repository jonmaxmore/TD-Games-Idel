// C# port of packages/sim (rng.ts, path.ts, layouts.ts, wuxing.ts, canonical.ts).
// Must stay bit-for-bit compatible with the TypeScript sim: integer units, same iteration order,
// JS Math.round semantics, uint32 mulberry32. Parity is checked by Assets/Editor/Tests/ParityTests.cs.
using System;
using System.Collections.Generic;
using System.Text;

namespace FiveSects.Sim
{
    public static class Rng
    {
        // mulberry32, identical to rng.ts (JS int32 ops == uint32 wraparound here).
        public static double Next(ref uint state)
        {
            unchecked
            {
                state = state + 0x6D2B79F5u;
                uint t = state;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        public static int RollPct(ref uint state) => (int)Math.Floor(Next(ref state) * 100);
    }

    public static class JsMath
    {
        // JS Math.round: halves round towards +infinity (C# Math.Round defaults to banker's rounding).
        public static int Round(double x) { double f = Math.Floor(x); return (int)(x - f >= 0.5 ? f + 1 : f); }
        // JS Math.floor(a / b) for integers (exact for the non-negative values the sim divides).
        public static int FloorDiv(long a, long b) => (int)Math.Floor((double)a / b);
    }

    public struct Pt
    {
        public int X, Y;
        public Pt(int x, int y) { X = x; Y = y; }
    }

    public static class PathMath
    {
        public const int Tile = 1000;

        public static List<Pt> ToMilli(IList<Pt> path)
        {
            var o = new List<Pt>(path.Count);
            foreach (var p in path) o.Add(new Pt(p.X * Tile + Tile / 2, p.Y * Tile + Tile / 2));
            return o;
        }

        public static int Length(IList<Pt> path)
        {
            int len = 0;
            for (int i = 1; i < path.Count; i++)
                len += Math.Abs(path[i].X - path[i - 1].X) + Math.Abs(path[i].Y - path[i - 1].Y);
            return len;
        }

        public static Pt PointAt(IList<Pt> path, int d)
        {
            int rest = Math.Max(0, d);
            for (int i = 1; i < path.Count; i++)
            {
                var a = path[i - 1]; var b = path[i];
                int seg = Math.Abs(b.X - a.X) + Math.Abs(b.Y - a.Y);
                if (rest <= seg) return new Pt(a.X + Math.Sign(b.X - a.X) * rest, a.Y + Math.Sign(b.Y - a.Y) * rest);
                rest -= seg;
            }
            return path[path.Count - 1];
        }

        public static bool Within(int ax, int ay, int bx, int by, int r)
        {
            long dx = ax - bx, dy = ay - by;
            return dx * dx + dy * dy <= (long)r * r;
        }

        public static HashSet<string> TilesOnPath(IList<Pt> path)
        {
            var o = new HashSet<string>();
            for (int i = 1; i < path.Count; i++)
            {
                var a = path[i - 1]; var b = path[i];
                int sx = Math.Sign(b.X - a.X), sy = Math.Sign(b.Y - a.Y);
                for (int x = a.X, y = a.Y; ; x += sx, y += sy)
                {
                    o.Add(x + "," + y);
                    if (x == b.X && y == b.Y) break;
                }
            }
            return o;
        }
    }

    public class Prop { public string Type; public Pt At; }

    public class MapLayout
    {
        public string Kind, Biome, NameTh, GoalGate;
        public Pt[] Path = new Pt[0];   // defend layouts only (assault is not ported)
        public List<Prop> Props = new List<Prop>();
    }

    public class BiomeDef { public string NameTh, Time, Palette, MoodTh, MechanicTh, SpawnGate, GoalGate; }

    // Mirrors layouts.ts: map data from docs/data/maps.json, 'mirror' variant flips x.
    public static class Layouts
    {
        public static int GridW = 11, GridH = 18;
        public static readonly Dictionary<string, MapLayout> All = new Dictionary<string, MapLayout>();
        public static readonly Dictionary<string, BiomeDef> Biomes = new Dictionary<string, BiomeDef>();
        public static readonly Dictionary<string, bool> PropBlocks = new Dictionary<string, bool>();

        static Pt P(Newtonsoft.Json.Linq.JToken t) => new Pt((int)t[0], (int)t[1]);

        public static void Load(Newtonsoft.Json.Linq.JObject maps)
        {
            All.Clear(); Biomes.Clear(); PropBlocks.Clear();
            GridW = (int)maps["grid"][0]; GridH = (int)maps["grid"][1];
            foreach (var p in (Newtonsoft.Json.Linq.JObject)maps["propTypes"]) PropBlocks[p.Key] = (bool)p.Value["block"];
            foreach (var b in (Newtonsoft.Json.Linq.JObject)maps["biomes"])
                Biomes[b.Key] = new BiomeDef
                {
                    NameTh = (string)b.Value["nameTh"], Time = (string)b.Value["time"], Palette = (string)b.Value["palette"],
                    MoodTh = (string)b.Value["moodTh"], MechanicTh = (string)b.Value["mechanicTh"],
                    SpawnGate = (string)b.Value["spawnGate"], GoalGate = (string)b.Value["goalGate"],
                };
            foreach (var l in (Newtonsoft.Json.Linq.JObject)maps["layouts"])
            {
                var v = l.Value;
                var m = new MapLayout { Kind = (string)v["kind"], Biome = (string)v["biome"], NameTh = (string)v["nameTh"], GoalGate = (string)v["goalGate"] };
                if (v["path"] != null) { var path = new List<Pt>(); foreach (var t in v["path"]) path.Add(P(t)); m.Path = path.ToArray(); }
                foreach (var pr in v["props"]) m.Props.Add(new Prop { Type = (string)pr["type"], At = P(pr["at"]) });
                All[l.Key] = m;
            }
        }

        public static MapLayout Get(string name, string variant)
        {
            var l = All[name];
            if (variant != "mirror") return l;
            Pt F(Pt p) => new Pt(GridW - 1 - p.X, p.Y);
            var m = new MapLayout { Kind = l.Kind, Biome = l.Biome, NameTh = l.NameTh, GoalGate = l.GoalGate, Path = new Pt[l.Path.Length] };
            for (int i = 0; i < l.Path.Length; i++) m.Path[i] = F(l.Path[i]);
            foreach (var p in l.Props) m.Props.Add(new Prop { Type = p.Type, At = F(p.At) });
            return m;
        }

        public static HashSet<string> Blocked(MapLayout l)
        {
            var o = new HashSet<string>();
            foreach (var p in l.Props) if (PropBlocks.TryGetValue(p.Type, out var b) && b) o.Add(p.At.X + "," + p.At.Y);
            return o;
        }
    }

    public static class Wuxing
    {
        public static int OvercomePct(IList<string> attacker, string target)
        {
            int best = 0;
            foreach (var a in attacker)
            {
                int pct = 100;
                if (a != "yinyang" && target != "yinyang")
                {
                    if (GameData.Overcomes[a] == target) pct = 150;
                    else if (GameData.Overcomes[target] == a) pct = 70;
                }
                if (pct > best) best = pct;
            }
            return best;
        }

        public static bool IsGenerated(IList<string> own, IEnumerable<IList<string>> neighbours)
        {
            foreach (var n in neighbours)
                foreach (var ne in n)
                    foreach (var oe in own)
                        if (ne != "yinyang" && GameData.Generates[ne] == oe) return true;
            return false;
        }
    }

    public static class Canonical
    {
        // Same layout as canonical.ts.
        public static string String(DefendState s)
        {
            var sb = new StringBuilder();
            sb.Append(s.Tick).Append('|').Append(s.Silver).Append('|').Append(s.Lives).Append('|').Append(s.Wave)
              .Append('|').Append(s.Phase).Append('|').Append(s.Rng).Append('|');
            foreach (var d in s.Disciples) sb.Append('d').Append(d.Id).Append(',').Append(d.Level).Append(',').Append(d.Cd).Append(',').Append(d.Hits).Append(';');
            sb.Append('|');
            foreach (var e in s.Enemies)
                sb.Append('e').Append(e.Id).Append(',').Append(e.Type).Append(',').Append(e.Hp).Append(',').Append(e.D).Append(',')
                  .Append(e.Elite ?? "-").Append(',').Append(e.StunT).Append(',').Append(e.SlowT).Append(',').Append(e.BurnT).Append(',').Append(e.Poison).Append(';');
            sb.Append('|').Append(string.Join(",", s.Cards));
            return sb.ToString();
        }

        public static string Fnv1a(string str)
        {
            unchecked
            {
                uint h = 0x811C9DC5u;
                foreach (char c in str) { h ^= c; h *= 0x01000193u; }
                return h.ToString("x8");
            }
        }

        public static string Hash(DefendState s) => Fnv1a(String(s));
    }
}
