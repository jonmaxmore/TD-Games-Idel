// Unity view for a defend stage: runs the C# rules (FiveSects.Sim) at 20 Hz, draws the world (Board3D, or the
// classic 2D sprites) and a uGUI HUD built from code: placement cards, disciple panel with technique and target mode,
// manual offers, secret arts, pause, results with star values and a reason for a loss.
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

        // The story path playable in this prototype (chapter 1 defend stages), in order. Results and lobby walk this list.
        public static readonly string[] Playlist = { "1-1", "1-2", "1-4", "1-6", "1-12" };

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
        RectTransform canvasRoot, hudRoot, resultPanel;
        string discipleSig = null;

        class Shot { public SpriteRenderer R; public Vector2 From, To; public float T; public string El; public bool Crit; }
        Fx fx;
        float hitStopUntil;
        Vector3 camBase;
        bool camBaseSet;
        readonly Dictionary<int, float> popUntil = new Dictionary<int, float>();
        readonly Dictionary<int, string> typeOf = new Dictionary<int, string>();
        Vector2 goalAt;
        Board3D board; // null when the profile asks for the classic 2D battle
        readonly Dictionary<int, int> levelSeen = new Dictionary<int, int>();
        RectTransform nextStrip;
        string nextStripKey;
        // Panels and HUD state
        bool paused;
        RectTransform pauseMenu, offerPanel;
        Text offerTimer;
        bool panelTop;                     // the open panel sits on the top half (toasts then move down)
        System.Action reopen;              // rebuilds the open panel (when affordability changes or a mode is set)
        int panelAfford = -1;              // how many of the open panel's prices the player can pay right now
        int[] panelCosts = System.Array.Empty<int>();
        float reopenAt = -1;
        int sellArmed = -1;                // disciple whose Sell needs a second tap
        bool firstPlaceSeen;
        float markUntil;
        readonly Dictionary<string, int> leaksByType = new Dictionary<string, int>();
        readonly Queue<(string msg, float sec)> toasts = new Queue<(string, float)>();
        string toastNow;
        readonly List<(Text t, float born)> uiFloaters = new List<(Text, float)>();
        static readonly List<RaycastResult> uiHits = new List<RaycastResult>();
        // Secret arts bar
        Button[] artButtons;
        RectTransform[] artFills;
        Text[] artSubs;
        // HUD caches: rebuild strings only when the value behind them changes
        int hudSilver = int.MinValue, hudLives = int.MinValue, hudWave = int.MinValue, nextWaveSeen = -1, nextCount = -1;
        string nextRecipeSeen;
        float waveLabelAt;
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
            bool use3D = Flow == null || !Flow.Profile.Classic2D;
            discipleRoot = new GameObject("Disciples").transform;
            discipleRoot.SetParent(world);
            rangeRing = MakeOverlay("range-ring", 24);
            tileMark = MakeOverlay("tile-mark", 23);
            ghost = MakeOverlay("ghost", 11);
            BuildHud();
            fx = new Fx(world, font);
            if (use3D) { board = new Board3D(s.Layout, canvasRoot); Camera.main.cullingMask = 0; } // the 3D board draws the world
            else Build2D(biome);
            Toast(Ui.StageName(StageId), 2f);
            if (StageId == "T-0" || StageId == "1-1") Toast(L("แตะพื้นข้างถนนเพื่อวางศิษย์", "Tap the ground beside the road to place a disciple"), 5f);
            if (Flow != null) Flow.BattleReady();
        }

        void Build2D(BiomeDef biome)
        {
            var ground = new GameObject("Ground").AddComponent<SpriteRenderer>();
            ground.sprite = Art.Ground(Layouts.GridW, Layouts.GridH, s.PathTiles, GameData.Palette[biome.Palette]);
            ground.transform.SetParent(world);
            ground.transform.position = World(OX, OY);
            ground.sortingOrder = -10;
            BuildMap(biome);
            fx.Atmosphere(biome.Time, Layouts.GridW * T, Layouts.GridH * T, new Vector2(OX, OY));
            foreach (var p in s.Layout.Props)
                if (p.Type == "lantern") fx.Light(new Vector2(TileCx(p.At.X), TileBottom(p.At.Y) - 10), "#FFB347", 26, 0.45f);
            var end = s.Layout.Path[s.Layout.Path.Length - 1];
            var start = s.Layout.Path[0];
            goalAt = new Vector2(TileCx(end.X), TileBottom(end.Y) - 10);
            fx.Light(goalAt, "#E3B04B", 40, 0.35f);
            fx.Light(new Vector2(TileCx(start.X), TileBottom(start.Y) - 8), "#8A2A5A", 30, 0.4f);
        }

        // ---------- loop ----------

        void Update()
        {
            if (firstFrameAt < 0) firstFrameAt = Time.realtimeSinceStartup;
            FitCamera();
            HandleInput();

            if (!s.IsOver && !paused)
            {
                // Hit-stop: a crit freezes the sim for a few frames so big hits land with weight.
                if (Time.unscaledTime >= hitStopUntil) acc += Mathf.Min(Time.deltaTime, 0.25f) * speed;
                int steps = 0;
                while (acc >= TickSec && steps < 8 && !s.IsOver)
                {
                    prev.Clear();
                    foreach (var e in s.Enemies) { prev[e.Id] = new Vector2(e.X, e.Y); typeOf[e.Id] = e.Type; }
                    var events = Defend.Step(s, pending.Count > 0 ? pending.ToArray() : System.Array.Empty<Command>());
                    pending.Clear();
                    Handle(events);
                    acc -= TickSec;
                    steps++;
                }
                acc = Mathf.Min(acc, 8 * TickSec);
            }
            UpdateHints();
            WatchUpgrades();
            if (board != null)
            {
                board.SyncDisciples(s);
                board.UpdateDisciples(s, Time.deltaTime);
                board.RenderEnemies(s, prev, Mathf.Clamp01(acc / TickSec));
                board.Update(paused ? 0 : Time.deltaTime, fx.ShakeOffset * 0.04f);
            }
            else
            {
                SyncDisciples();
                TintDisciples();
                RenderEnemies(Mathf.Clamp01(acc / TickSec));
                UpdateShots();
            }
            fx.Update(Time.deltaTime);
            RefreshPanel();
            UpdateHud();
        }

        // An open panel follows the run: when silver crosses one of its prices it is rebuilt, so Place/Upgrade light up
        // by themselves; a mode change asks for a rebuild a moment later, once the sim has applied it.
        void RefreshPanel()
        {
            if (panel == null || reopen == null) return;
            if (reopenAt > 0 && Time.time >= reopenAt) { reopenAt = -1; reopen(); return; }
            if (Afford() != panelAfford) reopen();
        }

        int Afford()
        {
            int n = 0;
            foreach (var c in panelCosts) if (s.Silver >= c) n++;
            return n;
        }

        // A disciple that went up a tier announces the technique it just learned (name over its head, gold burst, toast).
        void WatchUpgrades()
        {
            if (levelSeen.Count > s.Disciples.Count) // sold or merged: forget ids no longer on the board
                foreach (var id in levelSeen.Keys.ToList()) if (!s.Disciples.Any(d => d.Id == id)) { levelSeen.Remove(id); popUntil.Remove(id); }
            foreach (var d in s.Disciples)
            {
                bool known = levelSeen.TryGetValue(d.Id, out var was);
                levelSeen[d.Id] = d.Level;
                if (!known || d.Level <= was) continue;
                var sk = Ui.Skill(d.Els[0], d.Level);
                if (sk == null) continue;
                Toast(L("ได้ท่าใหม่: ", "New technique: ") + Ui.Name(sk) + " — " + Ui.Effect(sk), 3f);
                if (board != null)
                {
                    var at = board.DiscipleAt(d.Id);
                    board.Number(at + new Vector3(0, 0.8f, 0), Ui.Name(sk), "#FFD34A", 2.2f);
                    board.Burst(at, "#E3B04B", 16);
                }
                else fx.Burst(new Vector2(Gx(d.X), Gy(d.Y) - 4), "#E3B04B", 1.2f);
            }
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

        // Explicit hit test at the press position: EventSystem.IsPointerOverGameObject can lag a frame on touch.
        static bool OverUi(Vector2 screen)
        {
            var es = EventSystem.current;
            if (es == null) return false;
            uiHits.Clear();
            es.RaycastAll(new PointerEventData(es) { position = screen }, uiHits);
            return uiHits.Count > 0;
        }

        void HandleInput()
        {
            if (Ui.BackPressed()) { if (resultPanel == null) { if (panel != null) ClosePanel(); else TogglePause(); } return; }
            if (!PointerDown(out var screen)) return;
            if (OverUi(screen)) return;
            if (paused || s.IsOver || resultPanel != null || offerPanel != null) return;
            int tx, ty;
            if (board != null) board.TileAt(screen, out tx, out ty);
            else
            {
                var w = Camera.main.ScreenToWorldPoint(new Vector3(screen.x, screen.y, 10));
                tx = Mathf.FloorToInt((w.x - OX) / T); ty = Mathf.FloorToInt((-w.y - OY) / T);
            }
            ClosePanel();
            sellArmed = -1;
            if (tx < 0 || ty < 0 || tx >= Layouts.GridW || ty >= Layouts.GridH) return;
            if (pending.Any(c => c.T == "place" && c.Tx == tx && c.Ty == ty)) return;
            var d = s.Disciples.FirstOrDefault(q => q.Tx == tx && q.Ty == ty);
            if (d != null)
            {
                if (pending.Any(c => c.Id == d.Id && (c.T == "upgrade" || c.T == "sell"))) return; // already ordered this tick
                OpenDisciplePanel(d);
            }
            else if (Defend.CanBuild(s, tx, ty)) OpenBuildPanel(tx, ty);
            else
            {
                // Say why nothing opened, and frame the tile in red for a moment.
                Toast(s.PathTiles.Contains(tx + "," + ty) ? L("วางบนทางเดินศัตรูไม่ได้", "Can't place on the road") : L("ช่องนี้มีสิ่งกีดขวาง", "Something is in the way"), 1.2f);
                ShowTileMark(tx, ty, "#D2412F");
                markUntil = Time.time + 0.5f;
            }
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
                        if (board != null)
                        {
                            board.Shot(d.Id, to, ev.Crit);
                            if (ev.Crit) { hitStopUntil = Time.unscaledTime + 0.04f; board.Number(board.EnemyAt((int)to.x, (int)to.y), ev.Dmg + "!", "#FFD34A"); }
                            break;
                        }
                        Shoot(new Vector2(Gx(d.X), Gy(d.Y) - 4), new Vector2(Gx((int)to.x), Gy((int)to.y) - 4), ev.El, ev.Crit);
                        popUntil[d.Id] = Time.time + 0.08f;
                        if (ev.Crit)
                        {
                            hitStopUntil = Time.unscaledTime + 0.04f;
                            fx.Number(new Vector2(Gx((int)to.x), Gy((int)to.y) - 12), ev.Dmg + "!", "#FFD34A");
                        }
                        break;
                    }
                    case "wave": Toast(L("ระลอกที่ ", "Wave ") + ev.Wave, 1.2f); break;
                    case "newEnemy": Toast(L("ศัตรูใหม่: ", "New enemy: ") + Ui.Enemy(ev.Type), 2f); break;
                    case "offer": OpenOfferPanel(ev.Cards); break;
                    case "picked": CloseOffer(); Toast(L("ได้คัมภีร์: ", "Manual: ") + CardName(ev.Name), 2f); break;
                    case "error": Toast(ErrorText(ev.Msg), 1.2f); break;
                    case "placed":
                    {
                        // Feedback once the rules accepted the placement, not when the button was pressed.
                        var d = s.Disciples.FirstOrDefault(q => q.Id == ev.Id);
                        if (d != null && panel == null) { var def = GameData.DefOf(d.Unit ?? d.Els[0]); ShowRing(d.Tx, d.Ty, def.Range, def.Color, 1.5f); }
                        if (!firstPlaceSeen) { firstPlaceSeen = true; if (Flow != null) Flow.FirstPlace(); }
                        break;
                    }
                    case "interest": if (ev.Amount > 0) FloatUi(silverText, "+" + ev.Amount + L(" ดอกเบี้ย", " interest"), "#E3B04B"); break;
                    case "art":
                    {
                        var art = GameData.Arts.FirstOrDefault(a => a.Id == ev.Name);
                        if (art != null) Toast(art.NameTh, 1.5f);
                        fx.Shake(2);
                        if (board != null) board.ArtFx(art?.Type, board.EnemyAt(ev.X, ev.Y));
                        break;
                    }
                    case "phoenix": board?.Phoenix(); Toast(L("เพลิงคืนชีพ! หงส์เพลิงกวาดทาง", "Rebirth Blaze! The phoenix sweeps the road"), 1.5f); break;
                    case "leak":
                        if (typeOf.TryGetValue(ev.Id, out var leakType)) leaksByType[leakType] = (leaksByType.TryGetValue(leakType, out var nl) ? nl : 0) + 1;
                        LeakToast(ev.Id); goalFlashUntil = Time.time + 0.25f; fx.Shake(2.5f);
                        typeOf.Remove(ev.Id);
                        if (board != null) board.Burst(board.GoalAt + Vector3.up, "#D2412F", 14); else fx.Burst(goalAt, "#D2412F", 0.6f);
                        break;
                    case "kill":
                    {
                        var at = new Vector2(Gx(ev.X), Gy(ev.Y) - 4);
                        bool boss = typeOf.TryGetValue(ev.Id, out var t) && GameData.Enemies[t].Boss != null;
                        typeOf.Remove(ev.Id);
                        if (board != null)
                        {
                            var p3 = board.EnemyAt(ev.X, ev.Y);
                            board.Burst(p3, "#8A0A0A", boss ? 30 : 10, boss ? 0.18f : 0.12f);
                            board.Burst(p3, "#E3B04B", 3, 0.08f);
                            board.Number(p3, "+" + ev.Amount, "#E3B04B");
                            if (boss) fx.Shake(4);
                            break;
                        }
                        fx.Death(at, boss);
                        fx.Coin(at, ev.Amount);
                        break;
                    }
                    case "combo":
                    {
                        var d = s.Disciples.FirstOrDefault(q => q.Id == ev.Id);
                        if (d != null && board != null) board.Burst(board.DiscipleAt(d.Id), "#E3B04B", 20);
                        else if (d != null) fx.Burst(new Vector2(Gx(d.X), Gy(d.Y) - 4), "#E3B04B", 1.2f);
                        Toast(L(ev.Name, ev.Type), 1.5f);
                        break;
                    }
                    case "seal": fx.Shake(3); if (board == null) fx.Burst(new Vector2(Bootstrap.W / 2f, Bootstrap.H / 2f), "#8A1A1A", 1.5f); Toast(L("บอสผนึก ", "Boss sealed ") + SealName(ev.El) + L(" ชั่วคราว! (ตัวสีเทาโจมตีไม่ได้)", " for a while! (grey ones cannot attack)"), 2.5f); break;
                    case "disable": fx.Shake(2); Toast(L("อาวุธลับ! ศิษย์ถูกสกัด", "Hidden weapon! A disciple is disabled"), 1.5f); break;
                    case "end":
                        ClosePanel(); CloseOffer(); ClosePause();
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
            ringUntil = seconds > 0 ? Time.time + seconds : float.MaxValue;
            if (board != null) { board.ShowRing(tx, ty, rangeMilli, color); return; }
            rangeRing.sprite = Art.Ring(Mathf.RoundToInt(rangeMilli * T / 1000f));
            rangeRing.color = Art.Hex(color);
            rangeRing.transform.position = TileCentre(tx, ty);
            rangeRing.enabled = true;
        }

        void ShowTileMark(int tx, int ty, string hex = "#E3B04B")
        {
            if (board != null) { board.ShowTileMark(tx, ty, hex); return; }
            tileMark.sprite = Art.TileMark(T);
            tileMark.color = hex == "#E3B04B" ? Color.white : Art.Hex(hex); // the sprite itself is drawn gold
            tileMark.transform.position = TileCentre(tx, ty);
            tileMark.enabled = true;
        }

        void HideMarks() { rangeRing.enabled = false; tileMark.enabled = false; ghost.enabled = false; board?.HideMarks(); }

        void UpdateHints()
        {
            if (rangeRing.enabled && panel == null && Time.time > ringUntil) rangeRing.enabled = false;
            if (board != null && board.RingShown && panel == null && Time.time > ringUntil) board.HideRing();
            if (markUntil > 0 && Time.time > markUntil && panel == null) { markUntil = 0; tileMark.enabled = false; board?.HideMarks(); }
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
            font = Ui.Font;
            thai = Ui.Thai;

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
            canvasRoot = (RectTransform)canvasGo.transform;
            var root = Ui.SafeArea(canvasRoot); // HUD clear of notches; the 3D board behind it fills the whole screen
            hudRoot = root;

            // Top bar: silver, lives and wave as framed chips with a colour mark; speed at the right.
            var top = Frame(root, "Top", new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -70), Vector2.zero);
            silverText = Chip(top, 0.01f, 0.33f, "#E3B04B");
            livesText = Chip(top, 0.34f, 0.56f, "#D2412F");
            waveText = Chip(top, 0.57f, 0.8f, "#ECE3CF");
            var speedBtn = MakeButton(top, "x1", new Vector2(0.81f, 0.12f), new Vector2(0.9f, 0.88f), null);
            speedBtn.onClick.AddListener(() => { speed = speed % 3 + 1; speedBtn.GetComponentInChildren<Text>().text = "x" + speed; });
            MakeButton(top, "II", new Vector2(0.91f, 0.12f), new Vector2(0.99f, 0.88f), TogglePause);

            // Bottom: what the next wave brings (name, enemy pictures, roles it needs), then a big start button.
            var bottom = Frame(root, "Bottom", new Vector2(0, 0), new Vector2(1, 0), Vector2.zero, new Vector2(0, 134));
            nextText = Label(bottom, "", 19, new Vector2(0, 0.56f), new Vector2(0.6f, 1), "#C9BFA8");
            nextText.resizeTextForBestFit = true; nextText.resizeTextMinSize = 13; nextText.resizeTextMaxSize = 19;
            nextStrip = (RectTransform)new GameObject("NextEnemies", typeof(RectTransform)).transform;
            nextStrip.SetParent(bottom, false);
            nextStrip.anchorMin = new Vector2(0.6f, 0.54f); nextStrip.anchorMax = new Vector2(0.99f, 1f); nextStrip.offsetMin = nextStrip.offsetMax = Vector2.zero;
            waveButton = MakeButton(bottom, L("เริ่มบุก", "Start wave"), new Vector2(0.02f, 0.06f), new Vector2(0.66f, 0.52f), () => pending.Add(new Command { T = "nextWave" }), true, true);
            waveButtonText = waveButton.GetComponentInChildren<Text>();
            waveButtonText.font = Ui.Bold; waveButtonText.fontSize = 28;
            fpsText = Label(bottom, "", 16, new Vector2(0.68f, 0.06f), new Vector2(0.99f, 0.52f), "#6E6680");
            fpsText.gameObject.SetActive(Debug.isDebugBuild); // dev readout only
            BuildArtsBar(root);

            if (s.Sect != null)
            {
                // The player's sect colours the HUD: a band under the top bar.
                var band = Box(root, "SectBand", new Vector2(0, 1), new Vector2(1, 1), new Vector2(0, -74), new Vector2(0, -70), GameData.Sects[s.Sect].Color);
                band.GetComponent<Image>().raycastTarget = false;
            }
            bossBar = Frame(root, "BossBar", new Vector2(0.1f, 1), new Vector2(0.9f, 1), new Vector2(0, -116), new Vector2(0, -86), "#1A1423");
            bossFill = Box(bossBar, "Fill", Vector2.zero, Vector2.one, new Vector2(2, 2), new Vector2(-2, -2), "#D2412F");
            bossName = Label(bossBar, "", 20, Vector2.zero, Vector2.one, "#ECE3CF");
            bossName.alignment = TextAnchor.MiddleCenter;
            bossBar.gameObject.SetActive(false);
            toastText = Label(root, "", 30, new Vector2(0, 0.62f), new Vector2(1, 0.7f), "#ECE3CF");
            toastText.alignment = TextAnchor.MiddleCenter;
            toastText.resizeTextForBestFit = true; toastText.resizeTextMinSize = 18; toastText.resizeTextMaxSize = 30;
            toastText.gameObject.AddComponent<Outline>().effectColor = new Color(0, 0, 0, 0.85f);
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

        // Wuxia panel: black-red lacquer with a thin gold edge.
        RectTransform Frame(RectTransform parent, string name, Vector2 aMin, Vector2 aMax, Vector2 offMin, Vector2 offMax, string color = "#1A0E10")
        {
            var rt = Box(parent, name, aMin, aMax, offMin, offMax, color);
            var o = rt.gameObject.AddComponent<Outline>();
            o.effectColor = Art.Hex("#C9A040"); o.effectDistance = new Vector2(2, -2);
            return rt;
        }

        // A stat chip in the top bar: a small colour mark and a big number.
        Text Chip(RectTransform bar, float x0, float x1, string color)
        {
            var c = Box(bar, "Chip", new Vector2(x0, 0.14f), new Vector2(x1, 0.86f), Vector2.zero, Vector2.zero, "#0E0709");
            var mark = Box(c, "Mark", new Vector2(0, 0.2f), new Vector2(0, 0.8f), new Vector2(8, 0), new Vector2(24, 0), color);
            mark.GetComponent<Image>().raycastTarget = false;
            var t = Label(c, "", 26, Vector2.zero, Vector2.one, color);
            t.font = Ui.Bold; t.rectTransform.offsetMin = new Vector2(32, 0);
            return t;
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

        Button MakeButton(RectTransform parent, string text, Vector2 aMin, Vector2 aMax, UnityEngine.Events.UnityAction onClick, bool enabled = true, bool primary = false)
        {
            var rt = enabled ? Frame(parent, "Button", aMin, aMax, Vector2.zero, Vector2.zero, primary ? "#8A1A12" : "#2A1414") : Box(parent, "Button", aMin, aMax, Vector2.zero, Vector2.zero, "#221C2A");
            var b = rt.gameObject.AddComponent<Button>();
            b.interactable = enabled;
            if (onClick != null) b.onClick.AddListener(onClick);
            var t = Label(rt, text, 24, Vector2.zero, Vector2.one, enabled ? "#ECE3CF" : "#9A92AE");
            t.alignment = TextAnchor.MiddleCenter;
            return b;
        }

        void ClosePanel()
        {
            if (panel != null) Destroy(panel.gameObject);
            panel = null; reopen = null; panelCosts = System.Array.Empty<int>(); reopenAt = -1;
            HideMarks(); board?.Unfocus();
        }

        // Remember how to rebuild the open panel and which prices it shows, for RefreshPanel.
        void Track(System.Action rebuild, params int[] costs) { reopen = rebuild; panelCosts = costs; panelAfford = Afford(); }

        // The panel opens on the half of the screen away from the tapped tile so it never hides it.
        RectTransform OpenPanel(int ty, float height = 160)
        {
            ClosePanel();
            panelTop = ty >= Layouts.GridH / 2;
            panel = !panelTop
                ? Frame(hudRoot, "Panel", new Vector2(0.02f, 0), new Vector2(0.98f, 0), new Vector2(0, 212), new Vector2(0, 212 + height))
                : Frame(hudRoot, "Panel", new Vector2(0.02f, 1), new Vector2(0.98f, 1), new Vector2(0, -78 - height), new Vector2(0, -78));
            return panel;
        }

        // Two-step placement with cards (SPEC-core §2.1): a row of disciple cards (portrait, role, name, cost); picking one
        // shows its details, a ghost and its attack range on the tile; only Confirm places it.
        void OpenBuildPanel(int tx, int ty, string choice = null)
        {
            // Open on a card already picked (the first one the player can afford) so its picture, description and range show at once.
            if (choice == null) choice = s.Unlocked.FirstOrDefault(k => s.Silver >= Defend.PlaceCost(k)) ?? s.Unlocked.FirstOrDefault();
            if (choice == null) return;
            var p = OpenPanel(ty, 520);
            ShowTileMark(tx, ty);
            board?.Focus(tx, ty);
            int n = s.Unlocked.Count;
            for (int i = 0; i < n; i++)
            {
                string key = s.Unlocked[i];
                Card(p, key, i, n, key == choice, () => OpenBuildPanel(tx, ty, key));
            }
            var detail = Box(p, "Detail", new Vector2(0.01f, 0.02f), new Vector2(0.99f, 0.52f), Vector2.zero, Vector2.zero, "#0E0709");
            var def = GameData.DefOf(choice);
            int cost = Defend.PlaceCost(choice);
            ShowRing(tx, ty, def.Range, def.Color, 0);
            if (board != null) board.ShowGhost(choice, tx, ty);
            else
            {
                ghost.sprite = DiscipleSprite(choice);
                ghost.transform.position = World(OX + tx * T + T / 2f, OY + ty * T + T / 2f - 1);
                ghost.color = new Color(1, 1, 1, 0.6f);
                ghost.enabled = true;
            }
            Detail(detail, choice);
            bool afford = s.Silver >= cost;
            MakeButton(detail, afford ? L("ยืนยันวาง\n", "Place\n") + cost + L(" ตำลึง", " silver") : L("ขาดอีก\n", "Need\n") + (cost - s.Silver) + L(" ตำลึง", " more"),
                new Vector2(0.72f, 0.62f), new Vector2(0.99f, 0.99f),
                () => { pending.Add(new Command { T = "place", Sect = choice, Tx = tx, Ty = ty }); ClosePanel(); }, afford, true);
            MakeButton(detail, L("ยกเลิก", "Cancel"), new Vector2(0.72f, 0.42f), new Vector2(0.99f, 0.6f), ClosePanel);
            Track(() => OpenBuildPanel(tx, ty, choice), s.Unlocked.Select(Defend.PlaceCost).ToArray());
        }

        static Dictionary<string, string> RoleColor => Ui.RoleColor;

        // One card: sect-coloured frame (gold when selected), pixel portrait, role chip, name and cost.
        void Card(RectTransform parent, string key, int i, int n, bool selected, UnityEngine.Events.UnityAction onClick)
        {
            var def = GameData.DefOf(key);
            int cost = Defend.PlaceCost(key);
            bool afford = s.Silver >= cost;
            float x0 = (float)i / n + 0.006f, x1 = (float)(i + 1) / n - 0.006f;
            var frame = Box(parent, "Card", new Vector2(x0, selected ? 0.56f : 0.54f), new Vector2(x1, selected ? 1f : 0.97f), Vector2.zero, Vector2.zero, selected ? "#E3B04B" : def.Color);
            var face = Box(frame, "Face", Vector2.zero, Vector2.one, new Vector2(3, 3), new Vector2(-3, -3), selected ? "#2A2033" : "#1A1423");
            var btn = frame.gameObject.AddComponent<Button>();
            btn.onClick.AddListener(onClick);
            var glow = Box(face, "Glow", new Vector2(0.04f, 0.3f), new Vector2(0.96f, 0.86f), Vector2.zero, Vector2.zero, def.Color);
            glow.GetComponent<Image>().color = Art.Hex(def.Color) * new Color(1, 1, 1, 0.22f);
            glow.GetComponent<Image>().raycastTarget = false;
            // The character itself: in 3D the board's own figure, in 2D the pixel sprite.
            var holder = (RectTransform)new GameObject("PortraitArea", typeof(RectTransform)).transform;
            holder.SetParent(face, false);
            holder.anchorMin = new Vector2(0.04f, 0.3f); holder.anchorMax = new Vector2(0.96f, 0.86f); holder.offsetMin = holder.offsetMax = Vector2.zero;
            var portrait = new GameObject("Portrait", typeof(RectTransform), board != null ? typeof(RawImage) : typeof(Image));
            var prt = (RectTransform)portrait.transform;
            prt.SetParent(holder, false);
            prt.anchorMin = Vector2.zero; prt.anchorMax = Vector2.one; prt.offsetMin = prt.offsetMax = Vector2.zero;
            Graphic pic;
            if (board != null)
            {
                var raw = portrait.GetComponent<RawImage>();
                raw.texture = board.Portrait(key);
                var fit = portrait.AddComponent<AspectRatioFitter>();
                fit.aspectMode = AspectRatioFitter.AspectMode.FitInParent;
                fit.aspectRatio = 96f / 120f;
                pic = raw;
            }
            else
            {
                var img = portrait.GetComponent<Image>();
                img.sprite = DiscipleSprite(key); img.preserveAspect = true;
                pic = img;
            }
            pic.raycastTarget = false;
            if (!afford) pic.color = new Color(0.5f, 0.5f, 0.5f, 1);
            string role = RoleOf(key);
            if (role != null && GameData.RoleDefs.TryGetValue(role, out var rd))
            {
                var chip = Box(face, "Role", new Vector2(0, 0.86f), new Vector2(1, 1), Vector2.zero, Vector2.zero, RoleColor.TryGetValue(role, out var rc) ? rc : "#9A92AE");
                chip.GetComponent<Image>().raycastTarget = false;
                var rl = Label(chip, Ui.Name(rd), n > 4 ? 14 : 17, Vector2.zero, Vector2.one, "#1A1423");
                rl.alignment = TextAnchor.MiddleCenter;
            }
            var name = Label(face, Ui.Name(def), n > 4 ? 18 : 22, new Vector2(0, 0.14f), new Vector2(1, 0.31f), "#FFF4DC");
            name.font = Ui.Bold; name.alignment = TextAnchor.MiddleCenter;
            name.rectTransform.offsetMin = new Vector2(2, 0); name.rectTransform.offsetMax = new Vector2(-2, 0);
            name.resizeTextForBestFit = true; name.resizeTextMinSize = 12; name.resizeTextMaxSize = name.fontSize;
            var price = Label(face, cost + L(" ตำลึง", " silver"), n > 4 ? 14 : 17, new Vector2(0, 0), new Vector2(1, 0.16f), afford ? "#E3B04B" : "#6E6680");
            price.alignment = TextAnchor.MiddleCenter;
        }

        // Details of the picked card: name and role, what it does, stat bars against the strongest unit, air and good-vs.
        void Detail(RectTransform box, string key)
        {
            var def = GameData.DefOf(key);
            string role = RoleOf(key);
            var rd = role != null && GameData.RoleDefs.TryGetValue(role, out var x) ? x : null;
            var title = Label(box, Ui.Name(def) + (rd != null ? "  ·  " + Ui.Name(rd) : ""), 28, new Vector2(0, 0.86f), new Vector2(0.71f, 1f), def.Color);
            title.font = Ui.Bold; title.resizeTextForBestFit = true; title.resizeTextMinSize = 16; title.resizeTextMaxSize = 28;
            var u = GameData.Units.TryGetValue(key, out var ud) ? ud : null;
            string desc = u != null ? L(u.DescTh, u.DescEn) : (rd != null ? rd.DoesTh : "");
            var dl = Label(box, desc, 19, new Vector2(0, 0.7f), new Vector2(0.71f, 0.87f), "#ECE3CF");
            dl.alignment = TextAnchor.UpperLeft;
            dl.resizeTextForBestFit = true; dl.resizeTextMinSize = 14; dl.resizeTextMaxSize = 19;
            var all = GameData.UnitList.Cast<SectDef>().Concat(GameData.Sects.Values).ToList();
            float Dps(SectDef d) => d.Dmg * 20f / Mathf.Max(1, d.Cooldown);
            float Speed(SectDef d) => 20f / Mathf.Max(1, d.Cooldown);
            Bar(box, 0, L("ดาเมจ", "Damage"), Dps(def) / all.Max(Dps), Dps(def).ToString("0") + L("/วิ", "/s"), "#D2412F");
            Bar(box, 1, L("ระยะ", "Range"), def.Range / (float)all.Max(d => d.Range), (def.Range / 1000f).ToString("0.0"), "#4FB3FF");
            Bar(box, 2, L("ความเร็ว", "Speed"), Speed(def) / all.Max(Speed), Speed(def).ToString("0.0") + L(" ครั้ง/วิ", "/s"), "#E3B04B");
            // Technique ladder: tier 1 comes with the disciple, tiers 2 and 3 are what upgrading buys.
            var skills = Ui.Skills(Ui.KitOf(key));
            for (int i = 0; i < skills.Count && i < 3; i++)
            {
                var sk = skills[i];
                float y1 = 0.39f - i * 0.095f;
                var line = Label(box, L("ขั้น ", "Tier ") + sk.Lvl + "  " + Ui.Name(sk) + " — " + Ui.Effect(sk) + (sk.Lvl > 1 ? L("  (อัปเกรด)", "  (upgrade)") : ""),
                    15, new Vector2(0, y1 - 0.09f), new Vector2(0.99f, y1), sk.Lvl == 1 ? "#FFD34A" : "#8A8296");
                line.resizeTextForBestFit = true; line.resizeTextMinSize = 11; line.resizeTextMaxSize = 15;
            }
            string tags = (def.HitsAir ? L("ตีอากาศได้", "Hits air") : L("ตีได้เฉพาะพื้น", "Ground only"));
            if (rd != null && rd.Counters.Count > 0) tags += L("  ·  เก่งกับ: ", "  ·  Good vs: ") + string.Join(", ", rd.Counters.Select(Ui.Enemy));
            var tl = Label(box, tags, 16, new Vector2(0, 0), new Vector2(0.99f, 0.1f), "#9BD17A");
            tl.alignment = TextAnchor.MiddleLeft;
        }

        void Bar(RectTransform box, int row, string label, float frac, string value, string color)
        {
            float y1 = 0.69f - row * 0.1f, y0 = y1 - 0.085f;
            Label(box, label, 15, new Vector2(0, y0), new Vector2(0.17f, y1), "#9A92AE");
            var bg = Box(box, "Bar", new Vector2(0.17f, y0 + 0.015f), new Vector2(0.55f, y1 - 0.015f), Vector2.zero, Vector2.zero, "#2A2033");
            var fill = Box(bg, "Fill", Vector2.zero, new Vector2(Mathf.Clamp01(frac), 1), Vector2.zero, Vector2.zero, color);
            fill.GetComponent<Image>().raycastTarget = false;
            Label(box, value, 15, new Vector2(0.56f, y0), new Vector2(0.71f, y1), "#ECE3CF");
        }

        static string RoleOf(string key) => Ui.RoleOf(key);

        // A roster unit wears its sect's colours with its kit's weapon; legacy disciples use their element look.
        static Sprite DiscipleSprite(string key) => GameData.Units.TryGetValue(key, out var u) ? Art.Unit(u.Sect, u.Element) : Art.Disciple(new List<string> { key });

        static Sprite DiscipleSprite(Disciple d) => d.Unit != null ? Art.Unit(d.El, d.Els[0]) : Art.Disciple(d.Els);

        static readonly string[] TargetModes = { "first", "strong", "weak", "close" };

        string TargetName(string mode)
        {
            switch (mode)
            {
                case "strong": return L("เลือดมากสุด", "Strongest");
                case "weak": return L("เลือดน้อยสุด", "Weakest");
                case "close": return L("ใกล้สุด", "Closest");
                default: return L("ตัวนำหน้า", "First");
            }
        }

        // A placed disciple: who it is, the technique it fights with now, what the next upgrade teaches, whom it targets.
        void OpenDisciplePanel(Disciple d)
        {
            var p = OpenPanel(d.Ty, 360);
            board?.Focus(d.Tx, d.Ty);
            string key = d.Unit ?? d.Els[0];
            var def = GameData.DefOf(key);
            // A merged disciple reaches as far as its longer-ranged half; everyone else uses its own data.
            int range = d.Unit != null ? def.Range : d.Els.Max(el => GameData.Sects[el].Range);
            ShowRing(d.Tx, d.Ty, range, def.Color, 0);
            var pic = new GameObject("Portrait", typeof(RectTransform), board != null ? typeof(RawImage) : typeof(Image));
            var prt = (RectTransform)pic.transform;
            prt.SetParent(p, false);
            prt.anchorMin = new Vector2(0.01f, 0.36f); prt.anchorMax = new Vector2(0.2f, 0.98f); prt.offsetMin = prt.offsetMax = Vector2.zero;
            if (board != null) pic.GetComponent<RawImage>().texture = board.Portrait(key);
            else { var im = pic.GetComponent<Image>(); im.sprite = DiscipleSprite(d); im.preserveAspect = true; }
            pic.GetComponent<Graphic>().raycastTarget = false;

            string role = Ui.RoleOf(d);
            var rd = role != null && GameData.RoleDefs.TryGetValue(role, out var x) ? x : null;
            string name = d.Combo != null && GameData.Combos.FirstOrDefault(c => c.Id == d.Combo) is ComboDef cd ? L(cd.NameTh, cd.Id) : Ui.Unit(key);
            bool off = d.OffT > 0 || (s.SealT > 0 && s.SealEl != null && d.Els.Contains(s.SealEl));
            var title = Label(p, name + (rd != null ? "  ·  " + Ui.Name(rd) : "") + L("  ขั้น ", "  tier ") + d.Level + (off ? L("  (ถูกสกัด)", "  (disabled)") : ""), 26,
                new Vector2(0.21f, 0.84f), new Vector2(0.99f, 0.99f), off ? "#8A8296" : GameData.Sects[d.El ?? d.Els[0]].Color);
            title.font = Ui.Bold; title.resizeTextForBestFit = true; title.resizeTextMinSize = 16; title.resizeTextMaxSize = 26;
            var now = Ui.Skill(d.Els[0], d.Level);
            var nowLine = Label(p, L("ท่าที่ใช้: ", "Fighting with: ") + Ui.Name(now) + " — " + Ui.Effect(now), 17, new Vector2(0.21f, 0.68f), new Vector2(0.99f, 0.84f), "#FFD34A");
            nowLine.resizeTextForBestFit = true; nowLine.resizeTextMinSize = 12; nowLine.resizeTextMaxSize = 17;
            int up = Defend.UpgradeCost(d);
            bool canUp = d.Combo == null && d.Level < GameData.UpgradeLevels;
            var next = canUp ? Ui.Skill(d.Els[0], d.Level + 1) : null;
            string nextText0 = next != null ? L("อัปเกรดแล้วได้: ", "Upgrade teaches: ") + Ui.Name(next) + " — " + Ui.Effect(next)
                : d.Combo != null ? L("ร่างผสานอัปเกรดไม่ได้", "A merged form cannot be upgraded") : L("ขั้นสูงสุดแล้ว", "Highest tier");
            var nextLine = Label(p, nextText0, 17, new Vector2(0.21f, 0.52f), new Vector2(0.99f, 0.68f), next != null ? "#ECE3CF" : "#8A8296");
            nextLine.resizeTextForBestFit = true; nextLine.resizeTextMinSize = 12; nextLine.resizeTextMaxSize = 17;
            // Target mode: four choices, the current one highlighted.
            Label(p, L("เป้า:", "Target:"), 16, new Vector2(0.21f, 0.36f), new Vector2(0.31f, 0.5f), "#9A92AE");
            for (int i = 0; i < TargetModes.Length; i++)
            {
                string mode = TargetModes[i];
                bool on = d.Target == mode;
                var b = MakeButton(p, TargetName(mode), new Vector2(0.31f + i * 0.17f, 0.37f), new Vector2(0.47f + i * 0.17f, 0.5f),
                    () => { pending.Add(new Command { T = "target", Id = d.Id, Mode = mode }); reopenAt = Time.time + 0.15f; }, true, on);
                var bt = b.GetComponentInChildren<Text>(); bt.fontSize = 16; bt.resizeTextForBestFit = true; bt.resizeTextMinSize = 11; bt.resizeTextMaxSize = 16;
            }
            string upLabel = canUp ? (s.Silver >= up ? L("อัปเกรด ", "Upgrade ") + up + L(" ตำลึง", " silver") : L("อัปเกรด: ขาดอีก ", "Upgrade: need ") + (up - s.Silver))
                : d.Combo != null ? L("ร่างผสาน", "Merged") : L("เต็มแล้ว", "Max level");
            MakeButton(p, upLabel, new Vector2(0.21f, 0.04f), new Vector2(0.62f, 0.32f),
                () => { pending.Add(new Command { T = "upgrade", Id = d.Id }); ClosePanel(); }, canUp && s.Silver >= up, true);
            // Selling takes two taps, so a stray tap never throws a disciple away.
            bool armed = sellArmed == d.Id;
            MakeButton(p, armed ? L("แตะอีกครั้ง\nขาย +", "Tap again\nSell +") + Defend.SellValue(d, s) : L("ขาย +", "Sell +") + Defend.SellValue(d, s),
                new Vector2(0.64f, 0.04f), new Vector2(0.99f, 0.32f), () =>
                {
                    if (sellArmed != d.Id) { sellArmed = d.Id; OpenDisciplePanel(d); return; }
                    sellArmed = -1;
                    pending.Add(new Command { T = "sell", Id = d.Id }); ClosePanel();
                });
            Track(() => { if (s.Disciples.Contains(d)) OpenDisciplePanel(d); else ClosePanel(); }, canUp ? new[] { up } : System.Array.Empty<int>());
        }

        // ---------- manual offer, secret arts, pause ----------

        static string CardName(string id) => GameData.Cards.FirstOrDefault(c => c.Id == id)?.NameTh ?? "";

        // Every few waves the rules offer three manuals; the player picks one (or the first is taken when time runs out).
        void OpenOfferPanel(List<string> ids)
        {
            ClosePanel(); CloseOffer();
            if (ids == null || ids.Count == 0) return;
            offerPanel = Frame(hudRoot, "Offer", new Vector2(0.03f, 0.28f), new Vector2(0.97f, 0.74f), Vector2.zero, Vector2.zero);
            var title = Label(offerPanel, L("เลือกคัมภีร์ 1 เล่ม", "Pick one manual"), 32, new Vector2(0, 0.84f), new Vector2(1, 0.98f), "#E3B04B");
            title.font = Ui.Bold; title.alignment = TextAnchor.MiddleCenter;
            offerTimer = Label(offerPanel, "", 18, new Vector2(0, 0.74f), new Vector2(1, 0.84f), "#9A92AE");
            offerTimer.alignment = TextAnchor.MiddleCenter;
            for (int i = 0; i < ids.Count; i++)
            {
                var c = GameData.Cards.FirstOrDefault(x => x.Id == ids[i]);
                if (c == null) continue;
                string id = c.Id;
                float x0 = (float)i / ids.Count + 0.012f, x1 = (float)(i + 1) / ids.Count - 0.012f;
                var card = Frame(offerPanel, "Card", new Vector2(x0, 0.05f), new Vector2(x1, 0.72f), Vector2.zero, Vector2.zero, "#241418");
                var b = card.gameObject.AddComponent<Button>();
                b.onClick.AddListener(() => { pending.Add(new Command { T = "pick", Card = id }); CloseOffer(); });
                if (c.Needs != null && GameData.Sects.TryGetValue(c.Needs, out var sd))
                {
                    var band = Box(card, "Sect", new Vector2(0, 0.88f), new Vector2(1, 1), Vector2.zero, Vector2.zero, sd.Color);
                    band.GetComponent<Image>().raycastTarget = false;
                }
                var n = Label(card, c.NameTh, 22, new Vector2(0, 0.62f), new Vector2(1, 0.86f), "#FFF4DC");
                n.font = Ui.Bold; n.alignment = TextAnchor.MiddleCenter; n.resizeTextForBestFit = true; n.resizeTextMinSize = 14; n.resizeTextMaxSize = 22;
                var e = Label(card, c.EffectTh, 18, new Vector2(0, 0.06f), new Vector2(1, 0.6f), "#ECE3CF");
                e.alignment = TextAnchor.UpperCenter; e.resizeTextForBestFit = true; e.resizeTextMinSize = 12; e.resizeTextMaxSize = 18;
            }
        }

        void CloseOffer() { if (offerPanel != null) Destroy(offerPanel.gameObject); offerPanel = null; }

        // Secret arts: a row above the bottom bar. Free charges first, then each cast costs silver; cooldown fills the button.
        void BuildArtsBar(RectTransform root)
        {
            int n = GameData.Arts.Count;
            artButtons = new Button[n]; artFills = new RectTransform[n]; artSubs = new Text[n];
            if (n == 0) return;
            var bar = (RectTransform)new GameObject("Arts", typeof(RectTransform)).transform;
            bar.SetParent(root, false);
            bar.anchorMin = new Vector2(0, 0); bar.anchorMax = new Vector2(1, 0); bar.offsetMin = new Vector2(6, 138); bar.offsetMax = new Vector2(-6, 206);
            for (int i = 0; i < n; i++)
            {
                var art = GameData.Arts[i];
                string id = art.Id;
                float x0 = (float)i / n + 0.006f, x1 = (float)(i + 1) / n - 0.006f;
                var b = MakeButton(bar, "", new Vector2(x0, 0), new Vector2(x1, 1), () => pending.Add(new Command { T = "cast", Art = id }), true);
                var fill = Box((RectTransform)b.transform, "Cooldown", Vector2.zero, new Vector2(1, 0), Vector2.zero, Vector2.zero, "#000000");
                fill.GetComponent<Image>().color = new Color(0, 0, 0, 0.55f);
                fill.GetComponent<Image>().raycastTarget = false;
                var name = Label((RectTransform)b.transform, art.NameTh, 17, new Vector2(0, 0.42f), new Vector2(1, 1), "#FFF4DC");
                name.font = Ui.Bold; name.alignment = TextAnchor.MiddleCenter; name.resizeTextForBestFit = true; name.resizeTextMinSize = 11; name.resizeTextMaxSize = 17;
                var sub = Label((RectTransform)b.transform, "", 15, new Vector2(0, 0), new Vector2(1, 0.44f), "#E3B04B");
                sub.alignment = TextAnchor.MiddleCenter;
                artButtons[i] = b; artFills[i] = fill; artSubs[i] = sub;
            }
        }

        void UpdateArtsBar()
        {
            for (int i = 0; i < artButtons.Length; i++)
            {
                var art = GameData.Arts[i];
                int cd = s.ArtCd[i], charges = s.ArtCharges[i];
                artFills[i].anchorMax = new Vector2(1, art.Cooldown > 0 ? (float)cd / art.Cooldown : 0);
                artButtons[i].interactable = !paused && !s.IsOver && cd == 0 && s.Enemies.Count > 0 && (charges > 0 || s.Silver >= art.RechargeSilver);
                artSubs[i].text = cd > 0 ? Mathf.CeilToInt(cd / 20f) + L(" วิ", " s")
                    : charges > 0 ? L("ฟรีอีก ", "Free x") + charges : art.RechargeSilver + L(" ตำลึง", " silver");
            }
        }

        void TogglePause() { if (paused) ClosePause(); else OpenPause(); }

        void OpenPause()
        {
            if (s.IsOver || resultPanel != null) return;
            paused = true;
            ClosePanel();
            pauseMenu = Box(hudRoot, "Pause", Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, "#000000");
            pauseMenu.GetComponent<Image>().color = new Color(0, 0, 0, 0.6f); // also blocks taps on the board
            var box = Frame(pauseMenu, "Menu", new Vector2(0.15f, 0.36f), new Vector2(0.85f, 0.64f), Vector2.zero, Vector2.zero);
            var t = Label(box, L("พักการต่อสู้", "Paused"), 32, new Vector2(0, 0.76f), new Vector2(1, 0.96f), "#E3B04B");
            t.font = Ui.Bold; t.alignment = TextAnchor.MiddleCenter;
            MakeButton(box, L("เล่นต่อ", "Resume"), new Vector2(0.08f, 0.52f), new Vector2(0.92f, 0.72f), ClosePause, true, true);
            MakeButton(box, L("เริ่มด่านใหม่", "Restart"), new Vector2(0.08f, 0.28f), new Vector2(0.92f, 0.48f), () => { ClosePause(); Load(StageId); });
            if (Flow != null) MakeButton(box, L("กลับลานสำนัก", "Back to the courtyard"), new Vector2(0.08f, 0.04f), new Vector2(0.92f, 0.24f), Flow.LeaveBattle);
        }

        void ClosePause() { paused = false; if (pauseMenu != null) Destroy(pauseMenu.gameObject); pauseMenu = null; }

        // Every refusal from the rules becomes a short line the player understands.
        string ErrorText(string msg)
        {
            switch (msg)
            {
                case "not enough silver": return L("ตำลึงไม่พอ", "Not enough silver");
                case "cannot build here": return L("วางตรงนี้ไม่ได้", "Can't place here");
                case "sect locked": return L("ยังไม่ปลดศิษย์นี้", "This disciple is not unlocked yet");
                case "cannot upgrade": return L("อัปเกรดไม่ได้แล้ว", "Can't upgrade further");
                case "no such disciple": return null; // sold or merged in the same tick
                case "no more waves": return L("ไม่มีระลอกเหลือแล้ว", "No waves left");
                case "cannot call a wave now": return L("ตอนนี้เรียกระลอกไม่ได้", "Can't call a wave now");
                case "art on cooldown": return L("วิชายังไม่พร้อม", "That art is not ready");
                case "no enemies": return L("ยังไม่มีศัตรูให้ใช้วิชา", "No enemies to use it on");
                case "no such card on offer": return null;
                case "roster disciples cannot merge yet": return L("ศิษย์สำนักนี้ยังผสานไม่ได้", "These disciples cannot merge yet");
                case "both must be max level": return L("ต้องขั้นสูงสุดทั้งคู่จึงผสานได้", "Both must be at the highest tier");
                case "merge needs two adjacent disciples": return L("ต้องยืนติดกันจึงผสานได้", "They must stand next to each other");
                case "no combo for this pair": return L("คู่นี้ไม่มีท่าผสาน", "This pair has no combo");
                default: return null;
            }
        }

        // The Envoy seals a kit element; in a one-sect game that is one role, so name the role.
        string SealName(string el)
        {
            if (s.Sect != null)
            {
                var u = GameData.UnitList.FirstOrDefault(x => x.Sect == s.Sect && x.Element == el);
                if (u != null && GameData.RoleDefs.TryGetValue(u.RoleId, out var rd)) return L("บทบาท", "the ") + Ui.Name(rd);
            }
            return Ui.Unit(el);
        }

        // A short rising line next to a HUD element (interest next to silver).
        void FloatUi(Text anchor, string text, string color)
        {
            var t = Label((RectTransform)anchor.transform.parent, text, 20, new Vector2(0, -0.9f), new Vector2(1, 0), color);
            t.font = Ui.Bold;
            uiFloaters.Add((t, Time.time));
        }

        void UpdateFloaters()
        {
            for (int i = uiFloaters.Count - 1; i >= 0; i--)
            {
                var (t, born) = uiFloaters[i];
                float k = (Time.time - born) / 1.4f;
                if (k >= 1) { Destroy(t.gameObject); uiFloaters.RemoveAt(i); continue; }
                t.rectTransform.anchoredPosition = new Vector2(0, -k * 30);
                var c = t.color; c.a = 1 - k; t.color = c;
            }
        }

        void ShowResult(bool won, List<bool> stars)
        {
            // A full-screen backdrop: nothing behind the result can be tapped any more.
            var back = Box(hudRoot, "ResultBackdrop", Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero, "#000000");
            back.GetComponent<Image>().color = new Color(0, 0, 0, 0.6f);
            resultPanel = Frame(back, "Result", new Vector2(0.05f, 0.24f), new Vector2(0.95f, 0.76f), Vector2.zero, Vector2.zero);
            bool lesson = Flow != null && StageId == Flow.TutorialStage;
            var title = Label(resultPanel, won ? L("ชนะ!", "Victory!") : lesson ? L("จบการฝึก", "Training over") : L("พ่ายแพ้", "Defeat"), 52, new Vector2(0, 0.82f), new Vector2(1, 0.98f), won ? "#E3B04B" : "#D2412F");
            title.font = Ui.Bold; title.alignment = TextAnchor.MiddleCenter;
            int secs = s.Tick / 20;
            var stats = Label(resultPanel, L("เวลา ", "Time ") + secs / 60 + ":" + (secs % 60).ToString("00") + "   ·   " + L("เสียชีวิต ", "Lives lost ") + s.LivesLost + "   ·   " + L("ตำลึง ", "Silver ") + s.Silver,
                20, new Vector2(0, 0.74f), new Vector2(1, 0.82f), "#C9BFA8");
            stats.alignment = TextAnchor.MiddleCenter;
            var conds = GameData.Stages[StageId].Stars;
            for (int i = 0; i < stars.Count; i++)
            {
                float y1 = 0.7f - i * 0.11f;
                // A star is a gold diamond (the bundled font has no star glyph); grey when missed.
                var star = Box(resultPanel, "Star", new Vector2(0.08f, y1 - 0.075f), new Vector2(0.08f, y1 - 0.075f), new Vector2(-14, -14), new Vector2(14, 14), stars[i] ? "#FFD34A" : "#3A3442");
                star.localRotation = Quaternion.Euler(0, 0, 45);
                star.GetComponent<Image>().raycastTarget = false;
                string id = i < conds.Count ? conds[i] : "";
                var line = Label(resultPanel, StarName(id) + StarValue(id), 24, new Vector2(0.13f, y1 - 0.11f), new Vector2(0.98f, y1 - 0.01f), stars[i] ? "#ECE3CF" : "#8A8296");
                line.resizeTextForBestFit = true; line.resizeTextMinSize = 14; line.resizeTextMaxSize = 24;
            }
            if (!won && leaksByType.Count > 0)
            {
                // A loss has a reason: what got through most, and which role answers it.
                var worst = leaksByType.OrderByDescending(kv => kv.Value).First();
                var answer = GameData.RoleDefs.Values.FirstOrDefault(r => r.Counters.Contains(worst.Key) && s.Unlocked.Any(k => Ui.RoleOf(k) == r.Id));
                var reason = Label(resultPanel, L("หลุดมากสุด: ", "Most leaked: ") + Ui.Enemy(worst.Key) + " ×" + worst.Value + (answer != null ? L("  ·  ลองวาง ", "  ·  try ") + Ui.Name(answer) : ""),
                    20, new Vector2(0.04f, 0.27f), new Vector2(0.96f, 0.36f), "#FF8A6A");
                reason.alignment = TextAnchor.MiddleCenter; reason.resizeTextForBestFit = true; reason.resizeTextMinSize = 13; reason.resizeTextMaxSize = 20;
            }
            int idx = System.Array.IndexOf(Playlist, StageId);
            string next = idx >= 0 && idx + 1 < Playlist.Length ? Playlist[idx + 1] : null;
            bool tutorial = Flow != null && StageId == Flow.TutorialStage;
            if (Flow != null) Flow.StageEnded(StageId, won, stars);
            var buttons = new List<(string label, UnityEngine.Events.UnityAction act, bool primary)>
            {
                (L("เล่นอีกครั้ง", "Retry"), () => Load(StageId), !won),
            };
            if (won && next != null && !tutorial) buttons.Add((L("ด่านต่อไป", "Next stage"), () => Load(next), true));
            if (Flow != null) buttons.Add((tutorial ? L("เลือกสำนัก", "Choose a sect") : L("ลานสำนัก", "Courtyard"), Flow.LeaveBattle, tutorial));
            for (int i = 0; i < buttons.Count; i++)
            {
                float x0 = 0.03f + i * 0.94f / buttons.Count, x1 = 0.03f + (i + 1) * 0.94f / buttons.Count - 0.02f;
                MakeButton(resultPanel, buttons[i].label, new Vector2(x0, 0.04f), new Vector2(x1, 0.22f), buttons[i].act, true, buttons[i].primary);
            }
        }

        // The measured value next to each star, so the player sees how close a missed one was.
        string StarValue(string id)
        {
            int secs = s.Tick / 20;
            switch (id)
            {
                case "no_life_lost": return L("  (เสีย ", "  (lost ") + s.LivesLost + ")";
                case "under_3min": return "  (" + secs / 60 + ":" + (secs % 60).ToString("00") + ")";
                case "hold_200_silver": return "  (" + s.Silver + ")";
                case "max_6_disciples": return L("  (สูงสุด ", "  (peak ") + s.PeakDisciples + ")";
                case "max_2_sects": return "  (" + s.SectsUsed.Count + ")";
                default: return "";
            }
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
                case "max_6_disciples": return L("ใช้ศิษย์ไม่เกิน 6 ตัว", "At most 6 disciples");
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
            board?.Dispose();
            if (Camera.main != null) Camera.main.cullingMask = ~0;
            Destroy(world.gameObject);
            Destroy(canvasRoot.gameObject);
            Destroy(gameObject);
        }

        // Calling mid-fight overlaps waves for a bonus (defend.ts nextWave); show what it pays right now.
        string WaveButtonLabel()
        {
            if (s.IsOver) return "";
            if (s.Wave >= s.TotalWaves) return L("ระลอกสุดท้าย", "Final wave");
            // The wave also starts by itself: show the seconds left so the player knows the clock is running.
            if (s.Phase == "build") return L("เริ่มบุก", "Start wave") + "  (" + Mathf.CeilToInt(Mathf.Max(0, Defend.AutoStartTicks - s.Tick) / 20f) + ")";
            if (s.Phase == "picking") return L("เลือกคัมภีร์...", "Pick a manual...");
            if (s.Phase == "break") return L("ระลอกถัดไป +", "Next wave +") + GameData.EarlyCallBonus + "  (" + Mathf.CeilToInt(s.BreakT / 20f) + ")";
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

        // Pictures of the enemy kinds the next wave brings (3D portraits, or sprites in 2D), rebuilt only when it changes.
        void UpdateNextStrip()
        {
            // Exactly what the rules will spawn next (including the boss), so the pictures never lie.
            var types = s.Wave < s.TotalWaves ? Defend.WaveEntries(StageId, s.Wave + 1, s.NextRecipe).Select(q => q.Type).ToList() : new List<string>();
            string key = string.Join(",", types.Distinct().Reverse().Take(5));
            if (key == nextStripKey) return;
            nextStripKey = key;
            foreach (Transform c in nextStrip) Destroy(c.gameObject);
            var list = key.Length == 0 ? new string[0] : key.Split(',');
            for (int i = 0; i < list.Length; i++)
            {
                var go = new GameObject("Foe", typeof(RectTransform), board != null ? typeof(RawImage) : typeof(Image));
                var rt = (RectTransform)go.transform;
                rt.SetParent(nextStrip, false);
                rt.anchorMin = new Vector2(1 - (i + 1) * 0.2f, 0); rt.anchorMax = new Vector2(1 - i * 0.2f, 1); rt.offsetMin = rt.offsetMax = Vector2.zero;
                if (board != null) go.GetComponent<RawImage>().texture = board.FoePortrait(list[i]);
                else { var im = go.GetComponent<Image>(); im.sprite = Art.Enemy(list[i]); im.preserveAspect = true; }
                go.GetComponent<Graphic>().raycastTarget = false;
            }
        }

        void UpdateBossBar()
        {
            Enemy boss = null;
            foreach (var e in s.Enemies) if (GameData.Enemies[e.Type].Boss != null) { boss = e; break; }
            bossBar.gameObject.SetActive(boss != null);
            if (boss == null) return;
            bossFill.anchorMax = new Vector2(Mathf.Clamp01((float)boss.Hp / boss.MaxHp), 1);
            bossName.text = Ui.Enemy(boss.Type) + (s.SealT > 0 ? L("  ผนึก: ", "  sealed: ") + SealName(s.SealEl) : "");
        }

        void Toast(string msg, float seconds)
        {
            if (string.IsNullOrEmpty(msg)) return;
            if (Time.time >= toastUntil) { ShowToast(msg, seconds); return; }
            if (msg == toastNow || toasts.Any(t => t.msg == msg) || toasts.Count >= 3) return;
            toasts.Enqueue((msg, seconds));
        }

        void ShowToast(string msg, float seconds) { toastNow = msg; toastText.text = msg; toastUntil = Time.time + seconds; }

        void UpdateToast()
        {
            if (Time.time >= toastUntil)
            {
                if (toasts.Count > 0) { var (m, sec) = toasts.Dequeue(); ShowToast(m, Mathf.Min(sec, 1.6f)); }
                else if (toastNow != null) { toastNow = null; toastText.text = ""; }
            }
            // Keep clear of an open top panel.
            bool low = panel != null && panelTop;
            toastText.rectTransform.anchorMin = new Vector2(0, low ? 0.36f : 0.62f);
            toastText.rectTransform.anchorMax = new Vector2(1, low ? 0.44f : 0.7f);
        }

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
                string name = need == "air" ? L("ตีอากาศ", "anti-air") : GameData.RoleDefs.TryGetValue(need, out var rd) ? Ui.Name(rd) : need;
                parts.Add(have ? name : "<color=#D2412F>" + name + "</color>");
            }
            return L("  · ต้องการ: ", "  · needs: ") + string.Join(", ", parts);
        }

        // A leak says what got through, so a loss has a reason (SPEC-core §2.3).
        void LeakToast(int id)
        {
            if (!typeOf.TryGetValue(id, out var type) || !GameData.Enemies.TryGetValue(type, out var def)) return;
            Toast(L("หลุดเข้าประตู: ", "Leaked: ") + Ui.Name(def) + " — " + L(def.TraitTh, def.TraitEn ?? ""), 2.5f);
        }

        void UpdateHud()
        {
            if (s.Silver != hudSilver) { hudSilver = s.Silver; silverText.text = L("ตำลึง ", "Silver ") + s.Silver; }
            if (s.Lives != hudLives) { hudLives = s.Lives; livesText.text = L("ชีวิต ", "Lives ") + s.Lives; }
            if (s.Wave != hudWave) { hudWave = s.Wave; waveText.text = L("ระลอก ", "Wave ") + s.Wave + "/" + s.TotalWaves; }
            if (Time.unscaledTime >= waveLabelAt)
            {
                waveLabelAt = Time.unscaledTime + 0.2f;
                waveButtonText.text = WaveButtonLabel();
            }
            waveButton.interactable = !paused && !s.IsOver && s.Wave < s.TotalWaves && s.Phase != "picking";
            // The start button breathes while the player is still setting up, so the next action is obvious.
            float beat = s.Phase == "build" ? 1 + Mathf.Sin(Time.time * 4) * 0.03f : 1;
            waveButton.transform.localScale = new Vector3(beat, beat, 1);
            if (s.Wave != nextWaveSeen || !ReferenceEquals(s.NextRecipe, nextRecipeSeen) || s.Disciples.Count != nextCount)
            {
                nextWaveSeen = s.Wave; nextRecipeSeen = s.NextRecipe; nextCount = s.Disciples.Count;
                nextText.text = s.Wave < s.TotalWaves ? L("ระลอกถัดไป: ", "Next: ") + RecipeName(s.NextRecipe) + (NextIsBoss() ? L(" + บอส!", " + BOSS!") : "") + Needs() : "";
                UpdateNextStrip();
            }
            if (offerPanel != null)
            {
                if (s.Phase != "picking") CloseOffer();
                else offerTimer.text = L("เลือกอัตโนมัติใน ", "Auto-pick in ") + Mathf.CeilToInt(s.OfferT / 20f) + L(" วิ", " s");
            }
            UpdateArtsBar();
            UpdateBossBar();
            UpdateToast();
            UpdateFloaters();
            if (!fpsText.gameObject.activeSelf) return;
            fpsSmoothed = Mathf.Lerp(fpsSmoothed, 1f / Mathf.Max(0.0001f, Time.unscaledDeltaTime), 0.05f);
            if (Time.unscaledTime >= nextFpsUpdate)
            {
                nextFpsUpdate = Time.unscaledTime + 0.25f;
                fpsText.text = Mathf.RoundToInt(fpsSmoothed) + " fps, boot " + firstFrameAt.ToString("0.00") + "s";
            }
        }
    }
}
