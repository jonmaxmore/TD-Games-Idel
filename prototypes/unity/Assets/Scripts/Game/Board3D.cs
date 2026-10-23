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
        const int PixelHeight = 480;
        const float FigScale = 1.35f; // figures fill most of a tile so silhouettes read on a phone

        class Figure
        {
            public Transform T, Weapon, Orbit; public Renderer[] Parts; public Material[] Own; public bool Off; public float Lunge; public Vector3 Home;
            public string Kit, WeaponKind; public Quaternion WRot; public Vector3 WPos, WScale; public int Level, ElCount; public Collider Hit;
        }
        class Foe
        {
            public Transform T, HpFill, Stars; public Transform[] Bubbles; public GameObject Flame, Ice; public Renderer Skin; public Material SkinMat; public bool Slowed, Hidden;
        }
        class Bolt { public Transform T; public Vector3 From, To; public float Time, Dur, Arc; public string Kit; public bool Crit; public (PrimitiveType, string, float) Key; }
        class Flash { public Transform T; public float Life, Max; public Vector3 From, To; }
        class Spark { public Transform T; public Vector3 V; public float Life, Size; public (PrimitiveType, string, float) Key; }
        class Floater { public Transform T; public TextMesh Text; public float Life, Max; }
        class Sweep { public Transform T; public float Time; }

        readonly Transform root, marks;
        readonly Camera cam;
        RenderTexture rt;
        readonly RawImage view;
        Vector3 camBase, camPos, camTarget;
        int screenW, screenH;
        readonly float[,] height;
        readonly Dictionary<Collider, Vector2Int> tileOf = new Dictionary<Collider, Vector2Int>();
        readonly Dictionary<(string, float), Material> mats = new Dictionary<(string, float), Material>();
        // Short-lived effect pieces are reused instead of created and destroyed for every hit.
        readonly Dictionary<(PrimitiveType, string, float), Stack<Transform>> pool = new Dictionary<(PrimitiveType, string, float), Stack<Transform>>();
        readonly List<Sweep> sweeps = new List<Sweep>();
        readonly Vector3[] pathPts;
        int discipleCheck = int.MinValue;
        // Global render settings this board changes, put back on Dispose.
        readonly UnityEngine.Rendering.AmbientMode prevAmbientMode;
        readonly Color prevAmbient, prevFogColor;
        readonly bool prevFog;
        readonly FogMode prevFogMode;
        readonly float prevFogStart, prevFogEnd, prevShadowDistance;
        readonly Dictionary<int, Figure> disciples = new Dictionary<int, Figure>();
        readonly Dictionary<int, Foe> foes = new Dictionary<int, Foe>();
        readonly List<Bolt> shots = new List<Bolt>();
        readonly List<Spark> sparks = new List<Spark>();
        readonly List<Floater> floaters = new List<Floater>();
        readonly List<Flash> flashes = new List<Flash>();
        static readonly List<int> scratchIds = new List<int>();
        static readonly HashSet<int> scratchSeen = new HashSet<int>();
        readonly Shader lit;
        Transform ghost, ring, tileMark;
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
            pathPts = layout.Path.Select(pt => TileTop(pt.X, pt.Y) + new Vector3(0, 1.1f, 0)).ToArray();

            prevAmbientMode = RenderSettings.ambientMode; prevAmbient = RenderSettings.ambientLight; prevFog = RenderSettings.fog;
            prevFogColor = RenderSettings.fogColor; prevFogMode = RenderSettings.fogMode;
            prevFogStart = RenderSettings.fogStartDistance; prevFogEnd = RenderSettings.fogEndDistance; prevShadowDistance = QualitySettings.shadowDistance;
            Light(biome.Time);
            rt = MakeRt();
            cam = new GameObject("BoardCamera").AddComponent<Camera>();
            cam.transform.SetParent(root, false);
            // A narrow perspective lens tilted 50°: real depth, near rows a little larger, the whole board on screen.
            cam.orthographic = false;
            cam.fieldOfView = 30f;
            cam.aspect = (float)rt.width / rt.height;
            cam.nearClipPlane = 0.3f; cam.farClipPlane = 300f;
            cam.transform.localRotation = Quaternion.Euler(50, 0, 0);
            Refit();
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

        RenderTexture MakeRt()
        {
            screenW = Screen.width; screenH = Screen.height;
            float aspect = (float)screenW / Mathf.Max(1, screenH);
            return new RenderTexture(Mathf.Max(64, Mathf.RoundToInt(PixelHeight * aspect)), PixelHeight, 16) { filterMode = FilterMode.Point };
        }

        void Refit()
        {
            cam.aspect = (float)rt.width / rt.height;
            camBase = Fit();
            camPos = camTarget = camBase;
            cam.transform.localPosition = camBase;
            RenderSettings.fogStartDistance = fitDist + 4f;
            RenderSettings.fogEndDistance = fitDist + 26f;
            QualitySettings.shadowDistance = fitDist + 20f;
        }

        // Rotation or a resized window: a new render texture at the new aspect, and the camera fitted again.
        void FollowScreen()
        {
            if (Screen.width == screenW && Screen.height == screenH) return;
            cam.targetTexture = null;
            rt.Release(); Object.Destroy(rt);
            rt = MakeRt();
            cam.targetTexture = rt;
            view.texture = rt;
            Refit();
        }

        public void Dispose()
        {
            cam.targetTexture = null;
            rt.Release(); Object.Destroy(rt);
            RenderSettings.ambientMode = prevAmbientMode; RenderSettings.ambientLight = prevAmbient; RenderSettings.fog = prevFog;
            RenderSettings.fogColor = prevFogColor; RenderSettings.fogMode = prevFogMode;
            RenderSettings.fogStartDistance = prevFogStart; RenderSettings.fogEndDistance = prevFogEnd; QualitySettings.shadowDistance = prevShadowDistance;
            Object.Destroy(root.gameObject);
            if (view != null) Object.Destroy(view.gameObject);
            foreach (var m in mats.Values) Object.Destroy(m);
            foreach (var p in portraits.Values) { p.Release(); Object.Destroy(p); }
        }

        // ---------- camera ----------

        // Viewport band between the HUD bars (top ~70 px; bottom bar + secret arts row ~210 px of the 1280 reference).
        const float BandLo = 0.165f, BandHi = 0.945f;
        float fitDist;

        // Back the camera off until the board (with headroom for figures) fits the band, then centre it in the band.
        Vector3 Fit()
        {
            var c = new Vector3(Layouts.GridW / 2f, 0.3f, -Layouts.GridH / 2f);
            var fwd = cam.transform.forward;
            var up = cam.transform.up;
            Vector3 shift = Vector3.zero, pos = c;
            for (int pass = 0; pass < 3; pass++)
            {
                for (fitDist = 6f; fitDist < 150f; fitDist += 0.25f)
                {
                    pos = c + shift - fwd * fitDist;
                    cam.transform.localPosition = pos;
                    if (Fits(out _, out _)) break;
                }
                Fits(out var lo, out var hi);
                float worldH = 2 * fitDist * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad);
                shift += up * (((lo + hi) / 2 - (BandLo + BandHi) / 2) * worldH);
            }
            return pos;
        }

        bool Fits(out float lo, out float hi)
        {
            lo = 1; hi = 0;
            bool ok = true;
            for (int i = 0; i < 8; i++)
            {
                var p = new Vector3((i & 1) * Layouts.GridW, (i & 2) != 0 ? 1.6f : 0, (i & 4) != 0 ? -Layouts.GridH : 0);
                var v = cam.WorldToViewportPoint(root.TransformPoint(p));
                lo = Mathf.Min(lo, v.y); hi = Mathf.Max(hi, v.y);
                if (v.z <= 0 || v.x < 0.01f || v.x > 0.99f || v.y < BandLo || v.y > BandHi) ok = false; // z <= 0: behind the camera
            }
            return ok;
        }

        // Placement zoom: slide 30% of the way towards the tile along the line of sight, so the tile keeps its
        // place on screen (the panel opens on the other half) while it and the ghost grow about 1.4x.
        public void Focus(int tx, int ty) => camTarget = camBase + (TileTop(tx, ty) - camBase) * 0.3f;
        public void Unfocus() => camTarget = camBase;

        // ---------- materials, primitives, coordinates ----------

        Material Mat(string hex, float glow = 0)
        {
            var key = (hex, glow);
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

        Transform Take((PrimitiveType type, string hex, float glow) key, Vector3 pos, Vector3 scale)
        {
            if (pool.TryGetValue(key, out var st) && st.Count > 0)
            {
                var t = st.Pop();
                t.gameObject.SetActive(true);
                t.localPosition = pos; t.localScale = scale; t.localRotation = Quaternion.identity;
                return t;
            }
            return Prim(key.type, root, pos, scale, key.hex, key.glow);
        }

        void Give((PrimitiveType, string, float) key, Transform t)
        {
            t.gameObject.SetActive(false);
            if (!pool.TryGetValue(key, out var st)) pool[key] = st = new Stack<Transform>();
            st.Push(t);
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
            ["puppet"] = new[] { "#2A3446", "#141A24", "#9FD8FF" },
            ["assassin"] = new[] { "#141018", "#08060A", "#B0A0FF" },
            ["mimic"] = new[] { "#2A1E4A", "#120A24", "#E0A0FF" },
            ["boss_ch1"] = new[] { "#5A3A14", "#2A1A08", "#FFB040" },
            ["boss_ch1b"] = new[] { "#5A0A18", "#24040A", "#FF3A2A" },
            ["boss_final"] = new[] { "#E8E2D0", "#14111A", "#FFD34A" },
        };

        static readonly Dictionary<string, string> KitVfx = new Dictionary<string, string>
        { ["metal"] = "#E8EEF5", ["fire"] = "#FF6A1F", ["water"] = "#6FC8FF", ["wood"] = "#7AE05A", ["earth"] = "#9A7A54", ["yinyang"] = "#FFF4C8" };

        // Robe = sect, weapon = kit, headgear = role, aura = role colour, gold rim and props = tier.
        Transform BuildFigure(string robeSect, string kit, string role, int level, bool ghostLook, out Transform weapon, out Transform orbit)
        {
            var look = Looks.TryGetValue(robeSect, out var l) ? l : Looks["metal"];
            var weaponKind = Looks.TryGetValue(kit, out var k) ? k[3] : look[3];
            var body = new GameObject(robeSect + "-" + kit).transform;
            body.SetParent(root, false);
            string roleHex = role != null && Ui.RoleColor.TryGetValue(role, out var rc) ? rc : look[0];
            float aura = 0.68f + 0.08f * level;
            if (level >= 2) Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.005f, 0), new Vector3(aura + 0.14f, 0.008f, aura + 0.14f), "#E3B04B", 0.6f + 0.5f * level);
            Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.012f, 0), new Vector3(aura, 0.01f, aura), roleHex, ghostLook ? 1.8f : 0.9f);
            Prim(PrimitiveType.Cube, body, new Vector3(-0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.42f, 0), new Vector3(0.42f, 0.4f, 0.28f), look[0]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.25f, 0), new Vector3(0.5f, 0.14f, 0.34f), look[1]); // robe skirt
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.34f, 0), new Vector3(0.46f, 0.05f, 0.31f), "#C9A040", 0.3f); // gold sash
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.4f, -0.17f), new Vector3(0.44f, 0.5f, 0.04f), kit != robeSect && Looks.ContainsKey(kit) ? Looks[kit][0] : look[1]) // cape, kit colour when it differs
                .localRotation = Quaternion.Euler(-12, 0, 0);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.6f, 0), new Vector3(0.5f, 0.06f, 0.3f), look[1]); // shoulders
            Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.78f, 0), new Vector3(0.36f, 0.36f, 0.36f), "#F2C9A0");
            bool hat = role == "striker" || role == "burst" || role == "control";
            if (look[2] != null)
            {
                Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.86f, 0.04f), new Vector3(0.38f, 0.3f, 0.36f), look[2]);
                if (!hat) Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.02f, 0.05f), new Vector3(0.14f, 0.14f, 0.14f), look[2]); // topknot
            }
            switch (role)
            {
                case "striker": // tall guan with a red plume
                    Prim(PrimitiveType.Cube, body, new Vector3(0, 1.02f, 0.02f), new Vector3(0.12f, 0.2f, 0.14f), "#141018");
                    Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.18f, 0.02f), new Vector3(0.12f, 0.16f, 0.12f), "#D2281A", 1f);
                    break;
                case "burst": // wide douli straw hat
                    Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.97f, 0), new Vector3(0.8f, 0.025f, 0.8f), "#8A6A3A");
                    Prim(PrimitiveType.Cylinder, body, new Vector3(0, 1.02f, 0), new Vector3(0.34f, 0.05f, 0.34f), "#6E5228");
                    break;
                case "control": // hood and a ribbon across the body
                    Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.84f, -0.03f), new Vector3(0.44f, 0.42f, 0.44f), look[1]);
                    Prim(PrimitiveType.Cube, body, new Vector3(0, 0.55f, 0.02f), new Vector3(0.9f, 0.03f, 0.06f), look[0], 1.2f).localRotation = Quaternion.Euler(0, 0, -20);
                    break;
                case "stacker": // bone half mask and a medicine gourd
                    Prim(PrimitiveType.Cube, body, new Vector3(0, 0.76f, 0.17f), new Vector3(0.3f, 0.12f, 0.04f), "#E8E2D0");
                    Prim(PrimitiveType.Cube, body, new Vector3(0.07f, 0.77f, 0.19f), new Vector3(0.05f, 0.03f, 0.01f), "#8A1410");
                    Prim(PrimitiveType.Sphere, body, new Vector3(-0.28f, 0.3f, 0.02f), new Vector3(0.14f, 0.14f, 0.14f), "#C98A3A");
                    Prim(PrimitiveType.Sphere, body, new Vector3(-0.28f, 0.42f, 0.02f), new Vector3(0.1f, 0.1f, 0.1f), "#C98A3A");
                    break;
                case "support": // gold hair crown
                    Prim(PrimitiveType.Cylinder, body, new Vector3(0, 1.04f, 0.04f), new Vector3(0.2f, 0.06f, 0.2f), "#C9A040", 0.6f);
                    break;
            }
            switch (weaponKind)
            {
                case "sword": weapon = Prim(PrimitiveType.Cube, body, new Vector3(0.3f, 0.6f, 0), new Vector3(0.05f, 0.7f, 0.05f), "#E8EEF5", 1.6f); break;
                case "flute": weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.25f, 0.55f, 0.1f), new Vector3(0.05f, 0.25f, 0.05f), "#9BD17A"); weapon.localRotation = Quaternion.Euler(0, 0, 70); break;
                case "palm": weapon = Prim(PrimitiveType.Sphere, body, new Vector3(0.3f, 0.5f, 0.1f), new Vector3(0.2f, 0.2f, 0.2f), "#9FD8FF", 2f); break;
                case "fan": weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.3f, 0.6f, 0.05f), new Vector3(0.4f, 0.02f, 0.4f), "#FFB347", 0.8f); weapon.localRotation = Quaternion.Euler(80, 0, 0); break;
                case "taiji": weapon = Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.32f, 0), new Vector3(0.22f, 0.22f, 0.22f), "#F2F2F2", 1.5f); break;
                default: weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.28f, 0.55f, 0), new Vector3(0.05f, 0.6f, 0.05f), "#E3B04B"); break;
            }
            if (robeSect == "earth") Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.6f, 0), new Vector3(0.5f, 0.03f, 0.5f), "#E3B04B"); // prayer-bead ring
            orbit = new GameObject("Orbit").transform;
            orbit.SetParent(body, false);
            orbit.localPosition = new Vector3(0, 0.6f, 0);
            if (role == "support")
                foreach (float sx in new[] { -0.45f, 0.45f }) Prim(PrimitiveType.Cube, orbit, new Vector3(sx, 0.2f, 0), new Vector3(0.08f, 0.16f, 0.02f), "#FFD34A", 1.5f);
            TierLook(body, orbit, kit, level);
            for (int i = 0; i < level; i++) Prim(PrimitiveType.Cube, body, new Vector3(-0.15f + i * 0.15f, 1.42f, 0), new Vector3(0.1f, 0.06f, 0.1f), "#E3B04B", 1.5f);
            body.localScale = Vector3.one * FigScale;
            return body;
        }

        // Each tier above the first adds a prop tied to the technique it unlocks, so an upgrade is seen, not just counted.
        void TierLook(Transform body, Transform orbit, string kit, int level)
        {
            if (level < 2) return;
            bool max = level >= 3;
            void Ring(int n, float r, float y, PrimitiveType type, Vector3 size, string hex, float glow)
            {
                for (int i = 0; i < n; i++)
                {
                    float a = i * Mathf.PI * 2 / n;
                    Prim(type, orbit, new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r), size, hex, glow).localRotation = Quaternion.Euler(0, -a * Mathf.Rad2Deg, 0);
                }
            }
            switch (kit)
            {
                case "metal": Ring(max ? 4 : 2, 0.5f, 0.1f, PrimitiveType.Cube, new Vector3(0.04f, 0.42f, 0.04f), "#E8EEF5", 2f); break; // flying swords
                case "fire":
                    foreach (float sx in new[] { -1f, 1f }) // flame wings
                        Prim(PrimitiveType.Cube, body, new Vector3(sx * 0.24f, 0.64f, -0.22f), new Vector3(max ? 0.6f : 0.42f, max ? 0.5f : 0.34f, 0.03f), "#FF5A1F", 2f)
                            .localRotation = Quaternion.Euler(0, sx * 30, sx * -20);
                    if (max) Ring(3, 0.5f, 0.3f, PrimitiveType.Sphere, Vector3.one * 0.08f, "#FFB347", 3f);
                    break;
                case "water":
                    for (int i = 0; i < 6; i++) // ice lotus under the feet
                    {
                        float a = i * Mathf.PI / 3;
                        Prim(PrimitiveType.Cube, body, new Vector3(Mathf.Cos(a) * 0.3f, 0.03f, Mathf.Sin(a) * 0.3f), new Vector3(0.22f, 0.03f, 0.12f), "#9FD8FF", 1.2f)
                            .localRotation = Quaternion.Euler(0, -a * Mathf.Rad2Deg, 0);
                    }
                    if (max) Ring(8, 0.55f, -0.5f, PrimitiveType.Sphere, Vector3.one * 0.08f, "#4FB3FF", 2f); // endless tide
                    break;
                case "wood":
                    foreach (float sx in new[] { -0.1f, 0.1f }) Prim(PrimitiveType.Cylinder, body, new Vector3(sx, 0.14f, 0), new Vector3(0.16f, 0.12f, 0.16f), "#2E7A3C"); // binding vines
                    if (max) Ring(4, 0.5f, 0.05f, PrimitiveType.Cube, new Vector3(0.14f, 0.02f, 0.07f), "#5BC46A", 1.2f); // withering leaves
                    break;
                case "earth":
                    Prim(PrimitiveType.Cylinder, body, new Vector3(0, 1.58f, 0), new Vector3(0.24f, 0.12f, 0.24f), "#C9A040", 1.5f); // golden bell
                    if (max) Ring(4, 0.55f, -0.35f, PrimitiveType.Sphere, Vector3.one * 0.14f, "#4A4038", 0); // quake stones
                    break;
                case "yinyang":
                    Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.58f, 0), Vector3.one * 0.3f, "#F2F2F2", 2f);
                    if (max) Ring(3, 0.45f, 0.35f, PrimitiveType.Cube, new Vector3(0.08f, 0.16f, 0.02f), "#FFD34A", 1.5f); // fortune talismans
                    break;
            }
        }

        // Same look rules as DefendView.DiscipleSprite: a roster unit wears its sect with its kit's weapon.
        static (string robe, string kit) LookOf(string key) =>
            GameData.Units.TryGetValue(key, out var u) ? (u.Sect, u.Element) : (key, key);

        static (string robe, string kit) LookOf(Disciple d) =>
            d.Unit != null ? (d.El, d.Els[0]) : (d.Els[0], d.Els[d.Els.Count - 1]);

        // Rebuild only the figures that are new or whose tier or form changed; everyone else keeps animating.
        public void SyncDisciples(DefendState s)
        {
            int check = s.Disciples.Count;
            foreach (var d in s.Disciples) check = check * 31 + d.Id * 7 + d.Level * 3 + d.Els.Count;
            if (check == discipleCheck) return;
            discipleCheck = check;
            scratchIds.Clear();
            foreach (var kv in disciples)
            {
                var d = s.Disciples.Find(x => x.Id == kv.Key);
                if (d == null || d.Level != kv.Value.Level || d.Els.Count != kv.Value.ElCount) scratchIds.Add(kv.Key);
            }
            foreach (var id in scratchIds)
            {
                var f = disciples[id];
                tileOf.Remove(f.Hit);
                Object.Destroy(f.T.gameObject);
                disciples.Remove(id);
            }
            foreach (var d in s.Disciples)
            {
                if (disciples.ContainsKey(d.Id)) continue;
                var (robe, kit) = LookOf(d);
                var t = BuildFigure(robe, kit, Ui.RoleOf(d), d.Level, false, out var weapon, out var orbit);
                var home = TileTop(d.Tx, d.Ty);
                t.localPosition = home;
                var parts = t.GetComponentsInChildren<Renderer>();
                // A tap on the figure itself selects its tile (otherwise the ray would pass to the tile behind it).
                var hit = t.gameObject.AddComponent<BoxCollider>();
                hit.center = new Vector3(0, 0.75f, 0); hit.size = new Vector3(0.8f, 1.5f, 0.8f);
                tileOf[hit] = new Vector2Int(d.Tx, d.Ty);
                disciples[d.Id] = new Figure
                {
                    T = t, Home = home, Parts = parts, Own = parts.Select(r => r.sharedMaterial).ToArray(), Kit = d.Els[0], Weapon = weapon, Orbit = orbit,
                    WeaponKind = Looks.TryGetValue(kit, out var lk) ? lk[3] : "staff", WRot = weapon.localRotation, WPos = weapon.localPosition, WScale = weapon.localScale,
                    Level = d.Level, ElCount = d.Els.Count, Hit = hit,
                };
            }
        }

        // Each frame: face the nearest enemy, swing the weapon its own way after a hit, spin tier props, grey out while disabled or sealed.
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
                float k = f.Lunge;
                switch (f.WeaponKind)
                {
                    case "sword": f.Weapon.localRotation = Quaternion.Euler(75 * k, 0, 0) * f.WRot; break;     // chop down at the target
                    case "staff": f.Weapon.localRotation = Quaternion.Euler(60 * k, 0, -30 * k) * f.WRot; break; // overhead slam
                    case "fan": f.Weapon.localRotation = Quaternion.Euler(0, -80 * k, 0) * f.WRot; break;      // sweep
                    case "palm": f.Weapon.localPosition = f.WPos + new Vector3(0, 0, 0.3f * k); break;          // push
                    case "flute": f.Weapon.localPosition = f.WPos + new Vector3(0, 0.15f * k, 0); break;        // raise and play
                    case "taiji": f.Weapon.localScale = f.WScale * (1 + 0.5f * k); break;                       // pulse
                }
                f.Orbit.localRotation = Quaternion.Euler(0, Time.time * 90 + f.Home.x * 40, 0);
                float bob = Mathf.Sin(Time.time * 3 + f.Home.x * 1.7f) * 0.03f;
                f.T.localPosition = f.Home + new Vector3(0, bob + k * 0.08f, 0) + face.normalized * k * 0.1f;
            }
        }

        public void RenderEnemies(DefendState s, Dictionary<int, Vector2> prev, float alpha)
        {
            var seen = scratchSeen;
            seen.Clear();
            foreach (var e in s.Enemies)
            {
                seen.Add(e.Id);
                if (!foes.TryGetValue(e.Id, out var f)) foes[e.Id] = f = BuildFoe(e, root);
                var from = prev.TryGetValue(e.Id, out var p) ? p : new Vector2(e.X, e.Y);
                var at = At(Mathf.Lerp(from.x, e.X, alpha), Mathf.Lerp(from.y, e.Y, alpha));
                var ahead = At(e.X, e.Y) - At(from.x, from.y);
                bool stunned = e.StunT > 0;
                float lift = e.Air ? 0.9f + Mathf.Sin(Time.time * 4 + e.Id) * 0.08f : 0.15f + (stunned ? 0 : Mathf.Abs(Mathf.Sin(Time.time * 9 + e.Id)) * 0.05f);
                f.T.localPosition = at + new Vector3(0, lift, 0);
                if (ahead.sqrMagnitude > 0.000001f) f.T.localRotation = Quaternion.LookRotation(ahead);
                float frac = Mathf.Clamp01((float)e.Hp / e.MaxHp);
                f.HpFill.localScale = new Vector3(0.7f * frac, 0.07f, 0.07f);
                f.HpFill.localPosition = new Vector3(-0.35f + 0.35f * frac, 0, 0);
                // The bar hangs from a pivot that ignores the foe's turning, so it always reads left to right.
                f.HpFill.parent.rotation = root.rotation;
                // Status read straight from the sim: burning, poison stacks, slowed, stunned.
                f.Flame.SetActive(e.BurnT > 0);
                int stacks = e.PoisonT > 0 ? Mathf.Min(e.Poison, f.Bubbles.Length) : 0;
                for (int i = 0; i < f.Bubbles.Length; i++)
                {
                    f.Bubbles[i].gameObject.SetActive(i < stacks);
                    if (i < stacks) f.Bubbles[i].localPosition = new Vector3(-0.2f + i * 0.2f, 0.95f + Mathf.Repeat(Time.time * 0.8f + i * 0.33f, 1f) * 0.3f, 0);
                }
                bool slowed = e.SlowT > 0;
                f.Ice.SetActive(slowed);
                // An unrevealed assassin is a dark shadow with no health bar: it cannot be hit until a support or an art reveals it.
                bool hidden = e.Type == "assassin" && !e.Revealed;
                if (slowed != f.Slowed || hidden != f.Hidden)
                {
                    f.Slowed = slowed; f.Hidden = hidden;
                    f.Skin.sharedMaterial = hidden ? Mat("#06050A") : slowed ? Mat("#5A7AA8") : f.SkinMat;
                    f.HpFill.parent.gameObject.SetActive(!hidden);
                }
                f.Stars.gameObject.SetActive(stunned);
                if (stunned) f.Stars.localRotation = Quaternion.Euler(0, Time.time * 360, 0);
            }
            scratchIds.Clear();
            foreach (var id in foes.Keys) if (!seen.Contains(id)) scratchIds.Add(id);
            foreach (var id in scratchIds)
            {
                Object.Destroy(foes[id].T.gameObject);
                foes.Remove(id);
            }
        }

        Foe BuildFoe(Enemy e, Transform parent)
        {
            var def = GameData.Enemies[e.Type];
            var look = FoeLooks.TryGetValue(e.Type, out var l) ? l : FoeLooks["cultist"];
            string robe = e.Elite == "golden" ? "#C9A040" : look[0];
            float size = (def.Boss != null ? 2f : e.Type == "brute" ? 1.35f : e.Type == "runner" ? 0.85f : 1f) * 1.3f;
            if (e.Small) size *= 0.7f;
            var t = new GameObject("e" + e.Id).transform;
            t.SetParent(parent, false);
            var body = new GameObject("Body").transform;
            body.SetParent(t, false);
            body.localScale = Vector3.one * size;
            var skin = Prim(PrimitiveType.Capsule, body, new Vector3(0, 0.3f, 0), new Vector3(0.36f, 0.3f, 0.36f), robe).GetComponent<Renderer>();
            Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.68f, 0), new Vector3(0.3f, 0.3f, 0.3f), look[1]);
            Prim(PrimitiveType.Sphere, body, new Vector3(0.07f, 0.7f, 0.13f), new Vector3(0.06f, 0.06f, 0.06f), look[2], 3f);
            Prim(PrimitiveType.Sphere, body, new Vector3(-0.07f, 0.7f, 0.13f), new Vector3(0.06f, 0.06f, 0.06f), look[2], 3f);
            if (e.Air) Prim(PrimitiveType.Cube, body, new Vector3(0, 0.45f, -0.1f), new Vector3(0.9f, 0.04f, 0.25f), look[1]); // wings
            if (e.Type == "brute") foreach (float sx in new[] { -0.24f, 0.24f }) Prim(PrimitiveType.Cube, body, new Vector3(sx, 0.5f, 0), new Vector3(0.14f, 0.12f, 0.2f), "#5A5664"); // pauldrons
            if (e.Type == "healer") Prim(PrimitiveType.Sphere, body, new Vector3(0.22f, 0.5f, 0.1f), Vector3.one * 0.12f, "#7AFF8A", 2f); // healing orb
            if (e.Type == "puppet") foreach (float sx in new[] { -0.12f, 0.12f }) Prim(PrimitiveType.Cube, body, new Vector3(sx, 0.95f, 0), new Vector3(0.015f, 0.5f, 0.015f), "#C8D4E8", 1f); // strings
            if (e.Type == "assassin") Prim(PrimitiveType.Cube, body, new Vector3(0, 0.32f, -0.16f), new Vector3(0.42f, 0.5f, 0.04f), "#08060A"); // cloak
            if (e.Type == "mimic") Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.42f, 0.17f), Vector3.one * 0.12f, "#E0A0FF", 2.5f); // shifting core
            if (def.Boss != null) Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.88f, 0), new Vector3(0.36f, 0.06f, 0.36f), "#E3B04B", 1.5f); // crown
            if (e.Elite != null) Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.02f, 0), new Vector3(0.7f, 0.01f, 0.7f), e.Elite == "golden" ? "#FFE9A8" : e.Elite == "swift" ? "#9BD17A" : "#D2412F", 1.2f);

            var flame = new GameObject("Burn").transform;
            flame.SetParent(body, false);
            Prim(PrimitiveType.Cube, flame, new Vector3(0.08f, 0.62f, 0), new Vector3(0.12f, 0.2f, 0.12f), "#FF5A1F", 3f).localRotation = Quaternion.Euler(0, 45, 0);
            Prim(PrimitiveType.Cube, flame, new Vector3(-0.08f, 0.56f, 0.04f), new Vector3(0.08f, 0.14f, 0.08f), "#FFD34A", 3f).localRotation = Quaternion.Euler(0, 20, 0);
            var bubbles = new Transform[3]; // poison stacks cap at 3 in the sim
            for (int i = 0; i < 3; i++) bubbles[i] = Prim(PrimitiveType.Sphere, body, Vector3.zero, Vector3.one * 0.08f, "#7AE05A", 2.5f);
            var ice = new GameObject("Slow").transform;
            ice.SetParent(body, false);
            Prim(PrimitiveType.Cube, ice, new Vector3(0.18f, 0.12f, 0.1f), new Vector3(0.1f, 0.22f, 0.1f), "#BFE6FF", 1.5f).localRotation = Quaternion.Euler(0, 45, 15);
            Prim(PrimitiveType.Cube, ice, new Vector3(-0.16f, 0.1f, -0.06f), new Vector3(0.08f, 0.16f, 0.08f), "#BFE6FF", 1.5f).localRotation = Quaternion.Euler(0, 20, -15);
            var stars = new GameObject("Stun").transform;
            stars.SetParent(body, false);
            stars.localPosition = new Vector3(0, 0.95f, 0);
            for (int i = 0; i < 3; i++)
            {
                float a = i * Mathf.PI * 2 / 3;
                Prim(PrimitiveType.Cube, stars, new Vector3(Mathf.Cos(a) * 0.22f, 0, Mathf.Sin(a) * 0.22f), Vector3.one * 0.07f, "#FFD34A", 3f).localRotation = Quaternion.Euler(45, 45, 0);
            }
            flame.gameObject.SetActive(false); ice.gameObject.SetActive(false); stars.gameObject.SetActive(false);
            foreach (var b in bubbles) b.gameObject.SetActive(false);

            var bar = new GameObject("Hp").transform;
            bar.SetParent(t, false);
            bar.localPosition = new Vector3(0, 0.95f * size + 0.15f, 0);
            Prim(PrimitiveType.Cube, bar, Vector3.zero, new Vector3(0.74f, 0.09f, 0.05f), "#1A1423");
            var fill = Prim(PrimitiveType.Cube, bar, new Vector3(0, 0, -0.02f), new Vector3(0.7f, 0.07f, 0.07f), "#D2412F", 1f);
            return new Foe { T = t, HpFill = fill, Flame = flame.gameObject, Ice = ice.gameObject, Stars = stars, Bubbles = bubbles, Skin = skin, SkinMat = skin.sharedMaterial };
        }

        // ---------- shots and sparks ----------

        // Every kit attacks its own way, so a hit tells who made it: a sword-qi streak, an arcing fireball that
        // bursts into a ring the size of its splash, a water orb, a poison needle, a lobbed stone with a ground wave,
        // a support orb that also pulses a ring over its neighbours.
        public void Shot(int fromId, Vector2 toMilli, bool crit)
        {
            if (!disciples.TryGetValue(fromId, out var f)) return;
            string kit = KitVfx.ContainsKey(f.Kit) ? f.Kit : "metal";
            string hex = KitVfx[kit];
            var from = f.Home + new Vector3(0, 0.75f * FigScale, 0);
            var to = At(toMilli.x, toMilli.y) + new Vector3(0, 0.5f, 0);
            float c = crit ? 1.4f : 1f;
            (PrimitiveType, string, float) key; Vector3 size; float dur, arc;
            switch (kit)
            {
                case "metal": key = (PrimitiveType.Cube, hex, 3f); size = new Vector3(0.05f, 0.05f, 0.55f); dur = 0.1f; arc = 0; break;
                case "wood": key = (PrimitiveType.Cube, hex, 2.5f); size = new Vector3(0.035f, 0.035f, 0.32f); dur = 0.14f; arc = 0.1f; break;
                case "fire": key = (PrimitiveType.Sphere, hex, 3f); size = Vector3.one * 0.26f; dur = 0.26f; arc = 0.55f; break;
                case "earth": key = (PrimitiveType.Sphere, hex, 0.3f); size = Vector3.one * 0.28f; dur = 0.3f; arc = 0.8f; break;
                default: key = (PrimitiveType.Sphere, hex, 3f); size = Vector3.one * 0.2f; dur = 0.2f; arc = 0.25f; break;
            }
            var t = Take(key, from, size * c);
            if ((to - from).sqrMagnitude > 0.0001f) t.localRotation = Quaternion.LookRotation(to - from);
            shots.Add(new Bolt { T = t, From = from, To = to, Dur = dur, Arc = arc, Kit = kit, Crit = crit, Key = key });
            if (kit == "yinyang") GrowRing(f.Home + new Vector3(0, 0.1f, 0), 1.2f, hex, 0.35f);
            f.Lunge = 1;
        }

        void Impact(Bolt b)
        {
            var ground = new Vector3(b.To.x, 0.22f, b.To.z);
            switch (b.Kit)
            {
                case "metal": Slash(b.To, b.Crit ? "#FFD34A" : "#E8EEF5", b.Crit); break;
                case "fire": GrowRing(ground, 0.8f, "#FF6A1F", 0.3f); Burst(b.To, "#FF8A3A", 6, 0.1f); break; // splash radius 0.8 tile (Defend.FireSplash)
                case "earth": GrowRing(ground, 1f, "#9A7A54", 0.3f); Burst(b.To, "#6E5A44", 5, 0.12f); break;  // splash radius 1 tile (Defend.EarthSplash)
                case "water": Burst(b.To, "#9FD8FF", 6, 0.09f); break;
                case "wood": Burst(b.To, "#7AE05A", 3, 0.08f); break;
                default: Burst(b.To, KitVfx[b.Kit], 4, 0.09f); break;
            }
            if (b.Crit && b.Kit != "metal") Burst(b.To, "#FFD34A", 6, 0.12f);
        }

        // A crescent cut facing the camera; a crit is a big gold cross.
        void Slash(Vector3 at, string hex, bool cross)
        {
            foreach (float z in cross ? new[] { 45f, -45f } : new[] { 35f })
            {
                var h = new GameObject("slash").transform;
                h.SetParent(root, false);
                h.localPosition = at;
                h.localRotation = cam.transform.localRotation * Quaternion.Euler(0, 0, z);
                Prim(PrimitiveType.Cube, h, Vector3.zero, new Vector3(cross ? 1f : 0.7f, 0.05f, 0.05f), hex, 3f);
                flashes.Add(new Flash { T = h, Life = 0.18f, Max = 0.18f, From = Vector3.one, To = new Vector3(1.3f, 0.2f, 1) });
            }
        }

        // An expanding ring on the ground: shows how wide a splash or a support pulse reaches.
        void GrowRing(Vector3 at, float radius, string hex, float life)
        {
            var h = new GameObject("ring").transform;
            h.SetParent(root, false);
            h.localPosition = at;
            for (int i = 0; i < 16; i++)
            {
                float a = i * Mathf.PI / 8;
                Prim(PrimitiveType.Cube, h, new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)), new Vector3(0.14f, 0.04f, 0.14f), hex, 2.5f);
            }
            flashes.Add(new Flash { T = h, Life = life, Max = life, From = new Vector3(radius * 0.25f, 1, radius * 0.25f), To = new Vector3(radius, 1, radius) });
        }

        public void Burst(Vector3 local, string hex, int count, float size = 0.12f)
        {
            var key = (PrimitiveType.Cube, hex, 2f);
            for (int k = 0; k < count; k++)
            {
                var t = Take(key, local, Vector3.one * size);
                sparks.Add(new Spark { T = t, V = new Vector3(Random.Range(-2f, 2f), Random.Range(1.5f, 3.5f), Random.Range(-2f, 2f)), Life = 0.5f, Size = size * 2, Key = key });
            }
        }

        public Vector3 EnemyAt(int milliX, int milliY) => At(milliX, milliY) + new Vector3(0, 0.4f, 0);
        public Vector3 DiscipleAt(int id) => disciples.TryGetValue(id, out var f) ? f.Home + new Vector3(0, 0.5f, 0) : GoalAt;

        // Floating text (damage, silver) that faces the camera and rises; uses the same font as the HUD.
        public void Number(Vector3 local, string text, string hex, float scale = 1f)
        {
            var font = Ui.Font;
            if (font == null) return;
            var go = new GameObject("num");
            go.transform.SetParent(root, false);
            go.transform.localPosition = local + new Vector3(0, 0.6f, 0);
            go.transform.rotation = cam.transform.rotation;
            var tm = go.AddComponent<TextMesh>();
            tm.font = font; tm.text = text; tm.fontSize = 48; tm.characterSize = 0.06f * scale;
            tm.anchor = TextAnchor.MiddleCenter; tm.color = Art.Hex(hex);
            go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            float life = scale > 1 ? 1.6f : 0.8f;
            floaters.Add(new Floater { T = go.transform, Text = tm, Life = life, Max = life });
        }

        public void Update(float dt, Vector3 shake)
        {
            FollowScreen();
            UpdateSweeps(dt);
            camPos = Vector3.Lerp(camPos, camTarget, 1 - Mathf.Exp(-dt * 10));
            cam.transform.localPosition = camPos + shake;
            for (int i = shots.Count - 1; i >= 0; i--)
            {
                var s = shots[i];
                s.Time += dt / s.Dur;
                var prevPos = s.T.localPosition;
                s.T.localPosition = Vector3.Lerp(s.From, s.To, s.Time) + new Vector3(0, Mathf.Sin(Mathf.Min(1, s.Time) * Mathf.PI) * s.Arc, 0);
                var step = s.T.localPosition - prevPos;
                if (step.sqrMagnitude > 0.000001f) s.T.localRotation = Quaternion.LookRotation(step);
                if (s.Time < 1) continue;
                Impact(s);
                Give(s.Key, s.T); shots.RemoveAt(i);
            }
            for (int i = flashes.Count - 1; i >= 0; i--)
            {
                var f = flashes[i];
                f.Life -= dt;
                f.T.localScale = Vector3.Lerp(f.To, f.From, Mathf.Max(0, f.Life) / f.Max);
                if (f.Life <= 0) { Object.Destroy(f.T.gameObject); flashes.RemoveAt(i); }
            }
            for (int i = sparks.Count - 1; i >= 0; i--)
            {
                var p = sparks[i];
                p.Life -= dt;
                p.V += new Vector3(0, -6f, 0) * dt;
                p.T.localPosition += p.V * dt;
                p.T.localScale = Vector3.one * Mathf.Max(0, p.Life) * p.Size;
                if (p.Life <= 0) { Give(p.Key, p.T); sparks.RemoveAt(i); }
            }
            for (int i = floaters.Count - 1; i >= 0; i--)
            {
                var f = floaters[i];
                f.Life -= dt;
                f.T.localPosition += new Vector3(0, dt * 1.2f, 0);
                var col = f.Text.color; col.a = Mathf.Clamp01(f.Life / f.Max * 2); f.Text.color = col; // fade over the last half
                if (f.Life <= 0) { Object.Destroy(f.T.gameObject); floaters.RemoveAt(i); }
            }
            if (ghost != null) ghost.localScale = Vector3.one * FigScale * (1 + Mathf.Sin(Time.time * 6) * 0.05f);
        }

        // Fire tier 3: a burning bird flies the whole road from the spawn gate to the goal, shedding sparks.
        public void Phoenix()
        {
            if (pathPts.Length < 2) return;
            var bird = new GameObject("Phoenix").transform;
            bird.SetParent(root, false);
            Prim(PrimitiveType.Sphere, bird, Vector3.zero, new Vector3(0.35f, 0.3f, 0.6f), "#FF5A1F", 3f);
            Prim(PrimitiveType.Sphere, bird, new Vector3(0, 0.08f, 0.32f), Vector3.one * 0.18f, "#FFD34A", 3f);
            foreach (float sx in new[] { -1f, 1f })
                Prim(PrimitiveType.Cube, bird, new Vector3(sx * 0.45f, 0.05f, 0), new Vector3(0.7f, 0.04f, 0.35f), "#FF8A3A", 3f).localRotation = Quaternion.Euler(0, 0, sx * 20);
            sweeps.Add(new Sweep { T = bird, Time = 0 });
        }

        void UpdateSweeps(float dt)
        {
            for (int i = sweeps.Count - 1; i >= 0; i--)
            {
                var w = sweeps[i];
                w.Time += dt / 1.6f;
                if (w.Time >= 1) { Object.Destroy(w.T.gameObject); sweeps.RemoveAt(i); continue; }
                float f = w.Time * (pathPts.Length - 1);
                int seg = Mathf.Min(pathPts.Length - 2, (int)f);
                var a = pathPts[seg]; var b = pathPts[seg + 1];
                var pos = Vector3.Lerp(a, b, f - seg);
                if ((b - a).sqrMagnitude > 0.0001f) w.T.localRotation = Quaternion.LookRotation(b - a);
                w.T.localPosition = pos + new Vector3(0, Mathf.Sin(w.Time * 20) * 0.08f, 0);
                if (Random.value < 0.6f) Burst(pos, Random.value < 0.5f ? "#FF6A1F" : "#FFD34A", 1, 0.1f);
            }
        }

        // Secret arts: a strike lands where it hit; the field-wide arts ring the whole board.
        public void ArtFx(string type, Vector3 at)
        {
            var centre = new Vector3(Layouts.GridW / 2f, 0.4f, -Layouts.GridH / 2f);
            switch (type)
            {
                case "strike": GrowRing(new Vector3(at.x, 0.3f, at.z), 2f, "#E8EEF5", 0.4f); Slash(at, "#FFFFFF", true); Burst(at, "#E8EEF5", 18, 0.14f); break;
                case "slowAll": GrowRing(centre, 7f, "#6FC8FF", 0.6f); break;
                case "stunAll": GrowRing(centre, 7f, "#FFD34A", 0.5f); break;
                case "bountyMult": Burst(GoalAt + new Vector3(0, 1, 0), "#E3B04B", 24, 0.12f); break;
            }
        }

        // ---------- placement marks ----------

        // Card portrait: the same figure as on the board, built in a studio off to the side and rendered once
        // into a small point-filtered texture with a clear background, so the card shows the character itself.
        readonly Dictionary<string, RenderTexture> portraits = new Dictionary<string, RenderTexture>();

        public Texture Portrait(string key)
        {
            if (portraits.TryGetValue(key, out var tex)) return tex;
            var (robe, kit) = LookOf(key);
            var fig = BuildFigure(robe, kit, Ui.RoleOf(key), 1, false, out _, out _);
            fig.localRotation = Quaternion.Euler(0, 20, 0);
            return portraits[key] = Snap(fig, 0.92f * FigScale, 0.78f * FigScale);
        }

        // Enemy portrait for the next-wave bar.
        public Texture FoePortrait(string type)
        {
            string key = "foe:" + type;
            if (portraits.TryGetValue(key, out var tex)) return tex;
            var def = GameData.Enemies[type];
            var foe = BuildFoe(new Enemy { Type = type, Air = def.Air, Hp = 1, MaxHp = 1 }, root);
            foe.HpFill.parent.gameObject.SetActive(false);
            foe.T.localRotation = Quaternion.Euler(0, 200, 0);
            float h = def.Boss != null ? 2.6f : 1.3f;
            return portraits[key] = Snap(foe.T, h * 0.55f, h * 0.6f);
        }

        // Render one object, alone in a studio off to the side, into a small point-filtered texture with a clear background.
        RenderTexture Snap(Transform subject, float centreY, float halfHeight)
        {
            subject.localPosition = new Vector3(200, 0, 0);
            var tex = new RenderTexture(96, 120, 16) { filterMode = FilterMode.Point };
            var pc = new GameObject("PortraitCamera").AddComponent<Camera>();
            pc.enabled = false;
            pc.transform.SetParent(root, false);
            pc.orthographic = true;
            pc.orthographicSize = halfHeight;
            pc.transform.localRotation = Quaternion.Euler(14, 180, 0);
            pc.transform.localPosition = subject.localPosition + new Vector3(0, centreY, 0) - pc.transform.forward * 6f;
            pc.clearFlags = CameraClearFlags.SolidColor;
            pc.backgroundColor = new Color(0, 0, 0, 0);
            pc.targetTexture = tex;
            pc.Render();
            pc.targetTexture = null;
            Object.Destroy(pc.gameObject);
            Object.Destroy(subject.gameObject);
            return tex;
        }

        public void ShowGhost(string key, int tx, int ty)
        {
            HideGhost();
            var (robe, kit) = LookOf(key);
            ghost = BuildFigure(robe, kit, Ui.RoleOf(key), 1, true, out _, out _);
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

        public void ShowTileMark(int tx, int ty, string hex = "#E3B04B")
        {
            if (tileMark != null) Object.Destroy(tileMark.gameObject);
            tileMark = new GameObject("TileMark").transform;
            tileMark.SetParent(marks, false);
            tileMark.localPosition = TileTop(tx, ty) + new Vector3(0, 0.02f, 0);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0, 0, 0.47f), new Vector3(1, 0.04f, 0.06f), hex, 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0, 0, -0.47f), new Vector3(1, 0.04f, 0.06f), hex, 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(0.47f, 0, 0), new Vector3(0.06f, 0.04f, 1), hex, 1.5f);
            Prim(PrimitiveType.Cube, tileMark, new Vector3(-0.47f, 0, 0), new Vector3(0.06f, 0.04f, 1), hex, 1.5f);
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
