// Procedural pixel art, ported from packages/client/src/art.ts (same 12x16 template and palettes).
using System.Collections.Generic;
using UnityEngine;

namespace FiveSects.Game
{
    public static class Art
    {
        static readonly string[] Body =
        {
            "....oooo....", "...ohhhho...", "..ohhhhhho..", "..ohssssho..", "..osesseso..", "..oossssoo..",
            "...occcco...", "..occaacco..", ".occcaaccco.", ".ocdccccdco.", ".ocdccccdco.", "..occaacco..",
            "..occcccco..", "..oddddddo..", "..odo..odo..", "..oo....oo..",
        };
        const string Out = "#1A1423", Skin = "#F2C9A0", Gold = "#E3B04B";

        class Look { public string Robe, Dark, Hair, Accent, Weapon; }

        static readonly Dictionary<string, Look> SectLook = new Dictionary<string, Look>
        {
            ["metal"] = new Look { Robe = "#D9E1EA", Dark = "#8C99A8", Hair = "#2A2030", Accent = "#8C99A8", Weapon = "sword" },
            ["wood"] = new Look { Robe = "#5BC46A", Dark = "#2E7A3C", Hair = "#1E3A22", Accent = "#2E7A3C", Weapon = "flute" },
            ["water"] = new Look { Robe = "#4FB3FF", Dark = "#22609C", Hair = "#DDE8F5", Accent = "#22609C", Weapon = "palm" },
            ["fire"] = new Look { Robe = "#FF5A1F", Dark = "#A02A10", Hair = "#3A1210", Accent = "#A02A10", Weapon = "fan" },
            ["earth"] = new Look { Robe = "#D98A2B", Dark = "#8A4F18", Hair = null, Accent = Gold, Weapon = "staff" },
            ["yinyang"] = new Look { Robe = "#F2F2F2", Dark = "#3A3442", Hair = "#1A1423", Accent = "#1A1423", Weapon = "taiji" },
        };

        static readonly Dictionary<string, Look> EnemyLook = new Dictionary<string, Look>
        {
            ["cultist"] = new Look { Robe = "#5A1820", Dark = "#2A0A10", Hair = "#120A10", Accent = "#D2412F" },
            ["runner"] = new Look { Robe = "#3E5A2A", Dark = "#1E2E14", Hair = "#120A10", Accent = "#D2412F" },
            ["brute"] = new Look { Robe = "#6E6A78", Dark = "#3A3642", Hair = "#120A10", Accent = "#D2412F" },
            ["leaper"] = new Look { Robe = "#2E4A3A", Dark = "#16261C", Hair = "#120A10", Accent = "#9BD17A" },
            ["healer"] = new Look { Robe = "#8A2A1A", Dark = "#4A140C", Hair = null, Accent = Gold },
        };

        static readonly Dictionary<string, Sprite> Cache = new Dictionary<string, Sprite>();

        public static Color Hex(string hex) { ColorUtility.TryParseHtmlString(hex, out var c); return c; }

        // Texture rows are bottom-up in Unity, the template is top-down.
        static void Px(Texture2D t, int x, int y, string hex) { if (x >= 0 && x < t.width && y >= 0 && y < t.height) t.SetPixel(x, t.height - 1 - y, Hex(hex)); }

        static Texture2D NewTex(int w, int h)
        {
            var t = new Texture2D(w, h, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp };
            var clear = new Color32[w * h];
            t.SetPixels32(clear);
            return t;
        }

        static Sprite Figure(string key, Look look)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;
            var t = NewTex(12, 16);
            for (int y = 0; y < Body.Length; y++)
                for (int x = 0; x < Body[y].Length; x++)
                {
                    char ch = Body[y][x];
                    string c = ch switch
                    {
                        'o' => Out, 'e' => Out, 's' => Skin, 'h' => look.Hair ?? Skin, 'c' => look.Robe, 'd' => look.Dark, 'a' => look.Accent, _ => null,
                    };
                    if (c != null) Px(t, x, y, c);
                }
            switch (look.Weapon)
            {
                case "sword": for (int y = 1; y <= 7; y++) Px(t, 11, y, "#EEF3F8"); Px(t, 10, 8, Gold); Px(t, 11, 8, Gold); Px(t, 11, 9, Gold); break;
                case "flute": for (int x = 0; x <= 3; x++) Px(t, x, 8, "#9BD17A"); break;
                case "palm": Px(t, 0, 8, Skin); Px(t, 0, 9, Skin); Px(t, 11, 8, Skin); Px(t, 11, 9, Skin); break;
                case "fan": Px(t, 0, 6, "#FFB347"); Px(t, 1, 6, "#FFB347"); Px(t, 0, 7, "#FFB347"); Px(t, 1, 7, "#FFB347"); Px(t, 2, 7, "#FFB347"); break;
                case "staff": for (int y = 1; y < 16; y++) Px(t, 0, y, "#8A5A2B"); break;
                case "taiji": Px(t, 10, 0, "#F2F2F2"); Px(t, 11, 0, "#5A5266"); break;
            }
            t.Apply();
            var s = Sprite.Create(t, new Rect(0, 0, 12, 16), new Vector2(0.5f, 0.5f), 1f);
            Cache[key] = s;
            return s;
        }

        public static Sprite Disciple(IList<string> els)
        {
            var look = SectLook[els[0]];
            if (els.Count > 1) look = new Look { Robe = look.Robe, Dark = look.Dark, Hair = look.Hair, Weapon = look.Weapon, Accent = SectLook[els[1]].Robe };
            return Figure("d-" + string.Join("-", els), look);
        }

        public static Sprite Enemy(string type) => Figure("e-" + type, EnemyLook.TryGetValue(type, out var l) ? l : EnemyLook["cultist"]);

        public static Sprite Pixel()
        {
            if (Cache.TryGetValue("px", out var s)) return s;
            var t = NewTex(1, 1);
            t.SetPixel(0, 0, Color.white);
            t.Apply();
            return Cache["px"] = Sprite.Create(t, new Rect(0, 0, 1, 1), new Vector2(0.5f, 0.5f), 1f);
        }

        // Ground in the biome palette (effects.json render.palette env-*): base, 2 speckle shades, path, pebble.
        public static Sprite Ground(int cols, int rows, HashSet<string> pathTiles, IList<string> pal, int tile = 16)
        {
            int w = cols * tile, h = rows * tile;
            var t = NewTex(w, h);
            var px = new Color32[w * h];
            Color32 grass = Hex(pal[0]), sp1 = Hex(pal[1]), sp2 = Hex(pal[2]), path = Hex(pal[3]), peb = Hex(pal[4]);
            for (int i = 0; i < px.Length; i++) px[i] = grass;
            void Set(int x, int y, Color32 c) { if (x >= 0 && x < w && y >= 0 && y < h) px[(h - 1 - y) * w + x] = c; }
            for (int i = 0; i < cols * rows * 3; i++) { int x = (i * 53) % w, y = (i * 97) % h; Set(x, y, i % 3 != 0 ? sp1 : sp2); Set(x + 1, y, i % 3 != 0 ? sp1 : sp2); }
            for (int ty = 0; ty < rows; ty++)
                for (int tx = 0; tx < cols; tx++)
                    if (pathTiles.Contains(tx + "," + ty))
                    {
                        for (int y = 0; y < tile; y++) for (int x = 0; x < tile; x++) Set(tx * tile + x, ty * tile + y, path);
                        // darker 1px rim where the path meets grass reads as a worn trail
                        if (!pathTiles.Contains(tx + "," + (ty - 1))) for (int x = 0; x < tile; x++) Set(tx * tile + x, ty * tile, peb);
                        if (!pathTiles.Contains(tx + "," + (ty + 1))) for (int x = 0; x < tile; x++) Set(tx * tile + x, ty * tile + tile - 1, peb);
                        if (!pathTiles.Contains((tx - 1) + "," + ty)) for (int y = 0; y < tile; y++) Set(tx * tile, ty * tile + y, peb);
                        if (!pathTiles.Contains((tx + 1) + "," + ty)) for (int y = 0; y < tile; y++) Set(tx * tile + tile - 1, ty * tile + y, peb);
                        Set(tx * tile + (tx * 7 + ty * 3) % 12 + 2, ty * tile + (tx * 5 + ty * 11) % 12 + 2, peb);
                        Set(tx * tile + (tx * 13 + ty * 5) % 10 + 3, ty * tile + (tx * 3 + ty * 7) % 10 + 4, peb);
                    }
            t.SetPixels32(px);
            t.Apply();
            return Sprite.Create(t, new Rect(0, 0, w, h), new Vector2(0, 1), 1f);
        }

        // ---------- props and gates: tiny procedural placeholders until the tileset from docs/art arrives ----------

        class PixelCanvas
        {
            public readonly int W, H; public readonly Color32[] Px;
            public PixelCanvas(int w, int h) { W = w; H = h; Px = new Color32[w * h]; }
            public void Set(int x, int y, string c) { if (x >= 0 && x < W && y >= 0 && y < H) Px[(H - 1 - y) * W + x] = Hex(c); }
            public void Rect(int x, int y, int w, int h, string c) { for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) Set(i, j, c); }
            public void Disc(int cx, int cy, int r, string c) { for (int j = -r; j <= r; j++) for (int i = -r; i <= r; i++) if (i * i + j * j <= r * r + r) Set(cx + i, cy + j, c); }
            public Sprite ToSprite(string key)
            {
                var t = NewTex(W, H); t.SetPixels32(Px); t.Apply();
                return Cache[key] = Sprite.Create(t, new Rect(0, 0, W, H), new Vector2(0.5f, 0f), 1f); // pivot: bottom centre
            }
        }

        public static Sprite Prop(string type)
        {
            if (Cache.TryGetValue("p-" + type, out var cached)) return cached;
            var c = new PixelCanvas(16, 20);
            switch (type)
            {
                case "house":
                    c.Rect(2, 9, 12, 9, "#C9A27A"); c.Rect(2, 17, 12, 1, "#7A5A3A"); c.Rect(4, 11, 2, 2, "#FFE08A"); c.Rect(10, 11, 2, 2, "#FFE08A"); c.Rect(7, 13, 2, 5, "#4A2E1E");
                    for (int i = 0; i < 6; i++) c.Rect(1 + i, 8 - i, 14 - 2 * i, 1, i == 0 ? Out : "#5A1E28");
                    break;
                case "tree":
                    c.Rect(7, 13, 2, 6, "#4A2E1E"); c.Disc(8, 9, 6, "#173F1D"); c.Disc(7, 8, 4, "#225F2B"); c.Disc(6, 6, 2, "#2F833B"); break;
                case "shrine":
                    c.Rect(3, 8, 2, 11, "#D2412F"); c.Rect(11, 8, 2, 11, "#D2412F"); c.Rect(1, 6, 14, 2, Out); c.Rect(2, 5, 12, 1, "#E3B04B"); c.Rect(6, 10, 4, 3, "#E3B04B"); break;
                case "rock": c.Disc(8, 15, 5, "#4A4048"); c.Disc(7, 14, 3, "#6E6A78"); c.Set(6, 12, "#9A92AE"); break;
                case "bamboo":
                    foreach (var x in new[] { 4, 8, 12 }) { c.Rect(x, 2 + x % 3, 2, 17 - x % 3, "#4E8A5A"); for (int y = 6; y < 19; y += 5) c.Rect(x, y, 2, 1, "#2A5A3E"); c.Rect(x + 2, 3 + x % 4, 2, 1, "#9FC7B4"); }
                    break;
                case "ice": c.Disc(8, 14, 5, "#8EC3E8"); c.Rect(6, 7, 4, 8, "#C9E6F7"); c.Set(7, 8, "#FFFFFF"); c.Set(7, 9, "#FFFFFF"); break;
                case "stall":
                    c.Rect(2, 12, 12, 7, "#7A2A1E"); c.Rect(3, 13, 10, 2, "#F2A23A");
                    for (int i = 0; i < 12; i++) c.Rect(2 + i, 8, 1, 3, i % 2 == 0 ? "#D2412F" : "#ECE3CF");
                    break;
                case "ruin": c.Rect(3, 9, 3, 10, "#4A4048"); c.Rect(10, 12, 3, 7, "#4A4048"); c.Rect(3, 8, 4, 1, "#6E6A78"); c.Rect(8, 17, 5, 2, "#3A1622"); break;
                case "lantern": c.Rect(7, 12, 1, 7, "#4A2E1E"); c.Disc(8, 10, 3, "#D2412F"); c.Rect(7, 9, 2, 2, "#FFE08A"); break;
                case "roof":
                    for (int y = 6; y < 19; y += 3) c.Rect(0, y, 16, 2, y % 2 == 0 ? "#5A1E28" : "#7A2A2A");
                    c.Rect(0, 5, 16, 1, Out); break;
                case "rice": for (int y = 9; y < 19; y += 3) for (int x = 1; x < 16; x += 3) { c.Set(x, y, "#5BC46A"); c.Set(x, y - 1, "#9FDCA7"); } break;
                case "flag": c.Rect(4, 4, 1, 15, "#4A2E1E"); c.Rect(5, 4, 7, 5, "#D2412F"); c.Set(8, 6, "#E3B04B"); break;
                default: c.Disc(8, 14, 4, "#6E6A78"); break;
            }
            return c.ToSprite("p-" + type);
        }

        // Build pad: dotted ring (12 dots, radius 6) on a 16x16 tile, tinted and pulsed by DefendView.
        public static Sprite Slot()
        {
            if (Cache.TryGetValue("slot", out var cached)) return cached;
            var c = new PixelCanvas(16, 16);
            for (int i = 0; i < 12; i++)
            {
                float a = i / 12f * Mathf.PI * 2;
                c.Set(Mathf.RoundToInt(7.5f + 6 * Mathf.Cos(a)), Mathf.RoundToInt(7.5f + 6 * Mathf.Sin(a)), "#FFFFFF");
            }
            var t = NewTex(16, 16); t.SetPixels32(c.Px); t.Apply();
            return Cache["slot"] = Sprite.Create(t, new Rect(0, 0, 16, 16), new Vector2(0.5f, 0.5f), 1f);
        }

        // Spawn gates are dark openings on the board edge; goal gates are the sect's paifang arch the enemies must not pass.
        public static Sprite Gate(string type, bool goal)
        {
            string key = "g-" + type + goal;
            if (Cache.TryGetValue(key, out var cached)) return cached;
            var c = new PixelCanvas(24, 26);
            if (goal)
            {
                string pillar = type == "jade-gate" ? "#7FE0D0" : type == "bandit-camp" ? "#5A3A24" : "#D2412F";
                c.Rect(3, 8, 3, 18, pillar); c.Rect(18, 8, 3, 18, pillar);
                c.Rect(0, 4, 24, 3, Out); c.Rect(1, 3, 22, 1, "#E3B04B"); c.Rect(2, 9, 20, 2, Out);
                c.Rect(8, 5, 8, 3, "#E3B04B"); c.Rect(10, 6, 4, 1, Out);
                if (type == "bandit-camp") for (int x = 7; x < 18; x += 2) c.Rect(x, 14, 1, 12, "#5A3A24");
            }
            else
            {
                bool portal = type == "demon-portal";
                c.Disc(12, 16, 10, portal ? "#5A1E28" : "#4A4048");
                c.Disc(12, 18, 7, portal ? "#D2412F" : "#120A10");
                c.Disc(12, 19, 5, portal ? "#24101A" : "#0A0610");
                c.Rect(0, 24, 24, 2, portal ? "#3A1622" : "#3A3442");
            }
            return c.ToSprite(key);
        }
    }
}
