// Unity view for a defend stage: runs the C# sim at 20 Hz, interpolates enemies, draws sprites and a
// uGUI HUD built from code. Mirrors packages/client/src/scenes/DefendScene.ts at prototype depth.
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
#endif

namespace FiveSects.Game
{
    public class DefendView : MonoBehaviour
    {
        public string StageId = "1-1";
        public Flow Flow; // null when the view runs alone (editor tests); set by the front flow

        // Playable in this prototype (defend stages with a layout), in story order. Results screen walks this list.
        public static readonly string[] Playlist = { "1-1", "1-2", "1-4", "1-6", "1-12", "T-1" };

        const int T = 16, OX = 2, OY = 16;
        const float TickSec = 0.05f;

        DefendState s;
        readonly List<Command> pending = new List<Command>();
        float acc;
        int speed = 1;
        readonly Dictionary<int, Vector2> prev = new Dictionary<int, Vector2>();
        readonly Dictionary<int, (SpriteRenderer body, SpriteRenderer hpBg, SpriteRenderer hp)> enemyViews = new Dictionary<int, (SpriteRenderer, SpriteRenderer, SpriteRenderer)>();
        Transform world, discipleRoot;
        SpriteRenderer goalGate;
        float goalFlashUntil;
        SpriteRenderer rangeRing, tileMark, ghost;
        float ringUntil;
        RectTransform hudRoot, resultPanel;
        string discipleSig = null;

        class Shot { public SpriteRenderer R; public Vector2 From, To; public float T; public string El; public bool Crit; }
        Fx fx;
        float hitStopUntil;
        Vector3 camBase;
        bool camBaseSet;
        readonly Dictionary<int, float> popUntil = new Dictionary<int, float>();
        readonly Dictionary<int, string> typeOf = new Dictionary<int, string>();
        Vector2 goalAt;
        readonly List<Shot> shots = new List<Shot>();

        // HUD
        Font font;
        bool thai;
        Text silverText, livesText, waveText, fpsText, toastText, nextText, bossName;
        RectTransform bossBar, bossFill;
        Button waveButton;
        Text waveButtonText;
        float nextFpsUpdate;
        RectTransform panel;
        float toastUntil;
        float fpsSmoothed = 60f;
        float firstFrameAt = -1;

        static Vector3 World(float gx, float gy, float z = 0) => new Vector3(gx, -gy, z);
        static float Gx(int milli) => OX + milli * T / 1000f;
        static float Gy(int milli) => OY + milli * T / 1000f;

        void Start()
        {
            Bootstrap.LoadData();
            s = Defend.Create(StageId, (uint)Random.Range(1, int.MaxValue), Flow != null ? Flow.Profile.Sect : null);
            world = new GameObject("World").transform;
            var biome = Layouts.Biomes[s.Layout.Biome];
            var ground = new GameObject("Ground").AddComponent<SpriteRenderer>();
            ground.sprite = Art.Ground(Layouts.GridW, Layouts.GridH, s.PathTiles, GameData.Palette[biome.Palette]);
            ground.transform.SetParent(world);
            ground.transform.position = World(OX, OY);
            ground.sortingOrder = -10;
            BuildMap(biome);
            discipleRoot = new GameObject("Disciples").transform;
            discipleRoot.SetParent(world);
            rangeRing = MakeOverlay("range-ring", 24);
            tileMark = MakeOverlay("tile-mark", 23);
            ghost = MakeOverlay("ghost", 11);
            BuildHud();
            fx = new Fx(world, font);
            fx.Atmosphere(biome.Time, Layouts.GridW * T, Layouts.GridH * T, new Vector2(OX, OY));
            foreach (var p in s.Layout.Props)
                if (p.Type == "lantern") fx.Light(new Vector2(TileCx(p.At.X), TileBottom(p.At.Y) - 10), "#FFB347", 26, 0.45f);
            var end = s.Layout.Path[s.Layout.Path.Length - 1];
            var start = s.Layout.Path[0];
            goalAt = new Vector2(TileCx(end.X), TileBottom(end.Y) - 10);
            fx.Light(goalAt, "#E3B04B", 40, 0.35f);
            fx.Light(new Vector2(TileCx(start.X), TileBottom(start.Y) - 8), "#8A2A5A", 30, 0.4f);
            Toast(thai ? s.Layout.NameTh : StageId, 2f);
            if (StageId == "T-0" || StageId == "1-1") Toast(L("แตะพื้นข้างถนนเพื่อวางศิษย์", "Tap the ground beside the road to place a disciple"), 5f);
            if (Flow != null) Flow.BattleReady();
        }

        // ---------- loop ----------

        void Update()
        {
            if (firstFrameAt < 0) firstFrameAt = Time.realtimeSinceStartup;
            FitCamera();
            HandleInput();

            if (!s.IsOver)
            {
                // Hit-stop: a crit freezes the sim for a few frames so big hits land with weight.
                if (Time.unscaledTime >= hitStopUntil) acc += Mathf.Min(Time.deltaTime, 0.25f) * speed;
                int steps = 0;
                while (acc >= TickSec && steps < 8 && !s.IsOver)
                {
                    prev.Clear();
                    foreach (var e in s.Enemies) prev[e.Id] = new Vector2(e.X, e.Y);
                    var events = Defend.Step(s, pending.Count > 0 ? pending.ToArray() : System.Array.Empty<Command>());
                    pending.Clear();
                    Handle(events);
                    acc -= TickSec;
                    steps++;
                }
                acc = Mathf.Min(acc, 8 * TickSec);
            }
            SyncDisciples();
            TintDisciples();
            UpdateHints();
            RenderEnemies(Mathf.Clamp01(acc / TickSec));
            UpdateShots();
            fx.Update(Time.deltaTime);
            UpdateHud();
        }

        void FitCamera()
        {
            var cam = Camera.main;
            float aspect = (float)Screen.width / Mathf.Max(1, Screen.height);
            cam.orthographicSize = Mathf.Max(Bootstrap.H / 2f, Bootstrap.W / 2f / aspect);
            if (!camBaseSet) { camBase = cam.transform.position; camBaseSet = true; }
            cam.transform.position = camBase + (fx != null ? fx.ShakeOffset : Vector3.zero);
        }

        // ---------- input ----------

        bool PointerDown(out Vector2 screen)
        {
// Prefer the Input System when present: its UI module reports touches over uGUI correctly.
#if ENABLE_INPUT_SYSTEM
            var p = Pointer.current;
            screen = p != null ? p.position.ReadValue() : Vector2.zero;
            return p != null && p.press.wasPressedThisFrame;
#elif ENABLE_LEGACY_INPUT_MANAGER
            screen = Input.mousePosition;
            return Input.GetMouseButtonDown(0);
#else
            screen = Vector2.zero;
            return false;
#endif
        }

        static bool OverUi()
        {
            var es = EventSystem.current;
            if (es == null) return false;
#if !ENABLE_INPUT_SYSTEM && ENABLE_LEGACY_INPUT_MANAGER
            if (Input.touchCount > 0) return es.IsPointerOverGameObject(Input.GetTouch(0).fingerId);
#endif
            return es.IsPointerOverGameObject();
        }

        void HandleInput()
        {
            if (!PointerDown(out var screen)) return;
            if (OverUi()) return;
            var w = Camera.main.ScreenToWorldPoint(new Vector3(screen.x, screen.y, 10));
            float gx = w.x, gy = -w.y;
            int tx = Mathf.FloorToInt((gx - OX) / T), ty = Mathf.FloorToInt((gy - OY) / T);
            ClosePanel();
            if (tx < 0 || ty < 0 || tx >= Layouts.GridW || ty >= Layouts.GridH) return;
            if (pending.Any(c => c.T == "place" && c.Tx == tx && c.Ty == ty)) return;
            var d = s.Disciples.FirstOrDefault(q => q.Tx == tx && q.Ty == ty);
            if (d != null) OpenDisciplePanel(d);
            else if (Defend.CanBuild(s, tx, ty)) OpenBuildPanel(tx, ty);
        }

        // ---------- events ----------

        void Handle(List<SimEvent> events)
        {
            foreach (var ev in events)
            {
                switch (ev.E)
                {
                    case "hit":
                    {
                        var d = s.Disciples.FirstOrDefault(q => q.Id == ev.From);
                        Vector2 to;
                        var en = s.Enemies.FirstOrDefault(q => q.Id == ev.To);
                        if (en != null) to = new Vector2(en.X, en.Y);
                        else if (!prev.TryGetValue(ev.To, out to)) break;
                        if (d == null) break;
                        Shoot(new Vector2(Gx(d.X), Gy(d.Y) - 4), new Vector2(Gx((int)to.x), Gy((int)to.y) - 4), ev.El, ev.Crit);
                        popUntil[d.Id] = Time.time + 0.08f;
                        if (ev.Crit)
                        {
                            hitStopUntil = Time.unscaledTime + 0.04f;
                            fx.Number(new Vector2(Gx((int)to.x), Gy((int)to.y) - 12), ev.Dmg + "!", "#FFD34A");
                        }
                        break;
                    }
                    case "wave": Toast("Wave " + ev.Wave, 1.2f); break;
                    case "newEnemy": Toast(L("ศัตรูใหม่: ", "New enemy: ") + (thai ? GameData.Enemies[ev.Type].NameTh : ev.Type), 2f); break;
                    case "picked": Toast(L("คัมภีร์: ", "Manual: ") + ev.Name, 2f); break;
                    case "error": if (ev.Msg == "not enough silver") Toast(L("ตำลึงไม่พอ", "Not enough silver"), 1f); break;
                    case "leak": LeakToast(ev.Id); goalFlashUntil = Time.time + 0.25f; fx.Shake(2.5f); fx.Burst(goalAt, "#D2412F", 0.6f); break;
                    case "kill":
                    {
                        var at = new Vector2(Gx(ev.X), Gy(ev.Y) - 4);
                        bool boss = typeOf.TryGetValue(ev.Id, out var t) && GameData.Enemies[t].Boss != null;
                        fx.Death(at, boss);
                        fx.Coin(at, ev.Amount);
                        break;
                    }
                    case "combo":
                    {
                        var d = s.Disciples.FirstOrDefault(q => q.Id == ev.Id);
                        if (d != null) fx.Burst(new Vector2(Gx(d.X), Gy(d.Y) - 4), "#E3B04B", 1.2f);
                        Toast(ev.Name, 1.5f);
                        break;
                    }
                    case "seal": fx.Shake(3); fx.Burst(new Vector2(Bootstrap.W / 2f, Bootstrap.H / 2f), "#8A1A1A", 1.5f); Toast(L("บอสผนึก ", "Boss sealed ") + (thai ? GameData.Sects[ev.El].NameTh : ev.El) + L(" ชั่วคราว!", " for a while!"), 2.5f); break;
                    case "disable": fx.Shake(2); Toast(L("อาวุธลับ! ศิษย์ถูกสกัด", "Hidden weapon! A disciple is disabled"), 1.5f); break;
                    case "end":
                        ClosePanel();
                        ShowResult(ev.Won, ev.Stars);
                        break;
                }
            }
        }

        void Shoot(Vector2 from, Vector2 to, string el, bool crit)
        {
            var r = new GameObject("shot").AddComponent<SpriteRenderer>();
            r.transform.SetParent(world);
            // Glowing bolt: a soft halo in the sect colour; UpdateShots leaves a trail and bursts on arrival.
            r.sprite = Art.Glow();
            var c = Art.Hex(GameData.Sects[el].Color);
            r.color = c;
            float sc = crit ? 0.45f : 0.3f;
            r.transform.localScale = new Vector3(sc, sc, 1);
            r.sortingOrder = 30;
            shots.Add(new Shot { R = r, From = from, To = to, T = 0, El = el, Crit = crit });
        }

        void UpdateShots()
        {
            for (int i = shots.Count - 1; i >= 0; i--)
            {
                var sh = shots[i];
                sh.T += Time.deltaTime / 0.12f;
                var p = Vector2.Lerp(sh.From, sh.To, sh.T);
                sh.R.transform.position = World(p.x, p.y);
                fx.Trail(sh.El, p, sh.Crit);
                if (sh.T >= 1) { fx.Impact(sh.El, sh.To, sh.Crit); Destroy(sh.R.gameObject); shots.RemoveAt(i); }
            }
        }

        // ---------- map ----------

        SpriteRenderer MakeSprite(string name, Sprite sp, float gx, float gy, int order)
        {
            var r = new GameObject(name).AddComponent<SpriteRenderer>();
            r.sprite = sp; r.sortingOrder = order;
            r.transform.SetParent(world);
            r.transform.position = World(gx, gy);
            return r;
        }

        // Tile (tx, ty) bottom edge in game pixels; sprites with a bottom-centre pivot stand on it.
        static float TileCx(int tx) => OX + tx * T + T / 2f;
        static float TileBottom(int ty) => OY + (ty + 1) * T;

        void BuildMap(BiomeDef biome)
        {
            foreach (var p in s.Layout.Props)
                MakeSprite("prop-" + p.Type, Art.Prop(p.Type), TileCx(p.At.X), TileBottom(p.At.Y), p.Type == "roof" || p.Type == "rice" ? -5 : 5 + p.At.Y);
            var start = s.Layout.Path[0];
            var end = s.Layout.Path[s.Layout.Path.Length - 1];
            MakeSprite("spawn-gate", Art.Gate(biome.SpawnGate, false), TileCx(start.X), TileBottom(start.Y) + 2, -4);
            goalGate = MakeSprite("goal-gate", Art.Gate(s.Layout.GoalGate ?? biome.GoalGate, true), TileCx(end.X), TileBottom(end.Y) + 2, 25);
        }

        // Placement feedback instead of markers on every tile: the tapped tile is framed, and a disciple's
        // attack range shows as a ring in its sect colour while its panel is open and briefly after placing.
        SpriteRenderer MakeOverlay(string name, int order)
        {
            var r = new GameObject(name).AddComponent<SpriteRenderer>();
            r.sortingOrder = order;
            r.transform.SetParent(world);
            r.enabled = false;
            return r;
        }

        Vector3 TileCentre(int tx, int ty) => World(OX + tx * T + T / 2f, OY + ty * T + T / 2f);

        void ShowRing(int tx, int ty, int rangeMilli, string color, float seconds)
        {
            rangeRing.sprite = Art.Ring(Mathf.RoundToInt(rangeMilli * T / 1000f));
            rangeRing.color = Art.Hex(color);
            rangeRing.transform.position = TileCentre(tx, ty);
            rangeRing.enabled = true;
            ringUntil = seconds > 0 ? Time.time + seconds : float.MaxValue;
        }

        void ShowTileMark(int tx, int ty)
        {
            tileMark.sprite = Art.TileMark(T);
            tileMark.transform.position = TileCentre(tx, ty);
            tileMark.enabled = true;
        }

        void HideMarks() { rangeRing.enabled = false; tileMark.enabled = false; ghost.enabled = false; }

        void UpdateHints()
        {
            if (rangeRing.enabled && panel == null && Time.time > ringUntil) rangeRing.enabled = false;
            if (goalGate != null) goalGate.color = Time.time < goalFlashUntil ? new Color(1f, 0.4f, 0.4f) : Color.white;
        }

        // ---------- rendering ----------

        void SyncDisciples()
        {
            string sig = string.Join("|", s.Disciples.Select(d => d.Id + ":" + d.Level + ":" + string.Join("", d.Els)));
            if (sig == discipleSig) return;
            discipleSig = sig;
            foreach (Transform c in discipleRoot) Destroy(c.gameObject);
            foreach (var d in s.Disciples)
            {
                var r = new GameObject("d" + d.Id).AddComponent<SpriteRenderer>();
                r.sprite = DiscipleSprite(d);
                r.transform.SetParent(discipleRoot);
                r.transform.position = World(Gx(d.X), Gy(d.Y) - 1);
                r.sortingOrder = 10;
                for (int i = 0; i < d.Level; i++)
                {
                    var pip = new GameObject("pip").AddComponent<SpriteRenderer>();
                    pip.sprite = Art.Pixel(); pip.color = Art.Hex("#E3B04B");
                    pip.transform.SetParent(discipleRoot);
                    pip.transform.position = World(Gx(d.X) - 3 + i * 3, Gy(d.Y) + 7);
                    pip.transform.localScale = new Vector3(2, 1, 1);
                    pip.sortingOrder = 11;
                }
            }
        }

        void TintDisciples()
        {
            foreach (var d in s.Disciples)
            {
                var t = discipleRoot.Find("d" + d.Id);
                if (t == null) continue;
                bool off = d.OffT > 0 || (s.SealT > 0 && s.SealEl != null && d.Els.Contains(s.SealEl));
                t.GetComponent<SpriteRenderer>().color = off ? new Color(0.45f, 0.45f, 0.55f) : Color.white;
                float pop = popUntil.TryGetValue(d.Id, out var until) && Time.time < until ? 1.2f : 1f; // attack squash
                t.localScale = new Vector3(pop, 2f - pop, 1);
            }
        }

        void RenderEnemies(float alpha)
        {
            var seen = new HashSet<int>();
            foreach (var e in s.Enemies)
            {
                seen.Add(e.Id);
                if (!enemyViews.TryGetValue(e.Id, out var v))
                {
                    var body = new GameObject("e" + e.Id).AddComponent<SpriteRenderer>();
                    body.transform.SetParent(world);
                    body.sprite = Art.Enemy(e.Type); body.sortingOrder = 20;
                    typeOf[e.Id] = e.Type;
                    if (GameData.Enemies[e.Type].Boss != null) { body.transform.localScale = new Vector3(2, 2, 1); body.color = Art.Hex("#FF9E7B"); }
                    SpriteRenderer Bar(string col, int order)
                    {
                        var b = new GameObject("bar").AddComponent<SpriteRenderer>();
                        b.sprite = Art.Pixel(); b.color = Art.Hex(col); b.sortingOrder = order;
                        b.transform.SetParent(body.transform);
                        return b;
                    }
                    v = (body, Bar("#1A1423", 21), Bar("#D2412F", 22));
                    if (e.Elite != null) body.color = Art.Hex(e.Elite == "golden" ? "#FFE9A8" : e.Elite == "swift" ? "#D8FFC8" : "#FFC8C8");
                    enemyViews[e.Id] = v;
                }
                var from = prev.TryGetValue(e.Id, out var p) ? p : new Vector2(e.X, e.Y);
                float x = Gx((int)Mathf.Lerp(from.x, e.X, alpha)), y = Gy((int)Mathf.Lerp(from.y, e.Y, alpha));
                v.body.transform.position = World(Mathf.Round(x), Mathf.Round(y - 2));
                float frac = Mathf.Clamp01((float)e.Hp / e.MaxHp);
                v.hpBg.transform.localPosition = new Vector3(0, 10, 0); v.hpBg.transform.localScale = new Vector3(10, 2, 1);
                v.hp.transform.localPosition = new Vector3(-5 + 5 * frac, 10, 0); v.hp.transform.localScale = new Vector3(10 * frac, 2, 1);
            }
            foreach (var id in enemyViews.Keys.Where(id => !seen.Contains(id)).ToList())
            {
                Destroy(enemyViews[id].body.gameObject);
                enemyViews.Remove(id);
            }
        }

        // ---------- HUD (uGUI built from code) ----------

        string L(string th, string en) => thai ? th : en;

        void BuildHud()
        {
            font = Resources.Load<Font>("Fonts/Sarabun-Regular");
            thai = font != null;
            if (font == null) font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

            if (EventSystem.current == null)
            {
                var es = new GameObject("EventSystem").AddComponent<EventSystem>();
#if ENABLE_INPUT_SYSTEM
                es.gameObject.AddComponent<InputSystemUIInputModule>();
#else
                es.gameObject.AddComponent<StandaloneInputModule>();
#endif
            }
            var canvasGo = new GameObject("HUD", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(720, 1280);
            scaler.matchWidthOrHeight = 1f;
            var root = (RectTransform)canvasGo.transform;
            hudRoot = root;

            var top = Box(root, "Top", new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -64), Vector2.zero, "#0E0B14");
            silverText = Label(top, "", 28, new Vector2(0, 0), new Vector2(0.35f, 1), "#E3B04B");
            livesText = Label(top, "", 28, new Vector2(0.35f, 0), new Vector2(0.55f, 1), "#D2412F");
            waveText = Label(top, "", 28, new Vector2(0.8f, 0), new Vector2(1, 1), "#ECE3CF");
            var speedBtn = MakeButton(top, "x1", new Vector2(0.56f, 0.1f), new Vector2(0.78f, 0.9f), null);
            speedBtn.onClick.AddListener(() => { speed = speed % 3 + 1; speedBtn.GetComponentInChildren<Text>().text = "x" + speed; });

            var bottom = Box(root, "Bottom", new Vector2(0, 0), new Vector2(1, 0), Vector2.zero, new Vector2(0, 64), "#0E0B14");
            waveButton = MakeButton(bottom, L("เริ่มบุก", "Start wave"), new Vector2(0.02f, 0.1f), new Vector2(0.6f, 0.9f), () => pending.Add(new Command { T = "nextWave" }));
            waveButtonText = waveButton.GetComponentInChildren<Text>();
            fpsText = Label(bottom, "", 20, new Vector2(0.62f, 0), new Vector2(0.98f, 1), "#9A92AE");

            if (s.Sect != null)
            {
                // The player's sect colours the HUD: a band under the top bar with the sect name.
                var band = Box(root, "SectBand", new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -68), new Vector2(0, -64), GameData.Sects[s.Sect].Color);
                band.GetComponent<Image>().raycastTarget = false;
            }
            nextText = Label(root, "", 20, new Vector2(0, 1), new Vector2(1, 1), "#9A92AE");
            nextText.rectTransform.offsetMin = new Vector2(12, -92); nextText.rectTransform.offsetMax = new Vector2(-12, -64);
            bossBar = Box(root, "BossBar", new Vector2(0.1f, 1), new Vector2(0.9f, 1), new Vector2(0, -124), new Vector2(0, -96), "#1A1423");
            bossFill = Box(bossBar, "Fill", Vector2.zero, Vector2.one, new Vector2(2, 2), new Vector2(-2, -2), "#D2412F");
            bossName = Label(bossBar, "", 20, Vector2.zero, Vector2.one, "#ECE3CF");
            bossName.alignment = TextAnchor.MiddleCenter;
            bossBar.gameObject.SetActive(false);
            toastText = Label(root, "", 30, new Vector2(0, 0.62f), new Vector2(1, 0.7f), "#ECE3CF");
            toastText.alignment = TextAnchor.MiddleCenter;
        }

        RectTransform Box(RectTransform parent, string name, Vector2 aMin, Vector2 aMax, Vector2 offMin, Vector2 offMax, string color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            var rt = (RectTransform)go.transform;
            rt.SetParent(parent, false);
            rt.anchorMin = aMin; rt.anchorMax = aMax; rt.offsetMin = offMin; rt.offsetMax = offMax;
            go.GetComponent<Image>().color = Art.Hex(color);
            return rt;
        }

        Text Label(RectTransform parent, string text, int size, Vector2 aMin, Vector2 aMax, string color)
        {
            var go = new GameObject("Text", typeof(RectTransform), typeof(Text));
            var rt = (RectTransform)go.transform;
            rt.SetParent(parent, false);
            rt.anchorMin = aMin; rt.anchorMax = aMax; rt.offsetMin = new Vector2(12, 0); rt.offsetMax = new Vector2(-12, 0);
            var t = go.GetComponent<Text>();
            t.font = font; t.fontSize = size; t.text = text; t.color = Art.Hex(color); t.alignment = TextAnchor.MiddleLeft;
            t.raycastTarget = false;
            return t;
        }

        Button MakeButton(RectTransform parent, string text, Vector2 aMin, Vector2 aMax, UnityEngine.Events.UnityAction onClick, bool enabled = true)
        {
            var rt = Box(parent, "Button", aMin, aMax, Vector2.zero, Vector2.zero, enabled ? "#3A2A14" : "#221C2A");
            var b = rt.gameObject.AddComponent<Button>();
            b.interactable = enabled;
            if (onClick != null) b.onClick.AddListener(onClick);
            var t = Label(rt, text, 24, Vector2.zero, Vector2.one, enabled ? "#ECE3CF" : "#9A92AE");
            t.alignment = TextAnchor.MiddleCenter;
            return b;
        }

        void ClosePanel() { if (panel != null) Destroy(panel.gameObject); panel = null; HideMarks(); }

        // The panel opens on the half of the screen away from the tapped tile so it never hides it.
        RectTransform OpenPanel(int ty)
        {
            ClosePanel();
            panel = ty < Layouts.GridH / 2
                ? Box(hudRoot, "Panel", new Vector2(0.02f, 0), new Vector2(0.98f, 0), new Vector2(0, 72), new Vector2(0, 232), "#17121F")
                : Box(hudRoot, "Panel", new Vector2(0.02f, 1), new Vector2(0.98f, 1), new Vector2(0, -232), new Vector2(0, -72), "#17121F");
            return panel;
        }

        // Two-step placement: picking a disciple previews it on the tile (ghost + attack range) with the facts the choice
        // needs (role, damage per second, range, air, which enemies it answers); only Confirm places it (SPEC-core §2.1).
        void OpenBuildPanel(int tx, int ty, string choice = null)
        {
            var p = OpenPanel(ty);
            ShowTileMark(tx, ty);
            int n = s.Unlocked.Count;
            for (int i = 0; i < n; i++)
            {
                string key = s.Unlocked[i];
                var kd = GameData.DefOf(key);
                var b = MakeButton(p, (thai ? kd.NameTh : key) + "  " + Defend.PlaceCost(key), new Vector2((float)i / n + 0.01f, 0.66f), new Vector2((float)(i + 1) / n - 0.01f, 0.96f),
                    () => OpenBuildPanel(tx, ty, key));
                var bt = b.GetComponentInChildren<Text>(); bt.fontSize = n > 4 ? 16 : 22;
                if (key == choice) { var c = Art.Hex(kd.Color); b.GetComponent<Image>().color = new Color(c.r * 0.6f, c.g * 0.6f, c.b * 0.6f, 1); }
            }
            if (choice == null)
            {
                var hint = Label(p, L("เลือกศิษย์เพื่อดูระยะและข้อมูลก่อนวาง", "Pick a disciple to preview it"), 22, new Vector2(0, 0.06f), new Vector2(1, 0.6f), "#9A92AE");
                hint.alignment = TextAnchor.MiddleCenter;
                return;
            }
            var def = GameData.DefOf(choice);
            int cost = Defend.PlaceCost(choice);
            ShowRing(tx, ty, def.Range, def.Color, 0);
            ghost.sprite = DiscipleSprite(choice);
            ghost.transform.position = World(OX + tx * T + T / 2f, OY + ty * T + T / 2f - 1);
            ghost.color = new Color(1, 1, 1, 0.6f);
            ghost.enabled = true;
            var info = Label(p, Facts(choice), 18, new Vector2(0, 0.36f), new Vector2(1, 0.64f), "#ECE3CF");
            info.alignment = TextAnchor.MiddleCenter;
            MakeButton(p, L("ยกเลิก", "Cancel"), new Vector2(0.01f, 0.04f), new Vector2(0.35f, 0.34f), ClosePanel);
            MakeButton(p, L("ยืนยันวาง ", "Place ") + (thai ? def.NameTh : choice) + "  " + cost, new Vector2(0.37f, 0.04f), new Vector2(0.99f, 0.34f),
                () =>
                {
                    pending.Add(new Command { T = "place", Sect = choice, Tx = tx, Ty = ty }); ClosePanel();
                    ShowRing(tx, ty, def.Range, def.Color, 1.5f);
                    if (Flow != null) Flow.FirstPlace();
                }, s.Silver >= cost);
        }

        // Legacy element disciples map onto the five roles by their mechanic.
        static readonly Dictionary<string, string> KitRole = new Dictionary<string, string>
        { ["metal"] = "striker", ["fire"] = "burst", ["water"] = "control", ["earth"] = "control", ["wood"] = "stacker", ["yinyang"] = "support" };

        static string RoleOf(string key) => GameData.Units.TryGetValue(key, out var u) ? u.RoleId : KitRole.TryGetValue(key, out var r) ? r : null;

        string Facts(string key)
        {
            var d = GameData.DefOf(key);
            string role = RoleOf(key);
            var rd = role != null && GameData.RoleDefs.TryGetValue(role, out var x) ? x : null;
            float dps = d.Dmg * 20f / Mathf.Max(1, d.Cooldown);
            string line1 = (rd != null ? (thai ? rd.NameTh : role) + " · " : "") + L("ดาเมจ ", "DPS ") + dps.ToString("0") + L("/วิ · ระยะ ", " · range ") + (d.Range / 1000f).ToString("0.0")
                + (d.HitsAir ? L(" · ตีอากาศได้", " · hits air") : L(" · ตีอากาศไม่ได้", " · ground only"));
            if (rd == null || rd.Counters.Count == 0) return line1;
            var names = rd.Counters.Select(id => id == "boss" ? L("บอส", "bosses") : GameData.Enemies.TryGetValue(id, out var e) ? (thai ? e.NameTh : id) : id);
            return line1 + "\n" + L("เก่งกับ: ", "Good vs: ") + string.Join(", ", names);
        }

        // A roster unit wears its sect's colours with its kit's weapon; legacy disciples use their element look.
        static Sprite DiscipleSprite(string key) => GameData.Units.TryGetValue(key, out var u) ? Art.Unit(u.Sect, u.Element) : Art.Disciple(new List<string> { key });

        static Sprite DiscipleSprite(Disciple d) => d.Unit != null ? Art.Unit(d.El, d.Els[0]) : Art.Disciple(d.Els);

        void OpenDisciplePanel(Disciple d)
        {
            var p = OpenPanel(d.Ty);
            ShowRing(d.Tx, d.Ty, d.Els.Max(el => GameData.Sects[el].Range), GameData.Sects[d.Els[0]].Color, 0);
            int up = Defend.UpgradeCost(d);
            bool canUp = d.Combo == null && d.Level < GameData.UpgradeLevels;
            MakeButton(p, canUp ? L("อัปเกรด ", "Upgrade ") + up : L("เต็มแล้ว", "Max level"), new Vector2(0.02f, 0.1f), new Vector2(0.49f, 0.9f),
                () => { pending.Add(new Command { T = "upgrade", Id = d.Id }); ClosePanel(); }, canUp && s.Silver >= up);
            MakeButton(p, L("ขาย +", "Sell +") + Defend.SellValue(d, s), new Vector2(0.51f, 0.1f), new Vector2(0.98f, 0.9f),
                () => { pending.Add(new Command { T = "sell", Id = d.Id }); ClosePanel(); });
        }

        void ShowResult(bool won, List<bool> stars)
        {
            resultPanel = Box(hudRoot, "Result", new Vector2(0.08f, 0.3f), new Vector2(0.92f, 0.7f), Vector2.zero, Vector2.zero, "#17121F");
            var title = Label(resultPanel, won ? L("ชนะ!", "Victory!") : L("พ่ายแพ้", "Defeat"), 48, new Vector2(0, 0.72f), new Vector2(1, 0.95f), won ? "#E3B04B" : "#D2412F");
            title.alignment = TextAnchor.MiddleCenter;
            var conds = GameData.Stages[StageId].Stars;
            for (int i = 0; i < stars.Count; i++)
            {
                var line = Label(resultPanel, (stars[i] ? "[*] " : "[ ] ") + (i < conds.Count ? StarName(conds[i]) : ""), 26,
                    new Vector2(0.1f, 0.6f - i * 0.11f), new Vector2(0.95f, 0.7f - i * 0.11f), stars[i] ? "#E3B04B" : "#9A92AE");
                line.alignment = TextAnchor.MiddleLeft;
            }
            int idx = System.Array.IndexOf(Playlist, StageId);
            string next = idx >= 0 && idx + 1 < Playlist.Length ? Playlist[idx + 1] : null;
            if (Flow != null)
            {
                Flow.StageEnded(StageId, won, stars);
                bool tutorial = StageId == Flow.TutorialStage;
                MakeButton(resultPanel, L("เล่นอีกครั้ง", "Retry"), new Vector2(0.03f, 0.05f), new Vector2(0.48f, 0.22f), () => Load(StageId));
                MakeButton(resultPanel, tutorial ? L("เลือกสำนัก", "Choose a sect") : L("ลานสำนัก", "Lobby"), new Vector2(0.52f, 0.05f), new Vector2(0.97f, 0.22f), Flow.LeaveBattle);
                return;
            }
            MakeButton(resultPanel, L("เล่นอีกครั้ง", "Retry"), new Vector2(0.05f, 0.05f), new Vector2(0.48f, 0.22f), () => Load(StageId));
            if (won && next != null)
                MakeButton(resultPanel, L("ด่านถัดไป ", "Next: ") + next, new Vector2(0.52f, 0.05f), new Vector2(0.95f, 0.22f), () => Load(next));
            else if (!won && idx > 0)
                MakeButton(resultPanel, L("ด่านก่อนหน้า", "Previous"), new Vector2(0.52f, 0.05f), new Vector2(0.95f, 0.22f), () => Load(Playlist[idx - 1]));
        }

        string StarName(string id)
        {
            switch (id)
            {
                case "clear": return L("ผ่านด่าน", "Clear the stage");
                case "no_life_lost": return L("ไม่เสียชีวิตเลย", "No lives lost");
                case "under_3min": return L("ผ่านภายใน 3 นาที", "Under 3 minutes");
                case "hold_200_silver": return L("ถือตำลึง 200 ขึ้นไป", "Hold 200+ silver");
                case "use_combo": return L("ใช้ยุทธ์ผสาน", "Use a combo");
                case "max_2_sects": return L("ใช้ไม่เกิน 2 สำนัก", "At most 2 sects");
                default: return id;
            }
        }

        // Swap to another stage without reloading the scene: drop this view's world + HUD and start a fresh view.
        void Load(string stageId)
        {
            Close();
            if (Flow != null) { Flow.StartStage(stageId); return; }
            new GameObject("Five Sects").AddComponent<DefendView>().StageId = stageId;
        }

        public void Close()
        {
            Destroy(world.gameObject);
            Destroy(hudRoot.gameObject);
            Destroy(gameObject);
        }

        // Calling mid-fight overlaps waves for a bonus (defend.ts nextWave); show what it pays right now.
        string WaveButtonLabel()
        {
            if (s.IsOver) return "";
            if (s.Wave >= s.TotalWaves) return L("wave สุดท้าย", "Final wave");
            if (s.Phase == "build") return L("เริ่มบุก", "Start wave");
            if (s.Phase == "picking") return L("เลือกคัมภีร์...", "Pick a manual...");
            if (s.Phase == "break") return L("wave ถัดไป +", "Next wave +") + GameData.EarlyCallBonus;
            int atStake = 0;
            foreach (var e in s.Enemies) if (e.Hp > 0) atStake += e.Bounty;
            return L("เรียกเพิ่ม +", "Call early +") + (GameData.EarlyCallBonus + atStake * GameData.EarlyCallPct / 100);
        }

        string RecipeName(string id)
        {
            var r = GameData.WaveRecipes.FirstOrDefault(x => x.Id == id);
            return r == null ? id : thai ? r.NameTh : r.Id;
        }

        bool NextIsBoss() => GameData.Stages[StageId].ScriptedWaves.ContainsKey((s.Wave + 1).ToString());

        void UpdateBossBar()
        {
            var boss = s.Enemies.FirstOrDefault(e => GameData.Enemies[e.Type].Boss != null);
            bossBar.gameObject.SetActive(boss != null);
            if (boss == null) return;
            bossFill.anchorMax = new Vector2(Mathf.Clamp01((float)boss.Hp / boss.MaxHp), 1);
            bossName.text = (thai ? GameData.Enemies[boss.Type].NameTh : boss.Type) + (s.SealT > 0 ? L("  ผนึก: ", "  sealed: ") + (thai ? GameData.Sects[s.SealEl].NameTh : s.SealEl) : "");
        }

        void Toast(string msg, float seconds) { toastText.text = msg; toastUntil = Time.time + seconds; }

        // Next-wave bar: which roles answer the coming shape; a missing one shows in red (SPEC-core §2.2).
        string Needs()
        {
            var rec = GameData.WaveRecipes.FirstOrDefault(r => r.Id == s.NextRecipe);
            if (rec == null || rec.NeedsRoles.Count == 0) return "";
            var parts = new List<string>();
            foreach (var need in rec.NeedsRoles)
            {
                bool have = need == "air"
                    ? s.Disciples.Any(d => (d.Unit != null ? GameData.Units[d.Unit].HitsAir : d.Els.Any(e => GameData.Sects[e].HitsAir)))
                    : s.Disciples.Any(d => RoleOf(d.Unit ?? d.Els[0]) == need);
                string name = need == "air" ? L("ตีอากาศ", "anti-air") : GameData.RoleDefs.TryGetValue(need, out var rd) && thai ? rd.NameTh : need;
                parts.Add(have ? name : "<color=#D2412F>" + name + "</color>");
            }
            return L("  · ต้องการ: ", "  · needs: ") + string.Join(", ", parts);
        }

        // A leak says what got through, so a loss has a reason (SPEC-core §2.3).
        void LeakToast(int id)
        {
            if (!typeOf.TryGetValue(id, out var type) || !GameData.Enemies.TryGetValue(type, out var def)) return;
            Toast(L("หลุดเข้าประตู: ", "Leaked: ") + (thai ? def.NameTh + " — " + def.TraitTh : type), 2.5f);
        }

        void UpdateHud()
        {
            silverText.text = L("ตำลึง ", "Silver ") + s.Silver;
            livesText.text = L("ชีวิต ", "Lives ") + s.Lives;
            waveText.text = s.Wave + "/" + s.TotalWaves;
            waveButtonText.text = WaveButtonLabel();
            nextText.text = s.Wave < s.TotalWaves ? L("ถัดไป: ", "Next: ") + RecipeName(s.NextRecipe) + (NextIsBoss() ? L(" + บอส!", " + BOSS!") : "") + Needs() : "";
            UpdateBossBar();
            if (Time.time > toastUntil) toastText.text = "";
            fpsSmoothed = Mathf.Lerp(fpsSmoothed, 1f / Mathf.Max(0.0001f, Time.unscaledDeltaTime), 0.05f);
            if (Time.unscaledTime >= nextFpsUpdate)
            {
                nextFpsUpdate = Time.unscaledTime + 0.25f;
                fpsText.text = Mathf.RoundToInt(fpsSmoothed) + " fps, boot " + firstFrameAt.ToString("0.00") + "s";
            }
        }
    }
}
