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

        const int T = 16, OX = 2, OY = 16;
        const float TickSec = 0.05f;

        DefendState s;
        readonly List<Command> pending = new List<Command>();
        float acc;
        int speed = 1;
        readonly Dictionary<int, Vector2> prev = new Dictionary<int, Vector2>();
        readonly Dictionary<int, (SpriteRenderer body, SpriteRenderer hpBg, SpriteRenderer hp)> enemyViews = new Dictionary<int, (SpriteRenderer, SpriteRenderer, SpriteRenderer)>();
        Transform discipleRoot;
        string discipleSig = "";

        class Shot { public SpriteRenderer R; public Vector2 From, To; public float T; }
        readonly List<Shot> shots = new List<Shot>();

        // HUD
        Font font;
        bool thai;
        Text silverText, livesText, waveText, fpsText, toastText;
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
            s = Defend.Create(StageId, (uint)Random.Range(1, int.MaxValue));
            var ground = new GameObject("Ground").AddComponent<SpriteRenderer>();
            ground.sprite = Art.Ground(Layouts.GridW, Layouts.GridH, s.PathTiles);
            ground.transform.position = World(OX, OY);
            ground.sortingOrder = -10;
            discipleRoot = new GameObject("Disciples").transform;
            BuildHud();
            Toast(L("แตะช่องหญ้าข้างทางเพื่อวางศิษย์", "Tap grass next to the path to place a disciple"), 6f);
        }

        // ---------- loop ----------

        void Update()
        {
            if (firstFrameAt < 0) firstFrameAt = Time.realtimeSinceStartup;
            FitCamera();
            HandleInput();

            if (!s.IsOver)
            {
                acc += Mathf.Min(Time.deltaTime, 0.25f) * speed;
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
            RenderEnemies(Mathf.Clamp01(acc / TickSec));
            UpdateShots();
            UpdateHud();
        }

        void FitCamera()
        {
            var cam = Camera.main;
            float aspect = (float)Screen.width / Mathf.Max(1, Screen.height);
            cam.orthographicSize = Mathf.Max(Bootstrap.H / 2f, Bootstrap.W / 2f / aspect);
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
                        break;
                    }
                    case "wave": Toast("Wave " + ev.Wave, 1.2f); break;
                    case "newEnemy": Toast(L("ศัตรูใหม่: ", "New enemy: ") + (thai ? GameData.Enemies[ev.Type].NameTh : ev.Type), 2f); break;
                    case "picked": Toast(L("คัมภีร์: ", "Manual: ") + ev.Name, 2f); break;
                    case "error": if (ev.Msg == "not enough silver") Toast(L("ตำลึงไม่พอ", "Not enough silver"), 1f); break;
                    case "end":
                        Toast(ev.Won ? L("ชนะ! ", "Victory! ") + string.Concat(ev.Stars.Select(x => x ? "*" : "-")) : L("พ่ายแพ้", "Defeat"), 999f);
                        break;
                }
            }
        }

        void Shoot(Vector2 from, Vector2 to, string el, bool crit)
        {
            var r = new GameObject("shot").AddComponent<SpriteRenderer>();
            r.sprite = Art.Pixel();
            r.color = Art.Hex(GameData.Sects[el].Color);
            r.transform.localScale = new Vector3(crit ? 3 : 2, crit ? 3 : 2, 1);
            r.sortingOrder = 30;
            shots.Add(new Shot { R = r, From = from, To = to, T = 0 });
        }

        void UpdateShots()
        {
            for (int i = shots.Count - 1; i >= 0; i--)
            {
                var sh = shots[i];
                sh.T += Time.deltaTime / 0.12f;
                var p = Vector2.Lerp(sh.From, sh.To, sh.T);
                sh.R.transform.position = World(p.x, p.y);
                if (sh.T >= 1) { Destroy(sh.R.gameObject); shots.RemoveAt(i); }
            }
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
                r.sprite = Art.Disciple(d.Els);
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

        void RenderEnemies(float alpha)
        {
            var seen = new HashSet<int>();
            foreach (var e in s.Enemies)
            {
                seen.Add(e.Id);
                if (!enemyViews.TryGetValue(e.Id, out var v))
                {
                    var body = new GameObject("e" + e.Id).AddComponent<SpriteRenderer>();
                    body.sprite = Art.Enemy(e.Type); body.sortingOrder = 20;
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

        void ClosePanel() { if (panel != null) Destroy(panel.gameObject); panel = null; }

        RectTransform OpenPanel()
        {
            ClosePanel();
            var root = (RectTransform)silverText.canvas.transform;
            panel = Box(root, "Panel", new Vector2(0.02f, 0), new Vector2(0.98f, 0), new Vector2(0, 72), new Vector2(0, 232), "#17121F");
            return panel;
        }

        void OpenBuildPanel(int tx, int ty)
        {
            var p = OpenPanel();
            int n = s.Unlocked.Count;
            for (int i = 0; i < n; i++)
            {
                string el = s.Unlocked[i];
                int cost = Defend.PlaceCost(el);
                string name = thai ? GameData.Sects[el].NameTh : el;
                MakeButton(p, name + "  " + cost, new Vector2((float)i / n + 0.01f, 0.1f), new Vector2((float)(i + 1) / n - 0.01f, 0.9f),
                    () => { pending.Add(new Command { T = "place", Sect = el, Tx = tx, Ty = ty }); ClosePanel(); }, s.Silver >= cost);
            }
        }

        void OpenDisciplePanel(Disciple d)
        {
            var p = OpenPanel();
            int up = Defend.UpgradeCost(d);
            bool canUp = d.Combo == null && d.Level < GameData.UpgradeLevels;
            MakeButton(p, canUp ? L("อัปเกรด ", "Upgrade ") + up : L("เต็มแล้ว", "Max level"), new Vector2(0.02f, 0.1f), new Vector2(0.49f, 0.9f),
                () => { pending.Add(new Command { T = "upgrade", Id = d.Id }); ClosePanel(); }, canUp && s.Silver >= up);
            MakeButton(p, L("ขาย +", "Sell +") + Defend.SellValue(d, s), new Vector2(0.51f, 0.1f), new Vector2(0.98f, 0.9f),
                () => { pending.Add(new Command { T = "sell", Id = d.Id }); ClosePanel(); });
        }

        void Toast(string msg, float seconds) { toastText.text = msg; toastUntil = Time.time + seconds; }

        void UpdateHud()
        {
            silverText.text = L("ตำลึง ", "Silver ") + s.Silver;
            livesText.text = L("ชีวิต ", "Lives ") + s.Lives;
            waveText.text = s.Wave + "/" + s.TotalWaves;
            waveButtonText.text = s.Phase == "build" ? L("เริ่มบุก", "Start wave")
                : s.Phase == "break" ? L("wave ถัดไป +", "Next wave +") + GameData.EarlyCallBonus : L("กำลังสู้...", "Fighting...");
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
