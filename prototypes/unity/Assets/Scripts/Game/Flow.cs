// The player's path from app start to play (docs/specs/SPEC-front-flow.md §2):
// first run:  Boot → Consent → Intro → tutorial T-0 → Sect pick → Name → Loading → 1-1 → Lobby
// later runs: Boot → Lobby. Each screen is one canvas built from code; showing a screen drops the last one.
// The lobby follows SPEC-core §6: a goal line, the chapter map with stars, and five tabs that unlock by stage.
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.UI;

namespace FiveSects.Game
{
    public class Flow : MonoBehaviour
    {
        public const string TutorialStage = "T-0";
        const float MinLoadingSec = 1f;

        public IAuthService Auth = new GuestAuth();
        public IProfileStore Store = new FileProfileStore();
        public IRemoteConfig Remote = new BuiltInRemoteConfig();
        public IAnalytics Analytics = new FileAnalytics();

        public Profile Profile { get; private set; }
        RemoteConfig config;
        RectTransform screen;           // safe-area rect of the current screen; screen.root is its canvas
        DefendView battle;
        System.Action afterFrame;       // runs next frame, so a loading screen is drawn before the work starts
        bool skipFrame;
        int introPage;
        float introAt;
        float loadingStartedAt;
        System.Action back;             // what Android Back does on the current screen (null: nothing)
        Text toast;
        float toastUntil;
        readonly HashSet<string> tracked = new HashSet<string>(); // funnel events sent once per session
        string lastRandomName;
        RectTransform loadingFill;
        string lobbyTab = "home";

        static string L(string th, string en) => Ui.L(th, en);

        void Start()
        {
            Bootstrap.LoadData();
            Analytics.Track("boot_start");
            Profile = Store.Load();
            Profile.Migrate();
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
            if (toast != null && Time.time > toastUntil) { Destroy(toast.transform.parent.gameObject); toast = null; }
            if (loadingFill != null) loadingFill.anchorMax = new Vector2(Mathf.Clamp01((Time.realtimeSinceStartup - loadingStartedAt) / MinLoadingSec), 1);
            if (battle == null && back != null && Ui.BackPressed()) back();
        }

        void Show(RectTransform next, System.Action onBack = null)
        {
            if (screen != null) Destroy(screen.root.gameObject);
            screen = next;
            back = onBack;
            toast = null;
        }

        void Save() => Store.Save(Profile);

        void Once(string ev, string data = null) { if (tracked.Add(ev)) Analytics.Track(ev, data); }

        // A short message at the bottom of the current screen.
        void Toast(string msg)
        {
            if (screen == null) return;
            if (toast != null) Destroy(toast.transform.parent.gameObject);
            var box = Ui.Panel(screen, "Toast", new Vector2(0.08f, 0.13f), new Vector2(0.92f, 0.19f));
            toast = Ui.Label(box, msg, 24, Vector2.zero, Vector2.one);
            toastUntil = Time.time + 1.8f;
        }

        // ---------- ① Boot ----------

        void ShowBoot()
        {
            var r = Ui.NewScreen("Boot");
            Show(r);
            Ui.Label(r, L("ศึกห้าสำนัก", "Five Sects"), 72, new Vector2(0, 0.5f), new Vector2(1, 0.62f), "#E3B04B").font = Ui.Bold;
            var status = Ui.Label(r, L("กำลังตรวจเวอร์ชัน…", "Checking version…"), 24, new Vector2(0, 0.3f), new Vector2(1, 0.36f), "#9A92AE");
            Ui.Label(r, "v" + Application.version, 20, new Vector2(0, 0.02f), new Vector2(1, 0.06f), "#5A5266");

            config = Remote.Fetch();
            if (config.Maintenance)
            {
                // Closed for maintenance: say so (with a default line if the config has none) and let the player retry.
                string msg = L(config.MaintenanceTh, config.MaintenanceEn);
                status.text = string.IsNullOrEmpty(msg) ? L("ปิดปรับปรุงชั่วคราว กรุณากลับมาใหม่อีกสักครู่", "Down for maintenance. Please come back shortly.") : msg;
                Ui.Btn(r, L("ลองใหม่", "Try again"), new Vector2(0.25f, 0.18f), new Vector2(0.75f, 0.26f), ShowBoot, true, Ui.Primary);
                return;
            }
            if (OlderThan(Application.version, config.MinVersion))
            {
                status.text = L("มีเวอร์ชันใหม่ กรุณาอัปเดตก่อนเล่น", "A new version is out. Please update to play.");
                bool store = !string.IsNullOrEmpty(config.StoreUrl);
                Ui.Btn(r, L("อัปเดต", "Update"), new Vector2(0.25f, 0.18f), new Vector2(0.75f, 0.26f), () => Application.OpenURL(config.StoreUrl), store, Ui.Primary);
                Ui.Btn(r, L("ลองใหม่", "Try again"), new Vector2(0.25f, 0.08f), new Vector2(0.75f, 0.16f), ShowBoot);
                return;
            }
            Auth.SignIn(Profile);
            Save();
            Analytics.Track("boot_ok", Profile.PlayerId);
            Next(() =>
            {
                if (!Profile.Consented) ShowConsent();
                else if (!Profile.TutorialDone) { if (Profile.IntroSeen) StartStage(TutorialStage); else ShowIntro(); }
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
            Once("consent_view");
            int thisYear = System.DateTime.Now.Year;
            int year = 0; // nothing chosen yet: never assume an adult
            Ui.Label(r, L("ก่อนเริ่มเล่น", "Before you play"), 48, new Vector2(0, 0.82f), new Vector2(1, 0.92f), "#E3B04B").font = Ui.Bold;
            Ui.Label(r, L("การกด \"เริ่มเล่น\" ถือว่ายอมรับข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว (PDPA)\nเราเก็บรหัสผู้เล่นและความคืบหน้าเพื่อเซฟเกมเท่านั้น",
                "By tapping Start you accept the Terms of Service and the Privacy Policy.\nWe keep your player id and progress only to save your game."),
                24, new Vector2(0.05f, 0.62f), new Vector2(0.95f, 0.8f));
            if (!string.IsNullOrEmpty(config.TermsUrl))
                Ui.Btn(r, L("ข้อตกลง", "Terms"), new Vector2(0.1f, 0.56f), new Vector2(0.48f, 0.61f), () => Application.OpenURL(config.TermsUrl), true, Ui.Secondary, 20);
            if (!string.IsNullOrEmpty(config.PrivacyUrl))
                Ui.Btn(r, L("ความเป็นส่วนตัว", "Privacy"), new Vector2(0.52f, 0.56f), new Vector2(0.9f, 0.61f), () => Application.OpenURL(config.PrivacyUrl), true, Ui.Secondary, 20);
            Ui.Label(r, L("ปีเกิด (ใช้ตั้งเพดานการใช้จ่ายของผู้เยาว์)", "Birth year (sets spending limits for minors)"), 24, new Vector2(0, 0.48f), new Vector2(1, 0.54f), "#9A92AE");
            var yearText = Ui.Label(r, L("แตะ - / + เพื่อเลือก", "Tap - / + to choose"), 40, new Vector2(0.3f, 0.38f), new Vector2(0.7f, 0.47f));
            Button start = null;
            void Set(int y)
            {
                year = Mathf.Clamp(y, 1930, thisYear);
                yearText.text = year.ToString();
                start.interactable = true;
            }
            // A first tap lands mid-range; after that +-1 and +-10 step from the chosen year.
            Ui.Btn(r, "-10", new Vector2(0.02f, 0.39f), new Vector2(0.14f, 0.46f), () => Set(year == 0 ? 2000 : year - 10), true, Ui.Secondary, 24);
            Ui.Btn(r, "-1", new Vector2(0.15f, 0.39f), new Vector2(0.28f, 0.46f), () => Set(year == 0 ? 2000 : year - 1), true, Ui.Secondary, 24);
            Ui.Btn(r, "+1", new Vector2(0.72f, 0.39f), new Vector2(0.85f, 0.46f), () => Set(year == 0 ? 2000 : year + 1), true, Ui.Secondary, 24);
            Ui.Btn(r, "+10", new Vector2(0.86f, 0.39f), new Vector2(0.98f, 0.46f), () => Set(year == 0 ? 2000 : year + 10), true, Ui.Secondary, 24);
            start = Ui.Btn(r, L("เริ่มเล่น", "Start"), new Vector2(0.2f, 0.2f), new Vector2(0.8f, 0.3f), () =>
            {
                Profile.Consented = true; Profile.BirthYear = year; Save();
                Analytics.Track("consent_ok", year.ToString());
                ShowIntro();
            }, true, Ui.Primary, 36);
            start.interactable = false;
        }

        // ---------- ③ Intro (placeholder text until the illustration frames exist) ----------

        static readonly string[][] IntroPages =
        {
            new[] { "คืนจันทร์สีเลือด นิกายจันทร์โลหิตบุกหมู่บ้านเชิงเขา", "On a blood-red moon, the Blood Moon cult storms the village below the mountains." },
            new[] { "ห้าสำนักแห่งยุทธภพส่งศิษย์ลงมาช่วย แต่ละสำนักมีวิชาของตัวเอง", "The five sects send disciples down to help, each with its own art." },
            new[] { "จงวางศิษย์ขวางทางมาร อย่าให้ผ่านประตูหมู่บ้าน", "Place disciples along the road. Let nothing through the village gate." },
        };

        void ShowIntro() { introPage = 0; NextIntroPage(); }

        void EndIntro(string how)
        {
            introPage = 0;
            Profile.IntroSeen = true; Save();
            Analytics.Track(how);
            StartStage(TutorialStage);
        }

        void NextIntroPage()
        {
            if (introPage >= IntroPages.Length) { EndIntro("intro_done"); return; }
            var r = Ui.NewScreen("Intro", "#120A10");
            Show(r);
            var page = IntroPages[introPage];
            Ui.Label(r, L(page[0], page[1]), 34, new Vector2(0.08f, 0.4f), new Vector2(0.92f, 0.6f));
            Ui.Label(r, (introPage + 1) + " / " + IntroPages.Length + L("   ·   แตะเพื่อไปต่อ", "   ·   tap to continue"), 20, new Vector2(0, 0.06f), new Vector2(1, 0.1f), "#5A5266");
            Ui.Btn(r, "", Vector2.zero, Vector2.one, NextIntroPage, true, "#00000000");
            Ui.Btn(r, L("ข้าม", "Skip"), new Vector2(0.72f, 0.92f), new Vector2(0.96f, 0.98f), () => EndIntro("intro_skip"), true, Ui.Secondary, 24);
            introPage++;
            introAt = Time.realtimeSinceStartup;
        }

        // ---------- ⑤ Sect pick ----------

        void ShowSectPick()
        {
            var r = Ui.NewScreen("SectPick");
            Show(r);
            Once("sect_view");
            Ui.Label(r, L("เลือกสำนักต้นสังกัด", "Choose your sect"), 44, new Vector2(0, 0.9f), new Vector2(1, 0.97f), "#E3B04B").font = Ui.Bold;
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
                bool ready = GameData.RosterSects.Contains(el); // sects whose 5-role roster is in the game yet
                string label = Ui.Name(def) + "   ·   " + Ui.Difficulty(entry.Difficulty) + (ready ? "" : L("   ·   กำลังพัฒนา", "   ·   coming soon"));
                // Every sect can be read about; only those with a roster can be joined.
                var b = Ui.Btn(r, label, new Vector2(0.05f, y0), new Vector2(0.95f, y1), () => ShowSectDetail(el, entry), true, ready ? Ui.Secondary : "#1E1418", 30);
                Ui.Box((RectTransform)b.transform, "Mark", new Vector2(0, 0), new Vector2(0.03f, 1), def.Color);
            }
            for (int i = 0; i < upcoming.Count; i++)
            {
                var u = upcoming[i];
                float y1 = top - (launch.Count + i) * h, y0 = y1 - h + 0.01f;
                Ui.Btn(r, L(u.NameTh, u.NameEn) + L("   ·   เปิดเดือนที่ ", "   ·   opens in month ") + u.OpensMonth,
                    new Vector2(0.05f, y0), new Vector2(0.95f, y1), null, false);
            }
        }

        void ShowSectDetail(string el, AllegianceDef entry)
        {
            var def = GameData.Sects[el];
            var r = Ui.NewScreen("SectDetail");
            Show(r, ShowSectPick);
            Analytics.Track("sect_detail", el);
            bool ready = GameData.RosterSects.Contains(el);
            Ui.Box(r, "Band", new Vector2(0, 0.86f), new Vector2(1, 0.87f), def.Color);
            Ui.Label(r, Ui.Name(def), 52, new Vector2(0, 0.76f), new Vector2(1, 0.85f), def.Color).font = Ui.Bold;
            Ui.Label(r, L("กฎประจำสำนัก", "Sect rule") + "   ·   " + L("ความยาก ", "Difficulty ") + Ui.Difficulty(entry.Difficulty), 22, new Vector2(0, 0.71f), new Vector2(1, 0.76f), "#9A92AE");
            var rule = Ui.Label(r, L(entry.RuleTh, entry.RuleEn ?? entry.RuleTh), 30, new Vector2(0.05f, 0.62f), new Vector2(0.95f, 0.71f));
            rule.resizeTextForBestFit = true; rule.resizeTextMinSize = 18; rule.resizeTextMaxSize = 30;
            var units = GameData.UnitList.Where(u => u.Sect == el).ToList();
            if (units.Count == 0)
                Ui.Label(r, L("ศิษย์ 5 บทบาทของสำนักนี้กำลังพัฒนา จะเปิดในอัปเดตถัดไป", "This sect's five disciples are still being made; they open in a later update."),
                    24, new Vector2(0.08f, 0.4f), new Vector2(0.92f, 0.55f), "#9A92AE");
            for (int i = 0; i < units.Count; i++)
            {
                var u = units[i];
                var rd = GameData.RoleDefs.TryGetValue(u.RoleId, out var x) ? x : null;
                // Two lines per disciple: role and name, then what it does.
                float y1 = 0.6f - i * 0.085f;
                var head = Ui.Label(r, (rd != null ? Ui.Name(rd) + "  ·  " : "") + Ui.Name(u), 22, new Vector2(0.06f, y1 - 0.035f), new Vector2(0.94f, y1), Ui.RoleColor.TryGetValue(u.RoleId, out var rc) ? rc : "#ECE3CF", TextAnchor.MiddleLeft);
                head.font = Ui.Bold;
                var desc = Ui.Label(r, L(u.DescTh, u.DescEn), 18, new Vector2(0.06f, y1 - 0.08f), new Vector2(0.94f, y1 - 0.035f), "#C9BFA8", TextAnchor.UpperLeft);
                desc.resizeTextForBestFit = true; desc.resizeTextMinSize = 13; desc.resizeTextMaxSize = 18;
            }
            Ui.Btn(r, L("กลับ", "Back"), new Vector2(0.05f, 0.06f), new Vector2(0.35f, 0.15f), ShowSectPick);
            Ui.Btn(r, ready ? L("เข้าสำนักนี้", "Join this sect") : L("กำลังพัฒนา", "Coming soon"), new Vector2(0.4f, 0.06f), new Vector2(0.95f, 0.15f), () => ConfirmSect(el), ready, Ui.Primary, 32);
        }

        // Told plainly before the pick: changing later needs the sect-change token (SPEC-front-flow §5).
        void ConfirmSect(string el)
        {
            var dlg = Ui.Box(screen, "Confirm", Vector2.zero, Vector2.one, "#000000CC");
            var box = Ui.Panel(dlg, "Box", new Vector2(0.06f, 0.34f), new Vector2(0.94f, 0.66f));
            Ui.Label(box, L("ยืนยันเข้าสำนักนี้?\nเปลี่ยนสำนักภายหลังต้องใช้ \"ป้ายย้ายสังกัด\"\nความก้าวหน้าของแต่ละสำนักไม่หาย",
                "Join this sect?\nChanging later needs a Sect Transfer token.\nProgress in each sect is kept."), 28, new Vector2(0, 0.35f), new Vector2(1, 0.95f));
            back = () => { Destroy(dlg.gameObject); back = ShowSectPick; };
            Ui.Btn(box, L("ยกเลิก", "Cancel"), new Vector2(0.05f, 0.06f), new Vector2(0.45f, 0.3f), () => back());
            Ui.Btn(box, L("ยืนยัน", "Confirm"), new Vector2(0.55f, 0.06f), new Vector2(0.95f, 0.3f), () =>
            {
                Profile.Sect = el; Save();
                Analytics.Track("sect_pick", el);
                ShowName();
            }, true, Ui.Primary);
        }

        // ---------- ⑥ Name ----------

        static readonly string[] NameA = { "หลิว", "เซียว", "หาน", "ซือ", "เยว่", "ฉิน", "ไป๋", "หลง", "เมิ่ง", "ซ่ง" };
        static readonly string[] NameB = { "อวิ๋น", "เฟิง", "เสวี่ย", "หยาง", "อี้", "หลาน", "จิ่ว", "ซิน", "เหอ", "ชิง" };
        static readonly string[] NameEnA = { "Liu", "Xiao", "Han", "Si", "Yue", "Qin", "Bai", "Long", "Meng", "Song" };
        static readonly string[] NameEnB = { "Yun", "Feng", "Xue", "Yang", "Yi", "Lan", "Jiu", "Xin", "He", "Qing" };

        string RandomName()
        {
            int a = Random.Range(0, NameA.Length), b = Random.Range(0, NameB.Length);
            return lastRandomName = Ui.Thai ? NameA[a] + NameB[b] : NameEnA[a] + " " + NameEnB[b];
        }

        // Length in what a reader counts as letters: a Thai vowel or tone mark belongs to its consonant.
        static int Letters(string s) => new StringInfo(s).LengthInTextElements;

        // Null if the name is fine, else why not.
        static string NameProblem(string n)
        {
            int len = Letters(n);
            if (len < 2 || len > 12) return L("ชื่อต้องยาว 2–12 ตัวอักษร", "Names are 2-12 letters");
            foreach (char c in n)
                if (c != ' ' && !Ui.Font.HasCharacter(c)) return L("มีตัวอักษรที่แสดงไม่ได้ (เช่นอีโมจิ)", "Some characters can't be shown (emoji?)");
            if (!n.Any(char.IsLetter)) return L("ชื่อต้องมีตัวอักษร", "Names need letters");
            return null;
        }

        void ShowName()
        {
            var r = Ui.NewScreen("Name");
            Show(r);
            Once("name_view");
            Ui.Label(r, L("ฉายาของท่าน", "Your name"), 44, new Vector2(0, 0.7f), new Vector2(1, 0.78f), "#E3B04B").font = Ui.Bold;
            var field = Ui.Field(r, RandomName(), new Vector2(0.1f, 0.56f), new Vector2(0.9f, 0.66f), 24);
            var error = Ui.Label(r, "", 22, new Vector2(0, 0.5f), new Vector2(1, 0.55f), "#D2412F");
            field.onValueChanged.AddListener(_ => error.text = "");
            Ui.Btn(r, L("สุ่มชื่อ", "Random"), new Vector2(0.1f, 0.4f), new Vector2(0.45f, 0.48f), () => field.text = RandomName());
            Ui.Btn(r, L("ยืนยัน", "Confirm"), new Vector2(0.55f, 0.4f), new Vector2(0.9f, 0.48f), () =>
            {
                string n = Regex.Replace((field.text ?? "").Trim(), @"\s+", " ");
                string problem = NameProblem(n);
                if (problem != null) { error.text = problem; Analytics.Track("name_rejected", problem); return; }
                // The server re-checks names against the profanity list when accounts move online (M1).
                Profile.Name = n; Save();
                Analytics.Track("name_set", n == lastRandomName ? "random" : "typed");
                StartStage(NextStoryStage());
            }, true, Ui.Primary);
        }

        // ---------- ⑧ Lobby (ลานสำนัก) ----------

        string NextStoryStage() => DefendView.Playlist.FirstOrDefault(id => !Profile.Cleared.Contains(id)) ?? DefendView.Playlist.Last();

        int ChapterStars() => DefendView.Playlist.Sum(Profile.BestStars);
        int ChapterStarsMax() => DefendView.Playlist.Sum(id => GameData.Stages[id].Stars.Count);

        // SPEC-core §6 tabs: what they are and where they open. Base and Battle are open from the start.
        static readonly (string id, string th, string en, string opensAt)[] Tabs =
        {
            ("disciples", "ศิษย์", "Disciples", "1-2"),
            ("hall", "ศาลา", "Hall", "1-4"),
            ("battle", "ศึก", "Battle", null),
            ("home", "ลานสำนัก", "Courtyard", null),
            ("shop", "ร้าน", "Shop", "1-4"),
        };

        bool TabOpen(string opensAt) => opensAt == null || Profile.Cleared.Contains(opensAt);
        bool TabSwitchedOff(string id) => (id == "shop" && !config.ShopEnabled) || (id == "hall" && !config.GachaEnabled);

        // The one line of "what next" that is always on the lobby (SPEC-core §1): the nearest goal.
        string NextGoal()
        {
            string next = DefendView.Playlist.FirstOrDefault(id => !Profile.Cleared.Contains(id));
            if (next != null)
            {
                var unlocks = new List<string>();
                string after = DefendView.Playlist.SkipWhile(id => id != next).Skip(1).FirstOrDefault(); // roles join in the stage after the one cleared
                var roles = GameData.RoleUnlocks.FirstOrDefault(kv => kv.Key == after).Value;
                if (roles != null) unlocks.AddRange(roles.Select(r => GameData.RoleDefs.TryGetValue(r, out var rd) ? L("บทบาท", "role ") + Ui.Name(rd) : r));
                unlocks.AddRange(Tabs.Where(t => t.opensAt == next).Select(t => L("หน้า", "the ") + L(t.th, t.en)));
                return L("เป้าถัดไป: ผ่าน ", "Next: clear ") + next + (unlocks.Count > 0 ? L(" เพื่อปลด", " to unlock ") + string.Join(", ", unlocks) : "");
            }
            int missing = ChapterStarsMax() - ChapterStars();
            return missing > 0 ? L("เป้าถัดไป: อีก ", "Next: ") + missing + L(" ดาวครบบทที่ 1", " more stars complete chapter 1")
                : L("จบบทที่ 1 ครบทุกดาวแล้ว! บทที่ 2 เปิดในอัปเดตถัดไป", "Chapter 1 complete with every star! Chapter 2 comes in a later update.");
        }

        void ShowLobby() { lobbyTab = "home"; DrawLobby(); }

        void DrawLobby()
        {
            var r = Ui.NewScreen("Lobby", "#100C16");
            Show(r, lobbyTab != "home" ? () => { lobbyTab = "home"; DrawLobby(); } : (System.Action)null);
            Once("lobby_open");
            var def = GameData.Sects[Profile.Sect];
            var top = Ui.Panel(r, "Top", new Vector2(0, 0.93f), new Vector2(1, 1));
            Ui.Box(top, "Seal", new Vector2(0.02f, 0.15f), new Vector2(0.09f, 0.85f), def.Color);
            Ui.Label(top, Profile.Name + "  ·  " + Ui.Name(def), 26, new Vector2(0.1f, 0), new Vector2(0.7f, 1), "#ECE3CF", TextAnchor.MiddleLeft).font = Ui.Bold;
            Ui.Star(top, new Vector2(0.75f, 0.5f), 20, true);
            Ui.Label(top, ChapterStars() + " / " + ChapterStarsMax(), 24, new Vector2(0.77f, 0), new Vector2(1, 1), "#FFD34A", TextAnchor.MiddleLeft);
            var goal = Ui.Label(r, NextGoal(), 22, new Vector2(0.02f, 0.885f), new Vector2(0.98f, 0.925f), "#E3B04B");
            goal.resizeTextForBestFit = true; goal.resizeTextMinSize = 14; goal.resizeTextMaxSize = 22;

            switch (lobbyTab)
            {
                case "battle": DrawChapterMap(r); break;
                case "disciples": DrawDisciples(r); break;
                default: DrawHome(r); break;
            }

            // Bottom tabs; Battle in the middle and the largest.
            float[] x = { 0, 0.19f, 0.38f, 0.62f, 0.81f, 1 };
            for (int i = 0; i < Tabs.Length; i++)
            {
                var t = Tabs[i];
                bool open = TabOpen(t.opensAt), off = TabSwitchedOff(t.id), current = lobbyTab == t.id;
                string label = L(t.th, t.en) + (!open ? L("\nผ่าน ", "\nclear ") + t.opensAt : off ? L("\nปิดปรับปรุง", "\nmaintenance") : "");
                var tab = t;
                var b = Ui.Btn(r, label, new Vector2(x[i] + 0.004f, 0.005f), new Vector2(x[i + 1] - 0.004f, t.id == "battle" ? 0.105f : 0.09f), () =>
                {
                    if (!TabOpen(tab.opensAt)) { Toast(L("ผ่านด่าน ", "Clear stage ") + tab.opensAt + L(" เพื่อปลด", " to unlock")); return; }
                    if (TabSwitchedOff(tab.id)) { Toast(L("ปิดปรับปรุงชั่วคราว", "Closed for maintenance")); return; }
                    if (tab.id == "hall" || tab.id == "shop") { ComingSoon(tab.id); return; }
                    lobbyTab = tab.id; DrawLobby();
                }, true, current ? Ui.Primary : open && !off ? Ui.Secondary : "#1E1418", t.id == "battle" ? 26 : 22);
                if (!open || off) b.GetComponentInChildren<Text>().color = Art.Hex("#6E6680");
            }
        }

        void DrawHome(RectTransform r)
        {
            // Side shortcuts unlock with progress (release-systems §5); the systems behind them come in step 5.
            SideButton(r, 0, L("ภารกิจรายวัน", "Daily missions"), "1-1");
            SideButton(r, 1, L("กล่องจดหมาย", "Mail"), "1-1");
            SideButton(r, 2, L("อีเวนต์", "Events"), "1-4");

            string next = NextStoryStage();
            var main = Ui.Btn(r, L("เข้าสู่ยุทธภพ\n", "Enter the Jianghu\n") + Ui.StageName(next), new Vector2(0.1f, 0.4f), new Vector2(0.9f, 0.56f),
                () => StartStage(next), true, Ui.Primary, 36);
            main.GetComponentInChildren<Text>().font = Ui.Bold;
            int stars = Profile.BestStars(next), max = GameData.Stages[next].Stars.Count;
            for (int i = 0; i < max; i++) Ui.Star(r, new Vector2(0.5f + (i - (max - 1) / 2f) * 0.06f, 0.37f), 22, i < stars);

            Ui.Btn(r, L("ภาพด่าน: ", "Battle view: ") + (Profile.Classic2D ? "2D" : "3D") + L("  (แตะเพื่อเปลี่ยน)", "  (tap to switch)"),
                new Vector2(0.2f, 0.26f), new Vector2(0.8f, 0.32f), () =>
                {
                    Profile.Classic2D = !Profile.Classic2D; Save();
                    Analytics.Track("battle_view", Profile.Classic2D ? "2d" : "3d");
                    DrawLobby();
                }, true, Ui.Secondary, 22);

            if (!Debug.isDebugBuild) return;
            // Test tools: shown only in development builds.
            if (Profile.FirstPlaceMs >= 0)
                Ui.Label(r, L("[ทดสอบ] เปิดเกมถึงวางศิษย์ตัวแรก: ", "[test] App start to first disciple placed: ") + (Profile.FirstPlaceMs / 1000f).ToString("0.0") + L(" วินาที", " s"),
                    18, new Vector2(0, 0.2f), new Vector2(1, 0.24f), "#6E6680");
            Ui.Btn(r, L("[ทดสอบ] เริ่มใหม่ (ลบเซฟ)", "[test] Start over (delete save)"), new Vector2(0.25f, 0.13f), new Vector2(0.75f, 0.18f), ConfirmReset, true, "#1E1418", 18);
        }

        void ConfirmReset()
        {
            var dlg = Ui.Box(screen, "Confirm", Vector2.zero, Vector2.one, "#000000CC");
            var box = Ui.Panel(dlg, "Box", new Vector2(0.08f, 0.38f), new Vector2(0.92f, 0.62f));
            Ui.Label(box, L("ลบเซฟทั้งหมดแล้วเริ่มใหม่?\nย้อนกลับไม่ได้", "Delete the whole save and start over?\nThis cannot be undone."), 28, new Vector2(0, 0.4f), new Vector2(1, 0.95f));
            Ui.Btn(box, L("ยกเลิก", "Cancel"), new Vector2(0.05f, 0.08f), new Vector2(0.45f, 0.34f), () => Destroy(dlg.gameObject));
            Ui.Btn(box, L("ลบ", "Delete"), new Vector2(0.55f, 0.08f), new Vector2(0.95f, 0.34f), () =>
            {
                Store.Reset(); Profile = new Profile(); tracked.Clear(); Analytics.Track("profile_reset"); ShowBoot();
            }, true, Ui.Primary);
        }

        // Chapter 1 as a path of stages: stars won, the next stage open, later ones locked; cleared ones can be replayed.
        void DrawChapterMap(RectTransform r)
        {
            Ui.Label(r, L("บทที่ 1 · หมู่บ้านเชิงเขา", "Chapter 1 · The Foothill Village"), 30, new Vector2(0, 0.82f), new Vector2(1, 0.88f), "#ECE3CF").font = Ui.Bold;
            string next = DefendView.Playlist.FirstOrDefault(id => !Profile.Cleared.Contains(id));
            for (int i = 0; i < DefendView.Playlist.Length; i++)
            {
                string id = DefendView.Playlist[i];
                bool cleared = Profile.Cleared.Contains(id), open = cleared || id == next;
                float y1 = 0.8f - i * 0.135f, y0 = y1 - 0.12f;
                var b = Ui.Btn(r, Ui.StageName(id) + (!open ? L("\nผ่านด่านก่อนหน้าเพื่อปลด", "\nclear the stage before") : ""), new Vector2(0.06f, y0), new Vector2(0.94f, y1),
                    () => StartStage(id), open, id == next ? Ui.Primary : Ui.Secondary, 26);
                var label = b.GetComponentInChildren<Text>();
                label.alignment = TextAnchor.MiddleLeft;
                label.rectTransform.offsetMax = new Vector2(-150, 0);
                int max = GameData.Stages[id].Stars.Count, got = Profile.BestStars(id);
                for (int k = 0; k < max; k++) Ui.Star((RectTransform)b.transform, new Vector2(0.78f + k * 0.07f, 0.5f), 22, k < got);
            }
        }

        // What each disciple of the player's sect does, when it joins, and the technique each tier teaches.
        void DrawDisciples(RectTransform r)
        {
            Ui.Label(r, L("ศิษย์ของ", "Disciples of ") + Ui.Name(GameData.Sects[Profile.Sect]), 30, new Vector2(0, 0.82f), new Vector2(1, 0.88f), "#ECE3CF").font = Ui.Bold;
            var units = GameData.UnitList.Where(u => u.Sect == Profile.Sect).ToList();
            for (int i = 0; i < units.Count; i++)
            {
                var u = units[i];
                var rd = GameData.RoleDefs.TryGetValue(u.RoleId, out var x) ? x : null;
                string unlockAt = GameData.RoleUnlocks.FirstOrDefault(kv => kv.Value.Contains(u.RoleId)).Key;
                bool have = unlockAt == null || Profile.Cleared.Contains(unlockAt) || unlockAt == NextStoryStage(); // a role joins in the stage its key names
                float y1 = 0.8f - i * 0.135f, y0 = y1 - 0.125f;
                var card = Ui.Panel(r, "Unit", new Vector2(0.03f, y0), new Vector2(0.97f, y1), have ? Ui.PanelColor : "#120A0C");
                var pic = new GameObject("Portrait", typeof(RectTransform), typeof(Image));
                var prt = (RectTransform)pic.transform;
                prt.SetParent(card, false);
                prt.anchorMin = new Vector2(0.01f, 0.05f); prt.anchorMax = new Vector2(0.15f, 0.95f); prt.offsetMin = prt.offsetMax = Vector2.zero;
                var img = pic.GetComponent<Image>(); img.sprite = Art.Unit(u.Sect, u.Element); img.preserveAspect = true; img.raycastTarget = false;
                if (!have) img.color = new Color(0.4f, 0.4f, 0.45f, 1);
                var head = Ui.Label(card, Ui.Name(u) + (rd != null ? "  ·  " + Ui.Name(rd) : "") + (have ? "" : L("   (ปลดที่ ", "   (joins at ") + unlockAt + ")"), 22,
                    new Vector2(0.16f, 0.66f), new Vector2(1, 0.98f), have && Ui.RoleColor.TryGetValue(u.RoleId, out var rc) ? rc : "#8A8296", TextAnchor.MiddleLeft);
                head.font = Ui.Bold; head.resizeTextForBestFit = true; head.resizeTextMinSize = 14; head.resizeTextMaxSize = 22;
                var desc = Ui.Label(card, L(u.DescTh, u.DescEn), 17, new Vector2(0.16f, 0.36f), new Vector2(1, 0.68f), "#C9BFA8", TextAnchor.UpperLeft);
                desc.resizeTextForBestFit = true; desc.resizeTextMinSize = 12; desc.resizeTextMaxSize = 17;
                var tiers = string.Join("  ›  ", Ui.Skills(u.Element).Select(k => Ui.Name(k)));
                var tl = Ui.Label(card, L("ท่าตามขั้น: ", "Techniques: ") + tiers, 16, new Vector2(0.16f, 0.04f), new Vector2(1, 0.36f), "#FFD34A", TextAnchor.MiddleLeft);
                tl.resizeTextForBestFit = true; tl.resizeTextMinSize = 11; tl.resizeTextMaxSize = 16;
            }
        }

        void SideButton(RectTransform r, int i, string text, string opensAt)
        {
            bool open = Profile.Cleared.Contains(opensAt);
            float y1 = 0.86f - i * 0.075f;
            Ui.Btn(r, open ? text : text + L("  ·  ผ่าน ", "  ·  clear ") + opensAt, new Vector2(0.02f, y1 - 0.065f), new Vector2(0.42f, y1),
                () => Toast(open ? L("เร็วๆ นี้", "Coming soon") : L("ผ่านด่าน ", "Clear stage ") + opensAt + L(" เพื่อปลด", " to unlock")), true, open ? Ui.Secondary : "#1E1418", 20);
        }

        // Tabs whose systems come in step 5 say what they will hold instead of doing nothing.
        void ComingSoon(string tab)
        {
            var dlg = Ui.Box(screen, "Soon", Vector2.zero, Vector2.one, "#000000CC");
            var box = Ui.Panel(dlg, "Box", new Vector2(0.06f, 0.32f), new Vector2(0.94f, 0.68f));
            string what = tab == "hall"
                ? L("ศาลา: ตู้วีรชนประจำสัปดาห์ ตู้ถาวร ตู้อุปกรณ์\nแสดงอัตรา การันตี และประวัติการสุ่มทุกครั้ง", "Hall: the weekly hero banner, the standard banner, the gear banner,\nwith rates, pity and your pull history.")
                : L("ร้าน: หยก แพ็ก บัตรรายเดือน ตั๋วยุทธภพ\nของใน PvP เป็นของตกแต่งเท่านั้น", "Shop: jade, packs, the monthly card, the Jianghu pass.\nNothing from PvP buys power.");
            Ui.Label(box, L("เร็วๆ นี้", "Coming soon"), 34, new Vector2(0, 0.74f), new Vector2(1, 0.95f), "#E3B04B").font = Ui.Bold;
            Ui.Label(box, what, 24, new Vector2(0.04f, 0.3f), new Vector2(0.96f, 0.74f));
            back = () => { Destroy(dlg.gameObject); back = null; };
            Ui.Btn(box, L("ปิด", "Close"), new Vector2(0.3f, 0.06f), new Vector2(0.7f, 0.24f), () => back());
        }

        // ---------- ⑦ Loading → battle ----------

        public void StartStage(string stageId)
        {
            var r = Ui.NewScreen("Loading");
            Show(r);
            string sect = Profile.Sect != null && GameData.Sects.ContainsKey(Profile.Sect) ? Ui.Name(GameData.Sects[Profile.Sect]) : "";
            Ui.Label(r, sect, 36, new Vector2(0, 0.62f), new Vector2(1, 0.7f), "#E3B04B");
            Ui.Label(r, stageId == TutorialStage ? L("ลานฝึก", "Training ground") : Ui.StageName(stageId), 40, new Vector2(0.04f, 0.5f), new Vector2(0.96f, 0.6f)).font = Ui.Bold;
            var bar = Ui.Box(r, "Bar", new Vector2(0.2f, 0.42f), new Vector2(0.8f, 0.435f), "#2A2033");
            loadingFill = Ui.Box(bar, "Fill", Vector2.zero, new Vector2(0, 1), "#E3B04B");
            var tips = Tips();
            var tip = tips[Mathf.Abs(stageId.GetHashCode()) % tips.Count];
            Ui.Label(r, tip, 24, new Vector2(0.06f, 0.12f), new Vector2(0.94f, 0.24f), "#9A92AE");
            loadingStartedAt = Time.realtimeSinceStartup;
            Analytics.Track("stage_start", stageId);
            Next(() =>
            {
                battle = new GameObject("Five Sects").AddComponent<DefendView>();
                battle.StageId = stageId;
                battle.Flow = this;
            });
        }

        // Tips that are true for how the player plays now (a roster sect, no merging yet).
        List<string> Tips()
        {
            var t = new List<string>
            {
                L("แถบล่างบอกว่าระลอกถัดไปต้องการบทบาทไหน สีแดงคือยังไม่มีในผัง", "The bottom bar names the roles the next wave needs; red means you have none yet."),
                L("ดอกเบี้ยได้เมื่อเคลียร์สนามหมด เรียกระลอกก่อนเวลาได้โบนัส แต่เสียดอกเบี้ยรอบนั้น", "Interest pays when the field is clear; calling early pays a bonus but skips that interest."),
                L("บางตัวบินข้ามหลังคา ศิษย์ที่ตีได้แค่พื้นจะตีไม่ถึง", "Some enemies fly; disciples that hit only the ground cannot reach them."),
                L("อัปเกรดแล้วได้ท่าใหม่ แตะศิษย์ที่วางแล้วเพื่อดูท่าถัดไป", "Upgrades teach new techniques; tap a placed disciple to see the next one."),
                L("หมอผีฟื้นเลือดเพื่อนไม่ได้ ถ้าเพื่อนติดไฟหรือติดพิษอยู่", "Healers cannot mend allies that are burning or poisoned."),
            };
            if (Profile.Sect != null && GameData.Allegiance.FirstOrDefault(a => a.Element == Profile.Sect) is AllegianceDef rule)
                t.Add(L("กฎสำนัก: ", "Sect rule: ") + L(rule.RuleTh, rule.RuleEn ?? rule.RuleTh));
            return t;
        }

        // Called by DefendView on its first frame; the loading screen stays at least MinLoadingSec so it reads as a beat.
        public void BattleReady()
        {
            Analytics.Track("loading_ms", ((int)((Time.realtimeSinceStartup - loadingStartedAt) * 1000)).ToString());
            float wait = MinLoadingSec - (Time.realtimeSinceStartup - loadingStartedAt);
            var s = screen;
            if (wait <= 0) Drop(s); else StartCoroutine(DropLater(s, wait));
        }

        System.Collections.IEnumerator DropLater(RectTransform s, float wait)
        {
            yield return new WaitForSecondsRealtime(wait);
            Drop(s);
        }

        void Drop(RectTransform s)
        {
            if (s == null) return;
            Destroy(s.root.gameObject);
            if (screen == s) { screen = null; loadingFill = null; back = null; }
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
            int n = stars.Count(x => x);
            Analytics.Track("stage_end", stageId + (won ? " won " : " lost ") + n);
            if (stageId == TutorialStage) Profile.TutorialDone = true;
            else if (won)
            {
                if (!Profile.Cleared.Contains(stageId)) Profile.Cleared.Add(stageId);
                Profile.RecordStars(stageId, n);
            }
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
