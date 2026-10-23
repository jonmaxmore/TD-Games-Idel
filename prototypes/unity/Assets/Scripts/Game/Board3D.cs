// The defend board as a low-poly 3D diorama built from Unity primitives, rendered into a small render texture
// with point filtering so it reads as pixel art with real depth, light and shadow. View only: DefendView
// still runs the sim and the uGUI HUD; this draws the world the sim describes and turns taps into tiles.
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace FiveSects.Game
{
    public class Board3D
    {
        static readonly Vector3 Origin = new Vector3(5000, 0, 0); // far from the 2D world the main camera draws
        const int PixelHeight = 360;

        class Figure { public Transform T; public Renderer[] Parts; public Material[] Own; public bool Off; public float Lunge; public Vector3 Home; }
        class Foe { public Transform T, HpFill; public float Size; }
        class Bolt { public Transform T; public Vector3 From, To; public float Time; public string Hex; public bool Crit; }
        class Spark { public Transform T; public Vector3 V; public float Life, Size; }
        class Floater { public Transform T; public float Life; }

        readonly Transform root, marks;
        readonly Camera cam;
        readonly RenderTexture rt;
        readonly RawImage view;
        readonly Vector3 camBase;
        readonly float[,] height;
        readonly Dictionary<Collider, Vector2Int> tileOf = new Dictionary<Collider, Vector2Int>();
        readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();
        readonly Dictionary<int, Figure> disciples = new Dictionary<int, Figure>();
        readonly Dictionary<int, Foe> foes = new Dictionary<int, Foe>();
        readonly List<Bolt> shots = new List<Bolt>();
        readonly List<Spark> sparks = new List<Spark>();
        readonly List<Floater> floaters = new List<Floater>();
        readonly Shader lit;
        Transform ghost, ring, tileMark;
        string discipleSig;
        public Vector3 GoalAt { get; }

        public Board3D(MapLayout layout, RectTransform screenParent)
        {
            lit = Shader.Find("Standard") ?? Shader.Find("Legacy Shaders/Diffuse") ?? Shader.Find("Sprites/Default");
            root = new GameObject("Board3D").transform;
            root.position = Origin;
            var biome = Layouts.Biomes[layout.Biome];
            height = new float[Layouts.GridW, Layouts.GridH];
            var board = new GameObject("Static").transform;
            board.SetParent(root, false);
            BuildBoard(board, layout, GameData.Palette[biome.Palette]);
            var end = layout.Path[layout.Path.Length - 1];
            GoalAt = TileTop(end.X, end.Y);
            StaticBatchingUtility.Combine(board.gameObject);
            marks = new GameObject("Marks").transform;
            marks.SetParent(root, false);

            Light(biome.Time);
            float aspect = (float)Screen.width / Mathf.Max(1, Screen.height);
            rt = new RenderTexture(Mathf.Max(64, Mathf.RoundToInt(PixelHeight * aspect)), PixelHeight, 16) { filterMode = FilterMode.Point };
            cam = new GameObject("BoardCamera").AddComponent<Camera>();
            cam.transform.SetParent(root, false);
            cam.orthographic = true;
            // Fit the whole board: the width limits on a phone, the tilted depth plus the HUD bands on a wide screen.
            cam.orthographicSize = Mathf.Max(9.4f, (Layouts.GridW / 2f + 0.4f) / aspect);
            cam.transform.localRotation = Quaternion.Euler(52, 0, 0);
            var centre = new Vector3(Layouts.GridW / 2f, 0.4f, -Layouts.GridH / 2f - 0.3f);
            camBase = centre - cam.transform.forward * 30f;
            cam.transform.localPosition = camBase;
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Art.Hex(fogHex);
            cam.targetTexture = rt;

            // Full-screen picture behind the HUD; it takes no taps so the HUD's own hit tests stay as they were.
            var go = new GameObject("Board3DView", typeof(RectTransform), typeof(RawImage));
            var irt = (RectTransform)go.transform;
            irt.SetParent(screenParent, false);
            irt.SetAsFirstSibling();
            irt.anchorMin = Vector2.zero; irt.anchorMax = Vector2.one; irt.offsetMin = Vector2.zero; irt.offsetMax = Vector2.zero;
            view = go.GetComponent<RawImage>();
            view.texture = rt;
            view.raycastTarget = false;
        }

        public void Dispose()
        {
            cam.targetTexture = null;
            rt.Release();
            RenderSettings.fog = false;
            Object.Destroy(root.gameObject);
            if (view != null) Object.Destroy(view.gameObject);
            foreach (var m in mats.Values) Object.Destroy(m);
        }

        // ---------- materials, primitives, coordinates ----------

        Material Mat(string hex, float glow = 0)
        {
            string key = hex + glow;
            if (mats.TryGetValue(key, out var m)) return m;
            m = new Material(lit) { color = Art.Hex(hex) };
            m.SetFloat("_Glossiness", 0.12f);
            if (glow > 0) { m.EnableKeyword("_EMISSION"); m.SetColor("_EmissionColor", Art.Hex(hex) * glow); }
            mats[key] = m;
            return m;
        }

        Transform Prim(PrimitiveType type, Transform parent, Vector3 pos, Vector3 scale, string hex, float glow = 0, bool keepCollider = false)
        {
            var go = GameObject.CreatePrimitive(type);
            if (!keepCollider) Object.DestroyImmediate(go.GetComponent<Collider>());
            go.GetComponent<Renderer>().sharedMaterial = Mat(hex, glow);
            var t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = pos;
            t.localScale = scale;
            return t;
        }

        // Sim position in milli-tiles → board space; tile y grows towards the camera (down the screen, as in 2D).
        static Vector3 At(float milliX, float milliY) => new Vector3(milliX / 1000f, 0, -milliY / 1000f);
        static Vector3 TilePos(float x, float y) => new Vector3(x + 0.5f, 0, -(y + 0.5f));
        Vector3 TileTop(int x, int y) => TilePos(x, y) + new Vector3(0, height[Mathf.Clamp(x, 0, Layouts.GridW - 1), Mathf.Clamp(y, 0, Layouts.GridH - 1)], 0);

        // Wuxia look (art-bible: ink-dark, saturated, high contrast, never pastel): the biome palette from data,
        // darkened and saturated, so each biome keeps its hue but reads like lacquer and stone.
        static string Deep(string hex, float value = 0.5f, float sat = 1.35f)
        {
            Color.RGBToHSV(Art.Hex(hex), out var h, out var sv, out var v);
            return "#" + ColorUtility.ToHtmlStringRGB(Color.HSVToRGB(h, Mathf.Clamp01(sv * sat), v * value));
        }

        // ---------- board ----------

        void BuildBoard(Transform board, MapLayout layout, List<string> pal)
        {
            var onPath = new HashSet<long>();
            for (int i = 1; i < layout.Path.Length; i++)
            {
                var a = layout.Path[i - 1]; var b = layout.Path[i];
                int dx = System.Math.Sign(b.X - a.X), dy = System.Math.Sign(b.Y - a.Y);
                for (int x = a.X, y = a.Y; ; x += dx, y += dy) { onPath.Add(x * 1000L + y); if (x == b.X && y == b.Y) break; }
            }
            for (int y = 0; y < Layouts.GridH; y++)
                for (int x = 0; x < Layouts.GridW; x++)
                {
                    bool road = onPath.Contains(x * 1000L + y);
                    float n = Mathf.PerlinNoise(x * 0.35f, y * 0.35f);
                    float h = road ? 0.15f : 0.35f + n * 0.3f;
                    height[x, y] = h;
                    string col = road ? Deep(pal[3 + ((x + y) & 1)], 0.42f, 0.6f) : Deep(pal[(x * 7 + y * 3) % 3], 0.45f + n * 0.12f);
                    var tile = Prim(PrimitiveType.Cube, board, TilePos(x, y) + new Vector3(0, h / 2, 0), new Vector3(1, h, 1), col, 0, true);
                    tileOf[tile.GetComponent<Collider>()] = new Vector2Int(x, y);
                    if (!road && n > 0.62f) Prim(PrimitiveType.Sphere, board, tile.localPosition + new Vector3(0.2f, h / 2 + 0.05f, 0.1f), new Vector3(0.25f, 0.12f, 0.25f), Deep(pal[6], 0.35f));
                }
            foreach (var p in layout.Props) BuildProp(board, p);
            var start = layout.Path[0];
            var end = layout.Path[layout.Path.Length - 1];
            Gate(board, TileTop(start.X, start.Y), "#7A1030");
            Gate(board, TileTop(end.X, end.Y), "#E3B04B");
        }

        // Paifang: red lacquer pillars on stone feet, a black double lintel with gold trim, a glowing plaque.
        void Gate(Transform board, Vector3 at, string glowHex)
        {
            foreach (float sx in new[] { -0.45f, 0.45f })
            {
                Prim(PrimitiveType.Cube, board, at + new Vector3(sx, 0.08f, 0), new Vector3(0.22f, 0.16f, 0.22f), "#2A2628");
                Prim(PrimitiveType.Cube, board, at + new Vector3(sx, 0.7f, 0), new Vector3(0.12f, 1.25f, 0.12f), "#8A1410");
            }
            Prim(PrimitiveType.Cube, board, at + new Vector3(0, 1.2f, 0), new Vector3(1.15f, 0.08f, 0.16f), "#C9A040", 0.4f);
            Prim(PrimitiveType.Cube, board, at + new Vector3(0, 1.36f, 0), new Vector3(1.5f, 0.12f, 0.3f), "#141018");
            Eaves(board, at + new Vector3(0, 1.44f, 0), 1.5f, 0.4f);
            Prim(PrimitiveType.Cube, board, at + new Vector3(0, 0.98f, -0.07f), new Vector3(0.36f, 0.22f, 0.04f), glowHex, 1.6f);
            PointLight(at + new Vector3(0, 1f, -0.4f), glowHex, 3.5f, 1.8f);
        }

        // Upturned eaves: a dark tiled slab with tips lifted at both ends.
        void Eaves(Transform board, Vector3 at, float width, float depth)
        {
            Prim(PrimitiveType.Cube, board, at, new Vector3(width * 0.8f, 0.07f, depth), "#1A1620");
            foreach (float sx in new[] { -1f, 1f })
                Prim(PrimitiveType.Cube, board, at + new Vector3(sx * width * 0.45f, 0.05f, 0), new Vector3(width * 0.2f, 0.06f, depth), "#1A1620")
                    .localRotation = Quaternion.Euler(0, 0, sx * 18);
        }

        void BuildProp(Transform board, Prop p)
        {
            var at = TileTop(p.At.X, p.At.Y);
            string t = p.Type ?? "";
            if (t.Contains("lantern"))
            {
                Prim(PrimitiveType.Cylinder, board, at + new Vector3(0, 0.4f, 0), new Vector3(0.08f, 0.4f, 0.08f), "#1A1416");
                Prim(PrimitiveType.Sphere, board, at + new Vector3(0, 0.9f, 0), new Vector3(0.28f, 0.34f, 0.28f), "#D2281A", 2f);
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 1.1f, 0), new Vector3(0.2f, 0.04f, 0.2f), "#C9A040");
                PointLight(at + new Vector3(0, 1f, 0), "#FF6A2A", 3.2f, 1.6f);
            }
            else if (t.Contains("tree") || t.Contains("bamboo") || t.Contains("pine"))
            {
                Prim(PrimitiveType.Cylinder, board, at + new Vector3(0, 0.35f, 0), new Vector3(0.14f, 0.35f, 0.14f), "#2A1A14");
                Prim(PrimitiveType.Sphere, board, at + new Vector3(0, 1f, 0), new Vector3(0.9f, 0.7f, 0.9f), "#14301C");
                Prim(PrimitiveType.Sphere, board, at + new Vector3(0.15f, 1.32f, -0.1f), new Vector3(0.55f, 0.42f, 0.55f), "#1E4426");
            }
            else if (t == "rice")
                for (int i = 0; i < 3; i++) Prim(PrimitiveType.Cube, board, at + new Vector3(-0.3f + i * 0.3f, 0.1f, 0), new Vector3(0.18f, 0.2f, 0.85f), i == 1 ? "#6A7A22" : "#3E5A1E");
            else if (t == "flag")
            {
                Prim(PrimitiveType.Cylinder, board, at + new Vector3(0, 0.5f, 0), new Vector3(0.05f, 0.6f, 0.05f), "#1A1416");
                Prim(PrimitiveType.Cube, board, at + new Vector3(0.14f, 0.82f, 0), new Vector3(0.24f, 0.5f, 0.03f), "#8A1410", 0.3f);
                Prim(PrimitiveType.Cube, board, at + new Vector3(0.14f, 0.82f, -0.02f), new Vector3(0.08f, 0.3f, 0.01f), "#C9A040", 0.6f);
            }
            else if (t == "ice")
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 0.45f, 0), new Vector3(0.6f, 0.9f, 0.6f), "#5A8AB8", 0.5f);
            else if (t.Contains("rock") || t.Contains("stone") || t == "ruin")
                Prim(PrimitiveType.Sphere, board, at + new Vector3(0, 0.2f, 0), new Vector3(0.8f, 0.5f, 0.7f), "#2E2C34");
            else
            {
                // Houses, shrines, walls and anything else: dark timber walls, red pillars, black roof with upturned eaves.
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 0.33f, 0), new Vector3(0.78f, 0.66f, 0.78f), "#3A2A22");
                foreach (float sx in new[] { -0.4f, 0.4f }) Prim(PrimitiveType.Cube, board, at + new Vector3(sx, 0.33f, -0.4f), new Vector3(0.08f, 0.66f, 0.08f), "#8A1410");
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 0.3f, -0.4f), new Vector3(0.2f, 0.16f, 0.02f), "#FF8A3A", 1.4f); // lit window
                Eaves(board, at + new Vector3(0, 0.72f, 0), 1.2f, 1.05f);
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 0.88f, 0), new Vector3(0.6f, 0.22f, 0.7f), "#141018");
                Prim(PrimitiveType.Cube, board, at + new Vector3(0, 1.0f, 0), new Vector3(0.7f, 0.05f, 0.08f), "#C9A040", 0.3f);
            }
        }

        void PointLight(Vector3 local, string hex, float range, float intensity)
        {
            var l = new GameObject("Light").AddComponent<Light>();
            l.type = LightType.Point; l.color = Art.Hex(hex); l.range = range; l.intensity = intensity;
            l.transform.SetParent(root, false);
            l.transform.localPosition = local;
        }

        // Dramatic light: a hard warm key from the side, a cool rim from behind, near-black ambient and ink fog.
        void Light(string time)
        {
            var key = new GameObject("Key").AddComponent<Light>();
            key.type = LightType.Directional;
            key.shadows = LightShadows.Hard;
            key.shadowStrength = 0.85f;
            key.transform.SetParent(root, false);
            key.transform.rotation = Quaternion.Euler(38, -50, 0);
            var rim = new GameObject("Rim").AddComponent<Light>();
            rim.type = LightType.Directional;
            rim.transform.SetParent(root, false);
            rim.transform.rotation = Quaternion.Euler(25, 150, 0);
            string fog;
            switch (time)
            {
                case "night": key.color = Art.Hex("#8FA0E8"); key.intensity = 0.7f; rim.color = Art.Hex("#3A5AC8"); fog = "#0A0C1C"; RenderSettings.ambientLight = Art.Hex("#141628"); break;
                case "blood-moon": key.color = Art.Hex("#FF4A3A"); key.intensity = 0.85f; rim.color = Art.Hex("#7A1030"); fog = "#1A060C"; RenderSettings.ambientLight = Art.Hex("#24101A"); break;
                case "dawn": key.color = Art.Hex("#FFD8A0"); key.intensity = 1.05f; rim.color = Art.Hex("#4A7A9A"); fog = "#10161A"; RenderSettings.ambientLight = Art.Hex("#1C2226"); break;
                default: key.color = Art.Hex("#FFA860"); key.intensity = 1.15f; rim.color = Art.Hex("#5A3A9A"); fog = "#120A12"; RenderSettings.ambientLight = Art.Hex("#1E1622"); break;
            }
            rim.intensity = 0.45f;
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Art.Hex(fog);
            RenderSettings.fogStartDistance = 26f;
            RenderSettings.fogEndDistance = 48f;
            fogHex = fog;
        }

        string fogHex = "#0B0910";

        // ---------- figures ----------

        // Robe colours per sect and weapon per kit, matching the 2D sprites in Art.cs.
        static readonly Dictionary<string, string[]> Looks = new Dictionary<string, string[]>
        {
            ["metal"] = new[] { "#9AA6B8", "#232836", "#0E0B10", "sword" },
            ["wood"] = new[] { "#1C7A3E", "#0C3018", "#0E0B10", "flute" },
            ["water"] = new[] { "#1E5CB0", "#0C1E48", "#C8D4E8", "palm" },
            ["fire"] = new[] { "#B01C14", "#3E0806", "#0E0B10", "fan" },
            ["earth"] = new[] { "#B0661A", "#3E220A", null, "staff" },
            ["yinyang"] = new[] { "#E2DAC4", "#14111A", "#0E0B10", "taiji" },
        };

        static readonly Dictionary<string, string[]> FoeLooks = new Dictionary<string, string[]>
        {
            ["cultist"] = new[] { "#3A0A12", "#120408", "#FF2A1A" },
            ["runner"] = new[] { "#1E2A14", "#0A0E08", "#FF2A1A" },
            ["brute"] = new[] { "#34303C", "#14121A", "#FF4A1A" },
            ["leaper"] = new[] { "#12261C", "#060E0A", "#7AFF5A" },
            ["healer"] = new[] { "#4A1008", "#1A0604", "#FFC040" },
        };

        Transform BuildFigure(string robeSect, string kit, int level, bool ghostLook)
        {
            var look = Looks.TryGetValue(robeSect, out var l) ? l : Looks["metal"];
            var weaponKind = Looks.TryGetValue(kit, out var k) ? k[3] : look[3];
            var body = new GameObject(robeSect + "-" + kit).transform;
            body.SetParent(root, false);
            // Aura disc in the sect colour; upgrades turn it gold and widen it, so levels read from across the board.
            string auraHex = level > 0 ? "#E3B04B" : look[0];
            float aura = 0.75f + 0.12f * level;
            Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.01f, 0), new Vector3(aura, 0.01f, aura), auraHex, ghostLook ? 1.6f : 0.6f + 0.4f * level);
            Prim(PrimitiveType.Cube, body, new Vector3(-0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.42f, 0), new Vector3(0.42f, 0.4f, 0.28f), look[0]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.25f, 0), new Vector3(0.5f, 0.14f, 0.34f), look[1]); // robe skirt
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.34f, 0), new Vector3(0.46f, 0.05f, 0.31f), "#C9A040", 0.3f); // gold sash
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.4f, -0.17f), new Vector3(0.44f, 0.5f, 0.04f), kit != robeSect && Looks.ContainsKey(kit) ? Looks[kit][0] : look[1]) // cape, kit colour when it differs
                .localRotation = Quaternion.Euler(-12, 0, 0);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.6f, 0), new Vector3(0.5f, 0.06f, 0.3f), look[1]); // shoulders
            Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.78f, 0), new Vector3(0.36f, 0.36f, 0.36f), "#F2C9A0");
            if (look[2] != null)
            {
                Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.86f, 0.04f), new Vector3(0.38f, 0.3f, 0.36f), look[2]);
                Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.02f, 0.05f), new Vector3(0.14f, 0.14f, 0.14f), look[2]); // topknot
            }
            switch (weaponKind)
            {
                case "sword": Prim(PrimitiveType.Cube, body, new Vector3(0.3f, 0.6f, 0), new Vector3(0.05f, 0.7f, 0.05f), "#E8EEF5", 1.6f); break;
                case "flute": Prim(PrimitiveType.Cylinder, body, new Vector3(0.25f, 0.55f, -0.1f), new Vector3(0.05f, 0.25f, 0.05f), "#9BD17A").localRotation = Quaternion.Euler(0, 0, 70); break;
                case "palm": Prim(PrimitiveType.Sphere, body, new Vector3(0.3f, 0.5f, -0.1f), new Vector3(0.2f, 0.2f, 0.2f), "#9FD8FF", 2f); break;
                case "fan": Prim(PrimitiveType.Cylinder, body, new Vector3(0.3f, 0.6f, -0.05f), new Vector3(0.4f, 0.02f, 0.4f), "#FFB347", 0.8f).localRotation = Quaternion.Euler(80, 0, 0); break;
                case "taiji": Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.25f, 0), new Vector3(0.22f, 0.22f, 0.22f), "#F2F2F2", 1.5f); break;
                default: Prim(PrimitiveType.Cylinder, body, new Vector3(0.28f, 0.55f, 0), new Vector3(0.05f, 0.6f, 0.05f), "#E3B04B"); break;
            }
            if (robeSect == "earth") Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.6f, 0), new Vector3(0.5f, 0.03f, 0.5f), "#E3B04B"); // prayer-bead ring
            for (int i = 0; i < level; i++) Prim(PrimitiveType.Cube, body, new Vector3(-0.15f + i * 0.15f, 1.25f, 0), new Vector3(0.1f, 0.06f, 0.1f), "#E3B04B", 1.5f);
            return body;
        }

        // Same look rules as DefendView.DiscipleSprite: a roster unit wears its sect with its kit's weapon.
        static (string robe, string kit) LookOf(string key) =>
            GameData.Units.TryGetValue(key, out var u) ? (u.Sect, u.Element) : (key, key);

        static (string robe, string kit) LookOf(Disciple d) =>
            d.Unit != null ? (d.El, d.Els[0]) : (d.Els[0], d.Els[d.Els.Count - 1]);

        public void SyncDisciples(DefendState s)
        {
            string sig = string.Join("|", s.Disciples.Select(d => d.Id + ":" + d.Level + ":" + string.Join("", d.Els)));
            if (sig == discipleSig) return;
            discipleSig = sig;
            foreach (var f in disciples.Values) Object.Destroy(f.T.gameObject);
            disciples.Clear();
            foreach (var d in s.Disciples)
            {
                var (robe, kit) = LookOf(d);
                var t = BuildFigure(robe, kit, d.Level, false);
                var home = TileTop(d.Tx, d.Ty);
                t.localPosition = home;
                var parts = t.GetComponentsInChildren<Renderer>();
                disciples[d.Id] = new Figure { T = t, Home = home, Parts = parts, Own = parts.Select(r => r.sharedMaterial).ToArray() };
            }
        }

        // Each frame: face the nearest enemy, lunge after a hit, grey out while disabled or sealed.
        public void UpdateDisciples(DefendState s, float dt)
        {
            foreach (var d in s.Disciples)
            {
                if (!disciples.TryGetValue(d.Id, out var f)) continue;
                bool off = d.OffT > 0 || (s.SealT > 0 && s.SealEl != null && d.Els.Contains(s.SealEl));
                if (off != f.Off)
                {
                    f.Off = off;
                    var grey = Mat("#5A5A6A");
                    for (int i = 0; i < f.Parts.Length; i++) f.Parts[i].sharedMaterial = off ? grey : f.Own[i];
                }
                Vector3 face = Vector3.back; float best = float.MaxValue;
                foreach (var e in s.Enemies)
                {
                    var dd = At(e.X, e.Y) - f.Home; dd.y = 0;
                    if (dd.sqrMagnitude < best) { best = dd.sqrMagnitude; face = dd; }
                }
                if (face.sqrMagnitude > 0.0001f) f.T.localRotation = Quaternion.LookRotation(face);
                f.Lunge = Mathf.Max(0, f.Lunge - dt * 5);
                float bob = Mathf.Sin(Time.time * 3 + f.Home.x * 1.7f) * 0.03f;
                f.T.localPosition = f.Home + new Vector3(0, bob + f.Lunge * 0.15f, 0) + face.normalized * f.Lunge * 0.2f;
            }
        }

        public void RenderEnemies(DefendState s, Dictionary<int, Vector2> prev, float alpha)
        {
            var seen = new HashSet<int>();
            foreach (var e in s.Enemies)
            {
                seen.Add(e.Id);
                if (!foes.TryGetValue(e.Id, out var f)) foes[e.Id] = f = BuildFoe(e);
                var from = prev.TryGetValue(e.Id, out var p) ? p : new Vector2(e.X, e.Y);
                var at = At(Mathf.Lerp(from.x, e.X, alpha), Mathf.Lerp(from.y, e.Y, alpha));
                var ahead = At(e.X, e.Y) - At(from.x, from.y);
                float lift = e.Air ? 0.9f + Mathf.Sin(Time.time * 4 + e.Id) * 0.08f : 0.15f + Mathf.Abs(Mathf.Sin(Time.time * 9 + e.Id)) * 0.05f;
                f.T.localPosition = at + new Vector3(0, lift, 0);
                if (ahead.sqrMagnitude > 0.000001f) f.T.localRotation = Quaternion.LookRotation(ahead);
                float frac = Mathf.Clamp01((float)e.Hp / e.MaxHp);
                f.HpFill.localScale = new Vector3(0.7f * frac, 0.07f, 0.07f);
                f.HpFill.localPosition = new Vector3(-0.35f + 0.35f * frac, 0, 0);
                // The bar hangs from a pivot that ignores the foe's turning, so it always reads left to right.
                f.HpFill.parent.rotation = root.rotation;
            }
            foreach (var id in foes.Keys.Where(id => !seen.Contains(id)).ToList())
            {
                Object.Destroy(foes[id].T.gameObject);
                foes.Remove(id);
            }
        }

        Foe BuildFoe(Enemy e)
        {
            var def = GameData.Enemies[e.Type];
            var look = FoeLooks.TryGetValue(e.Type, out var l) ? l : FoeLooks["cultist"];
            string robe = e.Elite == "golden" ? "#C9A040" : look[0];
            float size = def.Boss != null ? 2f : e.Type == "brute" ? 1.35f : e.Type == "runner" ? 0.85f : 1f;
            if (e.Small) size *= 0.7f;
            var t = new GameObject("e" + e.Id).transform;
            t.SetParent(root, false);
            var body = new GameObject("Body").transform;
            body.SetParent(t, false);
            body.localScale = Vector3.one * size;
            Prim(PrimitiveType.Capsule, body, new Vector3(0, 0.3f, 0), new Vector3(0.36f, 0.3f, 0.36f), robe);
            Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.68f, 0), new Vector3(0.3f, 0.3f, 0.3f), look[1]);
            Prim(PrimitiveType.Sphere, body, new Vector3(0.07f, 0.7f, 0.13f), new Vector3(0.06f, 0.06f, 0.06f), look[2], 3f);
            Prim(PrimitiveType.Sphere, body, new Vector3(-0.07f, 0.7f, 0.13f), new Vector3(0.06f, 0.06f, 0.06f), look[2], 3f);
            if (e.Air) Prim(PrimitiveType.Cube, body, new Vector3(0, 0.45f, -0.1f), new Vector3(0.9f, 0.04f, 0.25f), look[1]); // wings
            if (def.Boss != null) Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.88f, 0), new Vector3(0.36f, 0.06f, 0.36f), "#E3B04B", 1.5f); // crown
            if (e.Elite != null) Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.02f, 0), new Vector3(0.7f, 0.01f, 0.7f), e.Elite == "golden" ? "#FFE9A8" : e.Elite == "swift" ? "#9BD17A" : "#D2412F", 1.2f);
            var bar = new GameObject("Hp").transform;
            bar.SetParent(t, false);
            bar.localPosition = new Vector3(0, 0.95f * size + 0.15f, 0);
            Prim(PrimitiveType.Cube, bar, Vector3.zero, new Vector3(0.74f, 0.09f, 0.05f), "#1A1423");
            var fill = Prim(PrimitiveType.Cube, bar, new Vector3(0, 0, -0.02f), new Vector3(0.7f, 0.07f, 0.07f), "#D2412F", 1f);
            return new Foe { T = t, HpFill = fill, Size = size };
        }

        // ---------- shots and sparks ----------

        public void Attack(int discipleId) { if (disciples.TryGetValue(discipleId, out var f)) f.Lunge = 1; }

        public void Shot(int fromId, Vector2 toMilli, string el, bool crit)
        {
            if (!disciples.TryGetValue(fromId, out var f)) return;
            string hex = GameData.Sects[el].Color;
            var from = f.Home + new Vector3(0, 0.6f, 0);
            var to = At(toMilli.x, toMilli.y) + new Vector3(0, 0.5f, 0);
            var t = Prim(PrimitiveType.Sphere, root, from, Vector3.one * (crit ? 0.26f : 0.18f), hex, 3f);
            shots.Add(new Bolt { T = t, From = from, To = to, Hex = hex, Crit = crit });
            f.Lunge = 1;
        }

        public void Burst(Vector3 local, string hex, int count, float size = 0.12f)
        {
            for (int k = 0; k < count; k++)
            {
                var t = Prim(PrimitiveType.Cube, root, local, Vector3.one * size, hex, 2f);
                sparks.Add(new Spark { T = t, V = new Vector3(Random.Range(-2f, 2f), Random.Range(1.5f, 3.5f), Random.Range(-2f, 2f)), Life = 0.5f, Size = size * 2 });
            }
        }

        public Vector3 EnemyAt(int milliX, int milliY) => At(milliX, milliY) + new Vector3(0, 0.4f, 0);
        public Vector3 DiscipleAt(int id) => disciples.TryGetValue(id, out var f) ? f.Home + new Vector3(0, 0.5f, 0) : GoalAt;

        // Floating text (damage, silver) that faces the camera and rises; uses the same font as the HUD.
        public void Number(Vector3 local, string text, string hex)
        {
            var font = Ui.Font;
            if (font == null) return;
            var go = new GameObject("num");
            go.transform.SetParent(root, false);
            go.transform.localPosition = local + new Vector3(0, 0.6f, 0);
            go.transform.rotation = cam.transform.rotation;
            var tm = go.AddComponent<TextMesh>();
            tm.font = font; tm.text = text; tm.fontSize = 48; tm.characterSize = 0.06f;
            tm.anchor = TextAnchor.MiddleCenter; tm.color = Art.Hex(hex);
            go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            floaters.Add(new Floater { T = go.transform, Life = 0.8f });
        }

        public void Update(float dt, Vector3 shake)
        {
            cam.transform.localPosition = camBase + shake;
            for (int i = shots.Count - 1; i >= 0; i--)
            {
                var s = shots[i];
                s.Time += dt / 0.18f;
                s.T.localPosition = Vector3.Lerp(s.From, s.To, s.Time) + new Vector3(0, Mathf.Sin(Mathf.Min(1, s.Time) * Mathf.PI) * 0.3f, 0);
                if (s.Time < 1) continue;
                Burst(s.To, s.Crit ? "#FFD34A" : s.Hex, s.Crit ? 8 : 4, s.Crit ? 0.14f : 0.09f);
                Object.Destroy(s.T.gameObject); shots.RemoveAt(i);
            }
            for (int i = sparks.Count - 1; i >= 0; i--)
            {
                var p = sparks[i];
                p.Life -= dt;
                p.V += new Vector3(0, -6f, 0) * dt;
                p.T.localPosition += p.V * dt;
                p.T.localScale = Vector3.one * Mathf.Max(0, p.Life) * p.Size;
                if (p.Life <= 0) { Object.Destroy(p.T.gameObject); sparks.RemoveAt(i); }
            }
            for (int i = floaters.Count - 1; i >= 0; i--)
            {
                var f = floaters[i];
                f.Life -= dt;
                f.T.localPosition += new Vector3(0, dt * 1.2f, 0);
                if (f.Life <= 0) { Object.Destroy(f.T.gameObject); floaters.RemoveAt(i); }
            }
            if (ghost != null) ghost.localScale = Vector3.one * (1 + Mathf.Sin(Time.time * 6) * 0.05f);
        }

        // ---------- placement marks ----------

        public void ShowGhost(string key, int tx, int ty)
        {
            HideGhost();
            var (robe, kit) = LookOf(key);
            ghost = BuildFigure(robe, kit, 0, true);
            ghost.localPosition = TileTop(tx, ty);
        }

        void HideGhost() { if (ghost != null) Object.Destroy(ghost.gameObject); ghost = null; }

        // Attack range as a halo of glowing beads floating just above the tallest tiles, in the sect colour.
        public void ShowRing(int tx, int ty, int rangeMilli, string hex)
        {
            HideRing();
            ring = new GameObject("Ring").transform;
            ring.SetParent(marks, false);
            ring.localPosition = TilePos(tx, ty) + new Vector3(0, 0.72f, 0);
            float r = rangeMilli / 1000f;
            int n = Mathf.Clamp(Mathf.RoundToInt(r * 14), 16, 64);
            for (int i = 0; i < n; i++)
            {
                float a = i * Mathf.PI * 2 / n;
                var bead = Prim(PrimitiveType.Cube, ring, new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r), new Vector3(0.12f, 0.03f, 0.12f), hex, 1.8f);
                bead.localRotation = Quaternion.Euler(0, -a * Mathf.Rad2Deg, 0);
            }
        }

        public void HideRing() { if (ring != null) Object.Destroy(ring.gameObject); ring = null; }
        public bool RingShown => ring != null;

        public void ShowTileMark(int tx, int ty)
        {
            if (tileMark != null) Object.Destroy(tileMark.gameObject);
            tileMark = new GameObject("TileMark").transform;
            tileMark.SetParent(marks, false);
            tileMark.localPosition = TileTop(tx, ty) + new Vector3(0, 0.02f, 0);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0, 0, 0.47f), new Vector3(1, 0.04f, 0.06f), "#E3B04B", 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0, 0, -0.47f), new Vector3(1, 0.04f, 0.06f), "#E3B04B", 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0.47f, 0, 0), new Vector3(0.06f, 0.04f, 1), "#E3B04B", 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(-0.47f, 0, 0), new Vector3(0.06f, 0.04f, 1), "#E3B04B", 1.5f);
        }

        public void HideMarks()
        {
            HideRing(); HideGhost();
            if (tileMark != null) Object.Destroy(tileMark.gameObject);
            tileMark = null;
        }

        // Tap → tile: the picture fills the screen, so a screen fraction is a camera viewport point; the ray hits a tile cube.
        public bool TileAt(Vector2 screen, out int tx, out int ty)
        {
            tx = ty = -1;
            var ray = cam.ViewportPointToRay(new Vector3(screen.x / Screen.width, screen.y / Screen.height, 0));
            if (!Physics.Raycast(ray, out var hit, 500f) || !tileOf.TryGetValue(hit.collider, out var c)) return false;
            tx = c.x; ty = c.y;
            return true;
        }
    }
}
