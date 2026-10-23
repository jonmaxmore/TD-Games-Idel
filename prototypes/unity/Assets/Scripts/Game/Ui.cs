// uGUI building blocks for the front-flow screens (boot, consent, sect pick, lobby, loading), made from code
// like the battle HUD. Layout is in anchors on a 720x1280 reference canvas.
using FiveSects.Sim;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem.UI;
#endif

namespace FiveSects.Game
{
    public static class Ui
    {
        static Font font;
        public static bool Thai { get; private set; }

        public static Font Font
        {
            get
            {
                if (font != null) return font;
                // Bundled Sarabun first, then a Thai-capable system font (Windows ships Leelawadee UI and Tahoma),
                // and only then Unity's built-in font, which has no Thai and makes the UI fall back to English.
                font = Resources.Load<Font>("Fonts/Sarabun-Regular");
                if (font == null)
                {
                    var os = Font.CreateDynamicFontFromOSFont(new[] { "Leelawadee UI", "Leelawadee", "Tahoma", "Noto Sans Thai", "Sarabun", "Thonburi" }, 32);
                    if (os != null) { os.RequestCharactersInTexture("กขค"); if (os.HasCharacter('ก')) font = os; }
                }
                Thai = font != null;
                if (font == null) font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                return font;
            }
        }

        // Thai when a Thai font was found (bundled or system); English otherwise. Never show raw ids to players.
        public static string L(string th, string en) { var _ = Font; return Thai ? th : en; }

        // Player-facing names. Ids never reach the screen.
        public static string Name(SectDef d) => d == null ? "" : L(d.NameTh, d.NameEn ?? d.NameTh);
        public static string Name(EnemyDef d) => d == null ? "" : L(d.NameTh, d.NameEn ?? d.NameTh);
        public static string Name(RoleDef d) => d == null ? "" : L(d.NameTh, d.NameEn ?? d.NameTh);
        public static string Unit(string key) => Name(GameData.DefOf(key));
        public static string Enemy(string id) => GameData.Enemies.TryGetValue(id, out var e) ? Name(e) : id.StartsWith("boss") ? L("บอส", "Boss") : id;

        public static RectTransform NewScreen(string name, string bg = "#0B0910")
        {
            if (EventSystem.current == null)
            {
                var es = new GameObject("EventSystem").AddComponent<EventSystem>();
#if ENABLE_INPUT_SYSTEM
                es.gameObject.AddComponent<InputSystemUIInputModule>();
#else
                es.gameObject.AddComponent<StandaloneInputModule>();
#endif
            }
            var go = new GameObject(name, typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            go.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(720, 1280);
            scaler.matchWidthOrHeight = 1f;
            var root = (RectTransform)go.transform;
            Box(root, "Bg", Vector2.zero, Vector2.one, bg);
            return root;
        }

        public static RectTransform Box(RectTransform parent, string name, Vector2 aMin, Vector2 aMax, string color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            var rt = (RectTransform)go.transform;
            rt.SetParent(parent, false);
            rt.anchorMin = aMin; rt.anchorMax = aMax; rt.offsetMin = Vector2.zero; rt.offsetMax = Vector2.zero;
            go.GetComponent<Image>().color = Art.Hex(color);
            return rt;
        }

        public static Text Label(RectTransform parent, string text, int size, Vector2 aMin, Vector2 aMax, string color = "#ECE3CF", TextAnchor align = TextAnchor.MiddleCenter)
        {
            var go = new GameObject("Text", typeof(RectTransform), typeof(Text));
            var rt = (RectTransform)go.transform;
            rt.SetParent(parent, false);
            rt.anchorMin = aMin; rt.anchorMax = aMax; rt.offsetMin = new Vector2(16, 0); rt.offsetMax = new Vector2(-16, 0);
            var t = go.GetComponent<Text>();
            t.font = Font; t.fontSize = size; t.text = text; t.color = Art.Hex(color); t.alignment = align;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.raycastTarget = false;
            return t;
        }

        public static Button Btn(RectTransform parent, string text, Vector2 aMin, Vector2 aMax, UnityEngine.Events.UnityAction onClick,
            bool enabled = true, string color = "#3A2A14", int size = 28)
        {
            var rt = Box(parent, "Button", aMin, aMax, enabled ? color : "#221C2A");
            var b = rt.gameObject.AddComponent<Button>();
            b.interactable = enabled;
            if (onClick != null) b.onClick.AddListener(onClick);
            Label(rt, text, size, Vector2.zero, Vector2.one, enabled ? "#ECE3CF" : "#9A92AE");
            return b;
        }

        public static InputField Field(RectTransform parent, string value, Vector2 aMin, Vector2 aMax, int maxChars)
        {
            var rt = Box(parent, "Input", aMin, aMax, "#17121F");
            var text = Label(rt, value, 32, Vector2.zero, Vector2.one);
            text.raycastTarget = true;
            var f = rt.gameObject.AddComponent<InputField>();
            f.textComponent = text;
            f.characterLimit = maxChars;
            f.text = value;
            return f;
        }
    }
}
