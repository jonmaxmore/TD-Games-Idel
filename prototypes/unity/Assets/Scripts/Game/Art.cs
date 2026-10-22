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

        // Ground: grass with deterministic speckles, path tiles with pebbles (same pattern as art.ts).
        public static Sprite Ground(int cols, int rows, HashSet<string> pathTiles, int tile = 16)
        {
            int w = cols * tile, h = rows * tile;
            var t = NewTex(w, h);
            var px = new Color32[w * h];
            Color32 grass = Hex("#16201A"), sp1 = Hex("#1E2B22"), sp2 = Hex("#24352A"), path = Hex("#3B2C2A"), peb = Hex("#4A3833");
            for (int i = 0; i < px.Length; i++) px[i] = grass;
            void Set(int x, int y, Color32 c) { if (x >= 0 && x < w && y >= 0 && y < h) px[(h - 1 - y) * w + x] = c; }
            for (int i = 0; i < cols * rows * 3; i++) { int x = (i * 53) % w, y = (i * 97) % h; Set(x, y, i % 3 != 0 ? sp1 : sp2); Set(x + 1, y, i % 3 != 0 ? sp1 : sp2); }
            for (int ty = 0; ty < rows; ty++)
                for (int tx = 0; tx < cols; tx++)
                    if (pathTiles.Contains(tx + "," + ty))
                    {
                        for (int y = 0; y < tile; y++) for (int x = 0; x < tile; x++) Set(tx * tile + x, ty * tile + y, path);
                        Set(tx * tile + (tx * 7 + ty * 3) % 12 + 2, ty * tile + (tx * 5 + ty * 11) % 12 + 2, peb);
                        Set(tx * tile + (tx * 13 + ty * 5) % 10 + 3, ty * tile + (tx * 3 + ty * 7) % 10 + 4, peb);
                    }
            t.SetPixels32(px);
            t.Apply();
            return Sprite.Create(t, new Rect(0, 0, w, h), new Vector2(0, 1), 1f);
        }
    }
}
