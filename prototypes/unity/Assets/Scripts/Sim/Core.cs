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
        public static int Round(double x) => (int)Math.Floor(x + 0.5);
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

    public static class Layouts
    {
        public const int GridW = 11;
        public const int GridH = 18;

        // Mirrors layouts.ts (defend layouts only).
        public static readonly Dictionary<string, Pt[]> Defend = new Dictionary<string, Pt[]>
        {
            ["village-a"] = new[] { new Pt(0, 2), new Pt(8, 2), new Pt(8, 7), new Pt(2, 7), new Pt(2, 12), new Pt(9, 12), new Pt(9, 17) },
            ["village-b"] = new[] { new Pt(5, 0), new Pt(5, 4), new Pt(1, 4), new Pt(1, 9), new Pt(9, 9), new Pt(9, 14), new Pt(4, 14), new Pt(4, 17) },
        };
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
