// The player's path from app start to play (docs/specs/SPEC-front-flow.md §2):
// first run:  Boot → Consent → Intro → tutorial T-0 → Sect pick → Name → Loading → 1-1 → Lobby
// later runs: Boot → Lobby. Each screen is one canvas built from code; showing a screen drops the last one.
using System.Collections.Generic;
using System.Linq;
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace FiveSects.Game
{
    public class Flow : MonoBehaviour
    {
        public const string TutorialStage = "T-0";

        public IAuthService Auth = new GuestAuth();
        public IProfileStore Store = new FileProfileStore();
        public IRemoteConfig Remote = new BuiltInRemoteConfig();
        public IAnalytics Analytics = new FileAnalytics();

        public Profile Profile { get; private set; }
        RemoteConfig config;
        RectTransform screen;
        DefendView battle;
        System.Action afterFrame; // runs next frame, so a loading screen is drawn before the work starts
        bool skipFrame;
        int introPage;
        float introAt;
        float loadingStartedAt;

        static string L(string th, string en) => Ui.L(th, en);

        void Start()
        {
            Analytics.Track("boot_start");
            Profile = Store.Load();
            ShowBoot();
        }

        void Update()
        {
            if (afterFrame != null)
            {
                if (skipFrame) { skipFrame = false; return; }
                var a = afterFrame; afterFrame = null; a();
            }
            if (introPage > 0 && Time.realtimeSinceStartup - introAt > 6f) NextIntroPage();
        }

        void Show(RectTransform next)
        {
            if (screen != null) Destroy(screen.gameObject);
            screen = next;
        }

        void Save() => Store.Save(Profile);

        // ---------- ① Boot ----------

        void ShowBoot()
        {
            var r = Ui.NewScreen("Boot");
            Show(r);
            Ui.Label(r, L("ศึกห้าสำนัก", "Five Sects"), 72, new Vector2(0, 0.5f), new Vector2(1, 0.62f), "#E3B04B");
            var status = Ui.Label(r, L("กำลังตรวจเวอร์ชัน…", "Checking version…"), 24, new Vector2(0, 0.08f), new Vector2(1, 0.14f), "#9A92AE");
            Ui.Label(r, "v" + Application.version, 20, new Vector2(0, 0.02f), new Vector2(1, 0.06f), "#5A5266");

            config = Remote.Fetch();
            if (config.Maintenance) { status.text = L(config.MaintenanceTh, config.MaintenanceEn); return; }
            if (OlderThan(Application.version, config.MinVersion))
            {
                status.text = L("มีเวอร์ชันใหม่ กรุณาอัปเดตก่อนเล่น", "A new version is out. Please update to play.");
                return;
            }
            Auth.SignIn(Profile);
            Save();
            Analytics.Track("boot_ok", Profile.PlayerId);
            Next(() =>
            {
                if (!Profile.Consented) ShowConsent();
                else if (!Profile.TutorialDone) ShowIntro();
                else if (string.IsNullOrEmpty(Profile.Sect)) ShowSectPick();
                else if (string.IsNullOrEmpty(Profile.Name)) ShowName();
                else ShowLobby();
            });
        }

        static bool OlderThan(string have, string min)
        {
            try { return new System.Version(have) < new System.Version(min); }
            catch (System.Exception) { return false; } // unparseable versions never lock players out
        }

        void Next(System.Action a) { afterFrame = a; skipFrame = true; }

        // ---------- ② Consent ----------

        void ShowConsent()
        {
            var r = Ui.NewScreen("Consent");
            Show(r);
            int year = 2005;
            Ui.Label(r, L("ก่อนเริ่มเล่น", "Before you play"), 48, new Vector2(0, 0.8f), new Vector2(1, 0.9f), "#E3B04B");
            Ui.Label(r, L("การกด \"เริ่มเล่น\" ถือว่ายอมรับข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว (PDPA)\nเราเก็บรหัสผู้เล่นและความคืบหน้าเพื่อเซฟเกมเท่านั้น",
                "By tapping Start you accept the Terms of Service and the Privacy Policy.\nWe keep your player id and progress only to save your game."),
                24, new Vector2(0.05f, 0.58f), new Vector2(0.95f, 0.78f));
            Ui.Label(r, L("ปีเกิด (ใช้ตั้งเพดานการใช้จ่ายของผู้เยาว์)", "Birth year (sets spending limits for minors)"), 24, new Vector2(0, 0.48f), new Vector2(1, 0.54f), "#9A92AE");
            var yearText = Ui.Label(r, year.ToString(), 44, new Vector2(0.35f, 0.38f), new Vector2(0.65f, 0.47f));
            Ui.Btn(r, "-", new Vector2(0.15f, 0.39f), new Vector2(0.32f, 0.46f), () => { year--; yearText.text = year.ToString(); });
            Ui.Btn(r, "+", new Vector2(0.68f, 0.39f), new Vector2(0.85f, 0.46f), () => { year++; yearText.text = year.ToString(); });
            Ui.Btn(r, L("เริ่มเล่น", "Start"), new Vector2(0.2f, 0.18f), new Vector2(0.8f, 0.28f), () =>
            {
                Profile.Consented = true; Profile.BirthYear = year; Save();
                Analytics.Track("consent_ok", year.ToString());
                ShowIntro();
            }, true, "#8A2A1F", 36);
        }

        // ---------- ③ Intro (placeholder text until the illustration frames exist) ----------

        static readonly string[][] IntroPages =
        {
            new[] { "คืนจันทร์สีเลือด นิกายจันทร์โลหิตบุกหมู่บ้านเชิงเขา", "On a blood-red moon, the Blood Moon cult storms the village below the mountains." },
            new[] { "ห้าสำนักแห่งยุทธภพส่งศิษย์ลงมาช่วย แต่ละสำนักมีวิชาของตัวเอง", "The five sects send disciples down to help, each with its own art." },
            new[] { "จงวางศิษย์ขวางทางมาร อย่าให้ผ่านประตูหมู่บ้าน", "Place disciples along the road. Let nothing through the village gate." },
        };

        void ShowIntro() { introPage = 0; NextIntroPage(); }

        void NextIntroPage()
        {
            if (introPage >= IntroPages.Length) { introPage = 0; StartStage(TutorialStage); return; }
            var r = Ui.NewScreen("Intro", "#120A10");
            Show(r);
            var page = IntroPages[introPage];
            Ui.Label(r, L(page[0], page[1]), 34, new Vector2(0.08f, 0.4f), new Vector2(0.92f, 0.6f));
            var tap = Ui.Btn(r, "", Vector2.zero, Vector2.one, NextIntroPage, true, "#00000000");
            Ui.Btn(r, L("ข้าม", "Skip"), new Vector2(0.72f, 0.92f), new Vector2(0.96f, 0.98f), () =>
            {
                Analytics.Track("intro_skip", introPage.ToString());
                introPage = 0; StartStage(TutorialStage);
            }, true, "#221C2A", 24);
            introPage++;
            introAt = Time.realtimeSinceStartup;
        }

        // ---------- ⑤ Sect pick ----------

        void ShowSectPick()
        {
            var r = Ui.NewScreen("SectPick");
            Show(r);
            Analytics.Track("sect_view");
            Ui.Label(r, L("เลือกสำนักต้นสังกัด", "Choose your sect"), 44, new Vector2(0, 0.9f), new Vector2(1, 0.97f), "#E3B04B");
            var launch = GameData.Allegiance;
            var upcoming = GameData.UpcomingSects;
            int rows = launch.Count + upcoming.Count;
            float top = 0.88f, h = 0.84f / rows;
            for (int i = 0; i < launch.Count; i++)
            {
                var entry = launch[i];
                string el = entry.Element;
                var def = GameData.Sects[el];
                float y1 = top - i * h, y0 = y1 - h + 0.01f;
                string label = Ui.Name(def) + "   " + new string('*', entry.Difficulty);
                bool ready = GameData.RosterSects.Contains(el); // sects whose 5-role roster is in the game yet
                if (!ready) label += L("  · กำลังพัฒนา", "  · coming soon");
                var b = Ui.Btn(r, label, new Vector2(0.05f, y0), new Vector2(0.95f, y1), () => ShowSectDetail(el, entry), ready, "#2A1E14", 30);
                Ui.Box((RectTransform)b.transform, "Mark", new Vector2(0, 0), new Vector2(0.03f, 1), def.Color);
            }
            for (int i = 0; i < upcoming.Count; i++)
            {
                var u = upcoming[i];
                float y1 = top - (launch.Count + i) * h, y0 = y1 - h + 0.01f;
                Ui.Btn(r, L(u.NameTh, u.NameEn) + L("  · เปิดเดือนที่ ", "  · opens in month ") + u.OpensMonth,
                    new Vector2(0.05f, y0), new Vector2(0.95f, y1), null, false);
            }
        }

        void ShowSectDetail(string el, AllegianceDef entry)
        {
            var def = GameData.Sects[el];
            var r = Ui.NewScreen("SectDetail");
            Show(r);
            Ui.Box(r, "Band", new Vector2(0, 0.86f), new Vector2(1, 0.87f), def.Color);
            Ui.Label(r, Ui.Name(def), 52, new Vector2(0, 0.75f), new Vector2(1, 0.85f), def.Color);
            Ui.Label(r, L("กฎประจำสำนัก", "Sect rule"), 24, new Vector2(0, 0.66f), new Vector2(1, 0.71f), "#9A92AE");
            Ui.Label(r, entry.RuleTh, 32, new Vector2(0.05f, 0.56f), new Vector2(0.95f, 0.66f));
            Ui.Label(r, L("ความยาก ", "Difficulty ") + new string('*', entry.Difficulty), 26, new Vector2(0.05f, 0.46f), new Vector2(0.95f, 0.54f), "#9A92AE");
            var units = GameData.UnitList.Where(u => u.Sect == el).ToList();
            for (int i = 0; i < units.Count; i++)
            {
                var u = units[i];
                string role = GameData.RoleDefs.TryGetValue(u.RoleId, out var rd) ? rd.NameTh : u.RoleId;
                float y1 = 0.40f - i * 0.045f;
                Ui.Label(r, (rd != null ? Ui.Name(rd) : role) + " · " + Ui.Name(u) + "  —  " + L(u.DescTh, u.DescEn), 18, new Vector2(0.08f, y1 - 0.04f), new Vector2(0.92f, y1), "#ECE3CF", TextAnchor.MiddleLeft);
            }
            Ui.Btn(r, L("กลับ", "Back"), new Vector2(0.05f, 0.08f), new Vector2(0.35f, 0.17f), ShowSectPick, true, "#221C2A");
            Ui.Btn(r, L("เข้าสำนักนี้", "Join this sect"), new Vector2(0.4f, 0.08f), new Vector2(0.95f, 0.17f), () => ConfirmSect(el), true, "#8A2A1F", 32);
        }

        // Told plainly before the pick: changing later needs the sect-change token (SPEC-front-flow §5).
        void ConfirmSect(string el)
        {
            var dlg = Ui.Box(screen, "Confirm", Vector2.zero, Vector2.one, "#000000CC");
            var box = Ui.Box(dlg, "Box", new Vector2(0.08f, 0.35f), new Vector2(0.92f, 0.65f), "#17121F");
            Ui.Label(box, L("ยืนยันเข้าสำนักนี้?\nเปลี่ยนสำนักภายหลังต้องใช้ \"ป้ายย้ายสังกัด\"\nความก้าวหน้าของแต่ละสำนักไม่หาย",
                "Join this sect?\nChanging later needs a Sect Transfer token.\nProgress in each sect is kept."), 28, new Vector2(0, 0.35f), new Vector2(1, 0.95f));
            Ui.Btn(box, L("ยกเลิก", "Cancel"), new Vector2(0.05f, 0.06f), new Vector2(0.45f, 0.3f), () => Destroy(dlg.gameObject), true, "#221C2A");
            Ui.Btn(box, L("ยืนยัน", "Confirm"), new Vector2(0.55f, 0.06f), new Vector2(0.95f, 0.3f), () =>
            {
                Profile.Sect = el; Save();
                Analytics.Track("sect_pick", el);
                ShowName();
            }, true, "#8A2A1F");
        }

        // ---------- ⑥ Name ----------

        static readonly string[] NameA = { "หลิว", "เซียว", "หาน", "ซือ", "เยว่", "ฉิน", "ไป๋", "หลง", "เมิ่ง", "ซ่ง" };
        static readonly string[] NameB = { "อวิ๋น", "เฟิง", "เสวี่ย", "หยาง", "อี้", "หลาน", "จิ่ว", "ซิน", "เหอ", "ชิง" };
        static readonly string[] NameEnA = { "Liu", "Xiao", "Han", "Si", "Yue", "Qin", "Bai", "Long", "Meng", "Song" };
        static readonly string[] NameEnB = { "Yun", "Feng", "Xue", "Yang", "Yi", "Lan", "Jiu", "Xin", "He", "Qing" };

        static string RandomName()
        {
            int a = Random.Range(0, NameA.Length), b = Random.Range(0, NameB.Length);
            return Ui.Thai ? NameA[a] + NameB[b] : NameEnA[a] + " " + NameEnB[b];
        }

        void ShowName()
        {
            var r = Ui.NewScreen("Name");
            Show(r);
            Ui.Label(r, L("ฉายาของท่าน", "Your name"), 44, new Vector2(0, 0.7f), new Vector2(1, 0.78f), "#E3B04B");
            var field = Ui.Field(r, RandomName(), new Vector2(0.1f, 0.56f), new Vector2(0.9f, 0.66f), 12);
            var error = Ui.Label(r, "", 22, new Vector2(0, 0.5f), new Vector2(1, 0.55f), "#D2412F");
            Ui.Btn(r, L("สุ่มชื่อ", "Random"), new Vector2(0.1f, 0.4f), new Vector2(0.45f, 0.48f), () => field.text = RandomName(), true, "#221C2A");
            Ui.Btn(r, L("ยืนยัน", "Confirm"), new Vector2(0.55f, 0.4f), new Vector2(0.9f, 0.48f), () =>
            {
                string n = (field.text ?? "").Trim();
                if (n.Length < 2) { error.text = L("ชื่อต้องยาว 2–12 ตัวอักษร", "Names are 2-12 characters"); return; }
                // The server re-checks names against the profanity list when accounts move online (M1).
                Profile.Name = n; Save();
                Analytics.Track("name_set");
                StartStage(NextStoryStage());
            }, true, "#8A2A1F");
        }

        // ---------- ⑧ Lobby (ลานสำนัก) ----------

        string NextStoryStage() => DefendView.Playlist.FirstOrDefault(id => id != "T-1" && !Profile.Cleared.Contains(id)) ?? "T-1";

        void ShowLobby()
        {
            var r = Ui.NewScreen("Lobby", "#100C16");
            Show(r);
            Analytics.Track("lobby_open");
            var def = GameData.Sects[Profile.Sect];
            var top = Ui.Box(r, "Top", new Vector2(0, 0.93f), new Vector2(1, 1), "#0E0B14");
            Ui.Box(top, "Seal", new Vector2(0.02f, 0.15f), new Vector2(0.1f, 0.85f), def.Color);
            Ui.Label(top, Profile.Name + "  ·  " + Ui.Name(def), 26, new Vector2(0.11f, 0), new Vector2(0.75f, 1), "#ECE3CF", TextAnchor.MiddleLeft);
            Ui.Label(top, L("หยก 0", "Jade 0"), 24, new Vector2(0.75f, 0), new Vector2(1, 1), "#5BC46A", TextAnchor.MiddleRight);

            // Side shortcuts unlock with progress (release-systems §5); locked ones say where they open.
            int cleared = Profile.Cleared.Count;
            SideButton(r, 0, L("ภารกิจรายวัน", "Daily missions"), cleared >= 1, "1-1");
            SideButton(r, 1, L("กล่องจดหมาย", "Mail"), cleared >= 1, "1-1");
            SideButton(r, 2, L("อีเวนต์", "Events"), cleared >= 3, "1-4");

            string next = NextStoryStage();
            Ui.Btn(r, L("เข้าสู่ยุทธภพ\n", "Enter the Jianghu\n") + next, new Vector2(0.15f, 0.36f), new Vector2(0.85f, 0.52f),
                () => StartStage(next), true, "#8A2A1F", 40);

            if (Profile.FirstPlaceMs >= 0)
                Ui.Label(r, L("เวลาจากเปิดเกมถึงวางศิษย์ตัวแรก: ", "App start to first disciple placed: ") + (Profile.FirstPlaceMs / 1000f).ToString("0.0") + L(" วินาที", " s"),
                    20, new Vector2(0, 0.2f), new Vector2(1, 0.24f), "#9A92AE");
            Ui.Label(r, FileAnalytics.PathOf, 16, new Vector2(0, 0.16f), new Vector2(1, 0.2f), "#5A5266");
            Ui.Btn(r, Profile.Classic2D ? L("ภาพด่าน: 2D (แตะเพื่อเปลี่ยนเป็น 3D)", "Battle view: 2D (tap for 3D)") : L("ภาพด่าน: 3D (แตะเพื่อเปลี่ยนเป็น 2D)", "Battle view: 3D (tap for 2D)"),
                new Vector2(0.2f, 0.27f), new Vector2(0.8f, 0.33f), () =>
            {
                Profile.Classic2D = !Profile.Classic2D; Save();
                Analytics.Track("battle_view", Profile.Classic2D ? "2d" : "3d");
                ShowLobby();
            }, true, "#2A1E14", 24);
            Ui.Btn(r, L("เริ่มใหม่ (ลบเซฟทดสอบ)", "Start over (delete test save)"), new Vector2(0.25f, 0.11f), new Vector2(0.75f, 0.155f), () =>
            {
                Store.Reset(); Profile = new Profile(); Analytics.Track("profile_reset"); ShowBoot();
            }, true, "#221C2A", 20);

            string[] tabs = { L("ศิษย์", "Disciples"), L("คัมภีร์", "Codex"), L("ลานสำนัก", "Base"), L("ศึก", "Battle"), L("ร้าน", "Shop") };
            string[] opensAt = { "1-2", "1-6", "1-1", "1-12", "1-4" };
            for (int i = 0; i < tabs.Length; i++)
            {
                bool open = Profile.Cleared.Contains(opensAt[i]) && (i != 4 || config.ShopEnabled) && (i != 3 || config.PvpEnabled);
                Ui.Btn(r, open ? tabs[i] : tabs[i] + "\n" + opensAt[i], new Vector2(i / 5f + 0.005f, 0.005f), new Vector2((i + 1) / 5f - 0.005f, 0.09f), null, open, "#2A1E14", 22);
            }
        }

        void SideButton(RectTransform r, int i, string text, bool open, string opensAt)
        {
            float y1 = 0.88f - i * 0.08f;
            Ui.Btn(r, open ? text : text + " · " + opensAt, new Vector2(0.02f, y1 - 0.07f), new Vector2(0.4f, y1), null, open, "#2A1E14", 22);
        }

        // ---------- ⑦ Loading → battle ----------

        public void StartStage(string stageId)
        {
            var r = Ui.NewScreen("Loading");
            Show(r);
            string sect = Profile.Sect != null && GameData.Sects.ContainsKey(Profile.Sect) ? Ui.Name(GameData.Sects[Profile.Sect]) : "";
            Ui.Label(r, sect, 36, new Vector2(0, 0.6f), new Vector2(1, 0.68f), "#E3B04B");
            Ui.Label(r, stageId == TutorialStage ? L("ลานฝึก", "Training ground") : stageId, 44, new Vector2(0, 0.5f), new Vector2(1, 0.58f));
            Ui.Label(r, L(Tips[stageId.GetHashCode() & 3][0], Tips[stageId.GetHashCode() & 3][1]), 24, new Vector2(0.06f, 0.12f), new Vector2(0.94f, 0.22f), "#9A92AE");
            loadingStartedAt = Time.realtimeSinceStartup;
            Analytics.Track("stage_start", stageId);
            Next(() =>
            {
                battle = new GameObject("Five Sects").AddComponent<DefendView>();
                battle.StageId = stageId;
                battle.Flow = this;
            });
        }

        static readonly string[][] Tips =
        {
            new[] { "ศิษย์ที่วางติดกับธาตุที่ให้กำเนิดจะแรงขึ้น", "Disciples next to the element that feeds theirs hit harder." },
            new[] { "เรียกคลื่นศัตรูก่อนเวลาได้ตำลึงโบนัส", "Calling a wave early pays bonus silver." },
            new[] { "ศัตรูบางตัวบินได้ ศิษย์บางสำนักตีไม่ถึง", "Some enemies fly, and some sects can't reach them." },
            new[] { "ผสานศิษย์สองธาตุได้ร่างผสานที่แรงกว่าเดิม", "Merge two elements into a stronger combined form." },
        };

        // Called by DefendView on its first frame, so the loading screen covers the whole build of the stage.
        public void BattleReady()
        {
            Analytics.Track("loading_ms", ((int)((Time.realtimeSinceStartup - loadingStartedAt) * 1000)).ToString());
            if (screen != null) Destroy(screen.gameObject);
            screen = null;
        }

        public void FirstPlace()
        {
            if (Profile.FirstPlaceMs >= 0) return;
            Profile.FirstPlaceMs = (long)(Time.realtimeSinceStartup * 1000);
            Save();
            Analytics.Track("first_place_ms", Profile.FirstPlaceMs.ToString());
        }

        public void StageEnded(string stageId, bool won, List<bool> stars)
        {
            Analytics.Track("stage_end", stageId + (won ? " won " : " lost ") + stars.Count(x => x));
            if (stageId == TutorialStage) Profile.TutorialDone = true;
            else if (won && !Profile.Cleared.Contains(stageId)) Profile.Cleared.Add(stageId);
            Save();
        }

        // Result-screen exits. The tutorial goes on to the sect pick; story stages go back to the lobby.
        public void LeaveBattle()
        {
            if (battle != null) battle.Close();
            battle = null;
            if (string.IsNullOrEmpty(Profile.Sect)) ShowSectPick();
            else if (string.IsNullOrEmpty(Profile.Name)) ShowName();
            else ShowLobby();
        }
    }
}
