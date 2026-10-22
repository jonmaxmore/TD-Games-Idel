// Look test: a defend map built as a low-poly 3D diorama from Unity primitives and rendered into a small
// render texture with point filtering, so it reads as pixel art with real depth, light and shadow
// (the "3D pixel" look of the owner's chessboard reference). One disciple per launch sect fights a loop
// of enemies so the sects can be told apart by silhouette, weapon, colour and VFX. No sim, view only.
using System.Collections.Generic;
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace FiveSects.Game
{
    public class Diorama : MonoBehaviour
    {
        public System.Action OnClose;

        static readonly Vector3 Origin = new Vector3(5000, 0, 0); // far from the 2D views the main camera draws
        const int PixelHeight = 360;

        class Unit { public string Sect; public Transform T, Weapon; public Vector3 Home; public float Cd, Lunge; }
        class Foe { public Transform T; public float D; public int Hp; }
        class Shot { public Transform T; public Vector3 From; public Foe Target; public float Time; public Color C; }
        class Spark { public Transform T; public Vector3 V; public float Life; }

        Transform root;
        Camera cam;
        RenderTexture rt;
        RectTransform screen;
        Vector3[] path;
        float pathLen, spawnCd;
        readonly List<Unit> units = new List<Unit>();
        readonly List<Foe> foes = new List<Foe>();
        readonly List<Shot> shots = new List<Shot>();
        readonly List<Spark> sparks = new List<Spark>();
        readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();
        Shader lit;

        static string L(string th, string en) => Ui.L(th, en);

        void Start()
        {
            lit = Shader.Find("Standard") ?? Shader.Find("Legacy Shaders/Diffuse") ?? Shader.Find("Sprites/Default");
            root = new GameObject("Diorama").transform;
            root.position = Origin;
            var layout = Layouts.Get(GameData.Stages["1-1"].Layout, null);
            var pal = GameData.Palette[Layouts.Biomes[layout.Biome].Palette];
            BuildBoard(layout, pal);
            BuildUnits(layout);
            BuildLightAndCamera();
            BuildScreen();
        }

        // ---------- materials and primitives ----------

        Material Mat(string hex, float glow = 0)
        {
            string key = hex + glow;
            if (mats.TryGetValue(key, out var m)) return m;
            m = new Material(lit) { color = Art.Hex(hex) };
            if (glow > 0) { m.EnableKeyword("_EMISSION"); m.SetColor("_EmissionColor", Art.Hex(hex) * glow); }
            mats[key] = m;
            return m;
        }

        Transform Prim(PrimitiveType type, Transform parent, Vector3 pos, Vector3 scale, string hex, float glow = 0)
        {
            var go = GameObject.CreatePrimitive(type);
            Destroy(go.GetComponent<Collider>());
            go.GetComponent<Renderer>().sharedMaterial = Mat(hex, glow);
            var t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = pos;
            t.localScale = scale;
            return t;
        }

        // Board tile (x, y) → local position; y grows away from the camera.
        static Vector3 TilePos(float x, float y) => new Vector3(x + 0.5f, 0, -(y + 0.5f));

        // ---------- board ----------

        void BuildBoard(MapLayout layout, List<string> pal)
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
                    float h = road ? 0.15f : 0.35f + n * 0.35f;
                    string col = road ? pal[3 + ((x + y) & 1)] : pal[(x * 7 + y * 3) % 3];
                    var tile = Prim(PrimitiveType.Cube, root, TilePos(x, y) + new Vector3(0, h / 2, 0), new Vector3(1, h, 1), col);
                    if (!road && n > 0.62f) Prim(PrimitiveType.Sphere, root, tile.localPosition + new Vector3(0.2f, h / 2 + 0.05f, 0.1f), new Vector3(0.25f, 0.12f, 0.25f), pal[6]);
                }
            foreach (var p in layout.Props) BuildProp(p);
            path = new Vector3[layout.Path.Length];
            for (int i = 0; i < path.Length; i++) path[i] = TilePos(layout.Path[i].X, layout.Path[i].Y) + new Vector3(0, 0.15f, 0);
            for (int i = 1; i < path.Length; i++) pathLen += Vector3.Distance(path[i - 1], path[i]);
            // Spawn and goal gates: two posts and a lintel.
            Gate(path[0], "#8A2A5A", 1.2f);
            Gate(path[path.Length - 1], "#E3B04B", 1.2f);
        }

        void Gate(Vector3 at, string glowHex, float glow)
        {
            Prim(PrimitiveType.Cube, root, at + new Vector3(-0.45f, 0.6f, 0), new Vector3(0.12f, 1.2f, 0.12f), "#5A2A20");
            Prim(PrimitiveType.Cube, root, at + new Vector3(0.45f, 0.6f, 0), new Vector3(0.12f, 1.2f, 0.12f), "#5A2A20");
            Prim(PrimitiveType.Cube, root, at + new Vector3(0, 1.25f, 0), new Vector3(1.2f, 0.12f, 0.2f), "#A0302A");
            Prim(PrimitiveType.Sphere, root, at + new Vector3(0, 0.9f, 0), new Vector3(0.3f, 0.3f, 0.3f), glowHex, glow);
            PointLight(at + new Vector3(0, 1f, 0), glowHex, 3f, 1.5f);
        }

        void BuildProp(Prop p)
        {
            var at = TilePos(p.At.X, p.At.Y) + new Vector3(0, 0.5f, 0);
            string t = p.Type ?? "";
            if (t.Contains("lantern"))
            {
                Prim(PrimitiveType.Cylinder, root, at + new Vector3(0, 0.4f, 0), new Vector3(0.08f, 0.4f, 0.08f), "#3A2A20");
                Prim(PrimitiveType.Sphere, root, at + new Vector3(0, 0.9f, 0), new Vector3(0.28f, 0.34f, 0.28f), "#FFB347", 1.5f);
                PointLight(at + new Vector3(0, 1f, 0), "#FFB347", 3f, 1.2f);
            }
            else if (t.Contains("tree") || t.Contains("bamboo") || t.Contains("pine"))
            {
                Prim(PrimitiveType.Cylinder, root, at + new Vector3(0, 0.35f, 0), new Vector3(0.14f, 0.35f, 0.14f), "#4A3020");
                Prim(PrimitiveType.Sphere, root, at + new Vector3(0, 1f, 0), new Vector3(0.9f, 0.8f, 0.9f), "#2E5A30");
                Prim(PrimitiveType.Sphere, root, at + new Vector3(0.15f, 1.35f, -0.1f), new Vector3(0.55f, 0.5f, 0.55f), "#3E7A3C");
            }
            else if (t == "rice")
                for (int i = 0; i < 3; i++) Prim(PrimitiveType.Cube, root, at + new Vector3(-0.3f + i * 0.3f, -0.15f, 0), new Vector3(0.18f, 0.25f, 0.85f), i == 1 ? "#C9C25A" : "#9BB04A");
            else if (t == "flag")
            {
                Prim(PrimitiveType.Cylinder, root, at + new Vector3(0, 0.5f, 0), new Vector3(0.05f, 0.6f, 0.05f), "#3A2A20");
                Prim(PrimitiveType.Cube, root, at + new Vector3(0.22f, 0.9f, 0), new Vector3(0.4f, 0.28f, 0.03f), "#D2412F", 0.3f);
            }
            else if (t == "ice")
                Prim(PrimitiveType.Cube, root, at + new Vector3(0, 0.2f, 0), new Vector3(0.6f, 0.9f, 0.6f), "#BFE6FF", 0.4f);
            else if (t.Contains("rock") || t.Contains("stone") || t == "ruin")
                Prim(PrimitiveType.Sphere, root, at + new Vector3(0, 0.1f, 0), new Vector3(0.8f, 0.5f, 0.7f), "#6E6A78");
            else
            {
                // Houses, shrines, walls and anything else: a block with a red tiled roof.
                Prim(PrimitiveType.Cube, root, at + new Vector3(0, 0.3f, 0), new Vector3(0.85f, 0.7f, 0.85f), "#C9B79A");
                var roof = Prim(PrimitiveType.Cube, root, at + new Vector3(0, 0.8f, 0), new Vector3(0.75f, 0.75f, 1.05f), "#A0302A");
                roof.localRotation = Quaternion.Euler(0, 0, 45);
            }
        }

        void PointLight(Vector3 local, string hex, float range, float intensity)
        {
            var l = new GameObject("Light").AddComponent<Light>();
            l.type = LightType.Point; l.color = Art.Hex(hex); l.range = range; l.intensity = intensity;
            l.transform.SetParent(root, false);
            l.transform.localPosition = local;
        }

        // ---------- units ----------

        // Each sect: robe, trim, hair (null = shaved), weapon kind. Silhouettes differ by weapon and headgear.
        static readonly Dictionary<string, string[]> Looks = new Dictionary<string, string[]>
        {
            ["metal"] = new[] { "#D9E1EA", "#8C99A8", "#2A2030", "sword" },
            ["wood"] = new[] { "#5BC46A", "#2E7A3C", "#1E3A22", "flute" },
            ["water"] = new[] { "#4FB3FF", "#22609C", "#DDE8F5", "palm" },
            ["fire"] = new[] { "#FF5A1F", "#A02A10", "#3A1210", "fan" },
            ["earth"] = new[] { "#D98A2B", "#8A4F18", null, "staff" },
        };

        void BuildUnits(MapLayout layout)
        {
            // Place the five sects on build tiles beside the road, spread along it.
            var blocked = Layouts.Blocked(layout);
            var spots = new List<Vector2Int>();
            for (int i = 1; i < layout.Path.Length && spots.Count < 5; i++)
            {
                var a = layout.Path[i - 1]; var b = layout.Path[i];
                var mid = new Vector2Int((a.X + b.X) / 2, (a.Y + b.Y) / 2);
                foreach (var off in new[] { new Vector2Int(1, 0), new Vector2Int(-1, 0), new Vector2Int(0, 1), new Vector2Int(0, -1) })
                {
                    var c = mid + off;
                    if (c.x < 0 || c.y < 0 || c.x >= Layouts.GridW || c.y >= Layouts.GridH) continue;
                    if (blocked.Contains(c.x + "," + c.y) || OnRoad(layout, c) || spots.Contains(c)) continue;
                    spots.Add(c); break;
                }
            }
            int k = 0;
            foreach (var a in GameData.Allegiance)
            {
                if (k >= spots.Count) break;
                var home = TilePos(spots[k].x, spots[k].y) + new Vector3(0, 0.55f, 0);
                units.Add(Figure(a.Element, home));
                k++;
            }
        }

        static bool OnRoad(MapLayout l, Vector2Int c)
        {
            for (int i = 1; i < l.Path.Length; i++)
            {
                var a = l.Path[i - 1]; var b = l.Path[i];
                if (c.x >= Mathf.Min(a.X, b.X) && c.x <= Mathf.Max(a.X, b.X) && c.y >= Mathf.Min(a.Y, b.Y) && c.y <= Mathf.Max(a.Y, b.Y)) return true;
            }
            return false;
        }

        Unit Figure(string sect, Vector3 home)
        {
            var look = Looks[sect];
            var body = new GameObject(sect).transform;
            body.SetParent(root, false);
            body.localPosition = home;
            // Aura disc under the feet in the sect colour: the quickest read of who is who.
            Prim(PrimitiveType.Cylinder, body, new Vector3(0, -0.02f, 0), new Vector3(0.8f, 0.01f, 0.8f), look[0], 0.6f);
            Prim(PrimitiveType.Cube, body, new Vector3(-0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0.1f, 0.12f, 0), new Vector3(0.12f, 0.24f, 0.12f), look[1]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.42f, 0), new Vector3(0.42f, 0.4f, 0.28f), look[0]);
            Prim(PrimitiveType.Cube, body, new Vector3(0, 0.3f, 0), new Vector3(0.46f, 0.06f, 0.3f), look[1]);
            Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.78f, 0), new Vector3(0.36f, 0.36f, 0.36f), "#F2C9A0");
            if (look[2] != null)
            {
                Prim(PrimitiveType.Sphere, body, new Vector3(0, 0.86f, 0.04f), new Vector3(0.38f, 0.3f, 0.36f), look[2]);
                Prim(PrimitiveType.Sphere, body, new Vector3(0, 1.02f, 0.05f), new Vector3(0.14f, 0.14f, 0.14f), look[2]); // topknot
            }
            Transform weapon;
            switch (look[3])
            {
                case "sword": weapon = Prim(PrimitiveType.Cube, body, new Vector3(0.3f, 0.6f, 0), new Vector3(0.05f, 0.7f, 0.05f), "#E8EEF5", 0.8f); break;
                case "flute": weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.25f, 0.55f, -0.1f), new Vector3(0.05f, 0.25f, 0.05f), "#9BD17A"); weapon.localRotation = Quaternion.Euler(0, 0, 70); break;
                case "palm": weapon = Prim(PrimitiveType.Sphere, body, new Vector3(0.3f, 0.5f, -0.1f), new Vector3(0.2f, 0.2f, 0.2f), "#9FD8FF", 2f); break;
                case "fan": weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.3f, 0.6f, -0.05f), new Vector3(0.4f, 0.02f, 0.4f), "#FFB347", 0.8f); weapon.localRotation = Quaternion.Euler(80, 0, 0); break;
                default: weapon = Prim(PrimitiveType.Cylinder, body, new Vector3(0.28f, 0.55f, 0), new Vector3(0.05f, 0.6f, 0.05f), "#E3B04B"); break;
            }
            if (sect == "earth") Prim(PrimitiveType.Cylinder, body, new Vector3(0, 0.6f, 0), new Vector3(0.5f, 0.03f, 0.5f), "#E3B04B"); // prayer-bead ring
            return new Unit { Sect = sect, T = body, Weapon = weapon, Home = home, Cd = Random.Range(0f, 1f) };
        }

        // ---------- light, camera, screen ----------

        void BuildLightAndCamera()
        {
            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = Art.Hex("#FFE2B8");
            sun.intensity = 1.1f;
            sun.shadows = LightShadows.Soft;
            sun.transform.SetParent(root, false);
            sun.transform.rotation = Quaternion.Euler(50, -35, 0);
            RenderSettings.ambientLight = Art.Hex("#4A4060");

            float aspect = (float)UnityEngine.Screen.width / Mathf.Max(1, UnityEngine.Screen.height);
            rt = new RenderTexture(Mathf.Max(64, Mathf.RoundToInt(PixelHeight * aspect)), PixelHeight, 16) { filterMode = FilterMode.Point };
            cam = new GameObject("DioramaCamera").AddComponent<Camera>();
            cam.transform.SetParent(root, false);
            cam.orthographic = true;
            cam.orthographicSize = 8.2f;
            cam.transform.localRotation = Quaternion.Euler(52, 0, 0);
            cam.transform.localPosition = new Vector3(Layouts.GridW / 2f, 14f, -Layouts.GridH / 2f - 11f);
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Art.Hex("#0B0910");
            cam.targetTexture = rt;
        }

        void BuildScreen()
        {
            screen = Ui.NewScreen("DioramaScreen", "#000000");
            var img = new GameObject("View", typeof(RectTransform), typeof(RawImage));
            var irt = (RectTransform)img.transform;
            irt.SetParent(screen, false);
            irt.anchorMin = Vector2.zero; irt.anchorMax = Vector2.one; irt.offsetMin = Vector2.zero; irt.offsetMax = Vector2.zero;
            img.GetComponent<RawImage>().texture = rt;
            var bar = Ui.Box(screen, "Bar", new Vector2(0, 0), new Vector2(1, 0.07f), "#0E0B14");
            int i = 0;
            foreach (var a in GameData.Allegiance)
            {
                var def = GameData.Sects[a.Element];
                var chip = Ui.Box(bar, "Chip", new Vector2(i / 5f + 0.01f, 0.15f), new Vector2((i + 1) / 5f - 0.01f, 0.85f), "#17121F");
                Ui.Box(chip, "Mark", new Vector2(0, 0), new Vector2(0.08f, 1), def.Color);
                Ui.Label(chip, Ui.Thai ? def.NameTh : a.Element, 16, Vector2.zero, Vector2.one);
                i++;
            }
            Ui.Label(screen, L("ตัวอย่างภาพ 3D pixel (ทดลอง)", "3D pixel look test"), 26, new Vector2(0, 0.94f), new Vector2(0.7f, 1f), "#E3B04B", TextAnchor.MiddleLeft);
            Ui.Btn(screen, L("กลับ", "Back"), new Vector2(0.75f, 0.94f), new Vector2(0.98f, 0.99f), Close, true, "#221C2A", 24);
        }

        public void Close()
        {
            if (cam != null) cam.targetTexture = null;
            if (rt != null) rt.Release();
            if (root != null) Destroy(root.gameObject);
            if (screen != null) Destroy(screen.gameObject);
            foreach (var m in mats.Values) Destroy(m);
            Destroy(gameObject);
            OnClose?.Invoke();
        }

        // ---------- loop ----------

        Vector3 PointOnPath(float d)
        {
            for (int i = 1; i < path.Length; i++)
            {
                float seg = Vector3.Distance(path[i - 1], path[i]);
                if (d <= seg) return Vector3.Lerp(path[i - 1], path[i], d / Mathf.Max(0.001f, seg));
                d -= seg;
            }
            return path[path.Length - 1];
        }

        void Update()
        {
            if (path == null) return;
            float dt = Time.deltaTime;
            spawnCd -= dt;
            if (spawnCd <= 0)
            {
                spawnCd = 1.1f;
                var t = new GameObject("Foe").transform;
                t.SetParent(root, false);
                Prim(PrimitiveType.Capsule, t, new Vector3(0, 0.3f, 0), new Vector3(0.36f, 0.3f, 0.36f), "#5A1820");
                Prim(PrimitiveType.Sphere, t, new Vector3(0, 0.68f, 0), new Vector3(0.3f, 0.3f, 0.3f), "#2A0A10");
                Prim(PrimitiveType.Sphere, t, new Vector3(0.07f, 0.7f, -0.13f), new Vector3(0.06f, 0.06f, 0.06f), "#D2412F", 3f);
                foes.Add(new Foe { T = t, Hp = 6 });
            }
            for (int i = foes.Count - 1; i >= 0; i--)
            {
                var f = foes[i];
                f.D += dt * 1.3f;
                if (f.D >= pathLen) { Destroy(f.T.gameObject); foes.RemoveAt(i); continue; }
                var p = PointOnPath(f.D);
                f.T.localPosition = p + new Vector3(0, Mathf.Abs(Mathf.Sin(f.D * 8)) * 0.06f, 0);
                var ahead = PointOnPath(f.D + 0.2f) - p;
                if (ahead.sqrMagnitude > 0.0001f) f.T.localRotation = Quaternion.LookRotation(ahead);
            }
            foreach (var u in units)
            {
                u.Cd -= dt;
                u.Lunge = Mathf.Max(0, u.Lunge - dt * 4);
                Foe target = null; float best = 9f;
                foreach (var f in foes) { float dd = (f.T.localPosition - u.Home).sqrMagnitude; if (dd < best) { best = dd; target = f; } }
                float bob = Mathf.Sin(Time.time * 3 + u.Home.x) * 0.03f;
                var face = target != null ? target.T.localPosition - u.Home : Vector3.back;
                face.y = 0;
                if (face.sqrMagnitude > 0.0001f) u.T.localRotation = Quaternion.LookRotation(face);
                u.T.localPosition = u.Home + new Vector3(0, bob + u.Lunge * 0.15f, 0) + face.normalized * u.Lunge * 0.2f;
                if (target != null && u.Cd <= 0)
                {
                    u.Cd = 1.2f; u.Lunge = 1;
                    var c = Art.Hex(Looks[u.Sect][0]);
                    var s = Prim(PrimitiveType.Sphere, root, u.Home + new Vector3(0, 0.6f, 0), Vector3.one * 0.18f, Looks[u.Sect][0], 3f);
                    shots.Add(new Shot { T = s, From = s.localPosition, Target = target, C = c });
                }
            }
            for (int i = shots.Count - 1; i >= 0; i--)
            {
                var s = shots[i];
                s.Time += dt * 3f;
                var to = s.Target.T != null ? s.Target.T.localPosition + new Vector3(0, 0.4f, 0) : s.From;
                s.T.localPosition = Vector3.Lerp(s.From, to, s.Time) + new Vector3(0, Mathf.Sin(s.Time * Mathf.PI) * 0.5f, 0);
                if (s.Time < 1) continue;
                Burst(s.T.localPosition, s.C);
                Destroy(s.T.gameObject); shots.RemoveAt(i);
                if (s.Target.T != null && --s.Target.Hp <= 0) { Burst(s.Target.T.localPosition, Art.Hex("#D2412F")); Destroy(s.Target.T.gameObject); foes.Remove(s.Target); s.Target.T = null; }
            }
            for (int i = sparks.Count - 1; i >= 0; i--)
            {
                var p = sparks[i];
                p.Life -= dt;
                p.V += new Vector3(0, -6f, 0) * dt;
                p.T.localPosition += p.V * dt;
                p.T.localScale = Vector3.one * Mathf.Max(0, p.Life) * 0.25f;
                if (p.Life <= 0) { Destroy(p.T.gameObject); sparks.RemoveAt(i); }
            }
        }

        void Burst(Vector3 at, Color c)
        {
            string hex = "#" + ColorUtility.ToHtmlStringRGB(c);
            for (int k = 0; k < 6; k++)
            {
                var t = Prim(PrimitiveType.Cube, root, at, Vector3.one * 0.12f, hex, 2f);
                sparks.Add(new Spark { T = t, V = new Vector3(Random.Range(-2f, 2f), Random.Range(1.5f, 3.5f), Random.Range(-2f, 2f)), Life = 0.5f });
            }
        }
    }
}
