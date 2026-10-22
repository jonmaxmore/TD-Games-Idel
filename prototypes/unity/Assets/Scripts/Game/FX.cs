// View-only juice: element particles, glowing projectiles, damage numbers, screen shake, light pools, colour grading,
// vignette and ambient particles. Uses only Sprites/Default (always in builds), so no render-pipeline setup is needed.
// Nothing here touches the sim; it may use UnityEngine.Random freely.
using System.Collections.Generic;
using FiveSects.Sim;
using UnityEngine;

namespace FiveSects.Game
{
    public class Fx
    {
        class P
        {
            public SpriteRenderer R; public Vector2 Pos, Vel; public float Life, MaxLife, Gravity, Scale0, Scale1; public Color C; public bool Glow;
        }

        class Num { public TextMesh T; public Vector2 Pos; public float Life; }

        const int MaxParticles = 600;
        readonly Transform root;
        readonly List<P> live = new List<P>();
        readonly Stack<SpriteRenderer> pool = new Stack<SpriteRenderer>();
        readonly List<Num> nums = new List<Num>();
        readonly List<(SpriteRenderer r, Color c, float baseScale, float phase)> lights = new List<(SpriteRenderer, Color, float, float)>();
        readonly Font font;
        float shake;
        string ambient;
        float ambientAcc;

        public Vector3 ShakeOffset { get; private set; }

        static Vector3 W(Vector2 g, float z = 0) => new Vector3(g.x, -g.y, z);

        public Fx(Transform root, Font font) { this.root = root; this.font = font; }

        public void Shake(float amount) => shake = Mathf.Max(shake, amount);

        SpriteRenderer Get(bool glow)
        {
            var r = pool.Count > 0 ? pool.Pop() : new GameObject("fx").AddComponent<SpriteRenderer>();
            r.transform.SetParent(root);
            r.gameObject.SetActive(true);
            r.sprite = glow ? Art.Glow() : Art.Pixel();
            r.sortingOrder = glow ? 34 : 35;
            return r;
        }

        void Emit(Vector2 at, Vector2 vel, Color c, float life, float gravity = 0, float s0 = 1, float s1 = 1, bool glow = false)
        {
            if (live.Count >= MaxParticles) return;
            var r = Get(glow);
            live.Add(new P { R = r, Pos = at, Vel = vel, Life = life, MaxLife = life, Gravity = gravity, Scale0 = s0, Scale1 = s1, C = c, Glow = glow });
        }

        static Vector2 Dir(float deg) => new Vector2(Mathf.Cos(deg * Mathf.Deg2Rad), Mathf.Sin(deg * Mathf.Deg2Rad));
        static Color C(string hex, float a = 1) { var c = Art.Hex(hex); c.a = a; return c; }

        // ---------- one-shot effects ----------

        // Impact of one hit, flavoured by element (effects.json > sects): spark cross, leaf burst, splash ring, embers, rock chunks, taiji pop.
        public void Impact(string el, Vector2 at, bool crit)
        {
            float k = crit ? 1.8f : 1f;
            switch (el)
            {
                case "metal":
                    for (int i = 0; i < (crit ? 10 : 5); i++) Emit(at, Dir(Random.Range(0, 360)) * Random.Range(40, 90) * k, C("#EEF3F8"), 0.18f, 0, 1.5f, 0.5f);
                    Emit(at, Vector2.zero, C("#FFFFFF", 0.9f), 0.12f, 0, 0.5f * k, 1.2f * k, true);
                    break;
                case "wood":
                    for (int i = 0; i < 6; i++) Emit(at, Dir(Random.Range(200, 340)) * Random.Range(15, 35), C(i % 2 == 0 ? "#5BC46A" : "#9FDCA7"), 0.5f, -40, 1.5f, 1f);
                    Emit(at, Vector2.zero, C("#5BC46A", 0.6f), 0.25f, 0, 0.4f, 0.9f * k, true);
                    break;
                case "water":
                    for (int i = 0; i < 12; i++) Emit(at, Dir(i * 30) * 45 * k, C("#ABDBFF"), 0.22f, 0, 1.5f, 0.5f);
                    for (int i = 0; i < 3; i++) Emit(at, Dir(Random.Range(180, 360)) * Random.Range(20, 40), C("#FFFFFF"), 0.35f, -120, 2, 1);
                    Emit(at, Vector2.zero, C("#4FB3FF", 0.6f), 0.25f, 0, 0.4f, 1.1f * k, true);
                    break;
                case "fire":
                    for (int i = 0; i < (crit ? 14 : 8); i++) Emit(at + Random.insideUnitCircle * 3, new Vector2(Random.Range(-15, 15), Random.Range(-60, -25)), C(i % 3 == 0 ? "#FFE08A" : "#FF5A1F"), Random.Range(0.3f, 0.6f), 40, 2, 0.5f);
                    Emit(at, Vector2.zero, C("#FF9E7B", 0.7f), 0.3f, 0, 0.6f, 1.4f * k, true);
                    break;
                case "earth":
                    for (int i = 0; i < 6; i++) Emit(at, Dir(Random.Range(200, 340)) * Random.Range(40, 80), C(i % 2 == 0 ? "#A97D33" : "#5F471C"), 0.45f, -260, 2, 2);
                    for (int i = 0; i < 4; i++) Emit(at + Random.insideUnitCircle * 4, Random.insideUnitCircle * 10, C("#C8C4CC", 0.6f), 0.5f, 0, 2, 4);
                    Shake(crit ? 2 : 0.8f);
                    break;
                default: // yinyang
                    for (int i = 0; i < 8; i++) Emit(at + Dir(i * 45) * 4, Dir(i * 45 + 90) * 40, C(i % 2 == 0 ? "#F2F2F2" : "#3A3442"), 0.3f, 0, 1.5f, 0.5f);
                    break;
            }
            if (crit) Shake(1.2f);
        }

        // Projectile trail puff left behind each frame.
        public void Trail(string el, Vector2 at, bool crit)
        {
            var c = C(GameData.Sects[el].Color, 0.8f);
            Emit(at, Vector2.zero, c, 0.15f, 0, crit ? 2.5f : 1.5f, 0.3f);
        }

        public void Death(Vector2 at, bool boss)
        {
            int n = boss ? 40 : 10;
            for (int i = 0; i < n; i++) Emit(at, Random.insideUnitCircle * (boss ? 90 : 35), C(i % 3 == 0 ? "#D2412F" : "#6E6A78"), Random.Range(0.3f, 0.6f), 0, 2, 0);
            Emit(at, Vector2.zero, C("#FFE9A8", 0.7f), 0.2f, 0, 0.5f, boss ? 4 : 1.3f, true);
            if (boss) Shake(4);
        }

        public void Coin(Vector2 at, int amount)
        {
            Emit(at, new Vector2(0, -50), C("#E3B04B"), 0.5f, 120, 2, 2);
            if (amount >= 10) Number(at + new Vector2(0, -8), "+" + amount, "#E3B04B", 0.7f);
        }

        // Combo merge / secret art: a ring of golden light and a flash.
        public void Burst(Vector2 at, string hex, float size)
        {
            for (int i = 0; i < 24; i++) Emit(at, Dir(i * 15) * 70 * size, C(hex), 0.45f, 0, 2, 0.5f);
            Emit(at, Vector2.zero, C(hex, 0.8f), 0.35f, 0, 1, 4 * size, true);
            Shake(2 * size);
        }

        public void Number(Vector2 at, string text, string hex, float life = 0.6f)
        {
            if (font == null) return;
            var go = new GameObject("num");
            go.transform.SetParent(root);
            var t = go.AddComponent<TextMesh>();
            t.font = font; t.text = text; t.fontSize = 48; t.characterSize = 0.18f; t.anchor = TextAnchor.MiddleCenter;
            t.color = Art.Hex(hex);
            go.GetComponent<MeshRenderer>().material = font.material;
            go.GetComponent<MeshRenderer>().sortingOrder = 60;
            nums.Add(new Num { T = t, Pos = at, Life = life });
        }

        // ---------- persistent lighting ----------

        // Soft pool of light that breathes (lanterns, gates, boss aura).
        public SpriteRenderer Light(Vector2 at, string hex, float radius, float alpha, int order = 3)
        {
            var r = new GameObject("light").AddComponent<SpriteRenderer>();
            r.transform.SetParent(root);
            r.sprite = Art.Glow();
            r.sortingOrder = order;
            r.transform.position = W(at);
            float scale = radius / 16f;
            r.transform.localScale = new Vector3(scale, scale, 1);
            var c = C(hex, alpha);
            r.color = c;
            lights.Add((r, c, scale, Random.Range(0f, 6.28f)));
            return r;
        }

        // Whole-board colour grade for the biome's time of day, plus a vignette that frames the board.
        public void Atmosphere(string time, float w, float h, Vector2 origin)
        {
            string hex; float a;
            switch (time)
            {
                case "dusk": hex = "#7A2A5A"; a = 0.16f; ambient = "fireflies"; break;
                case "dawn": hex = "#2A5A6A"; a = 0.12f; ambient = "leaves"; break;
                case "night": hex = "#162447"; a = 0.24f; ambient = "snow"; break;
                case "blood-moon": hex = "#8A1A1A"; a = 0.22f; ambient = "petals"; break;
                default: hex = "#000000"; a = 0f; ambient = "embers"; break;
            }
            var grade = new GameObject("grade").AddComponent<SpriteRenderer>();
            grade.transform.SetParent(root);
            grade.sprite = Art.Pixel();
            grade.color = C(hex, a);
            grade.sortingOrder = 40;
            grade.transform.position = W(origin + new Vector2(w / 2, h / 2));
            grade.transform.localScale = new Vector3(w, h, 1);
            var vig = new GameObject("vignette").AddComponent<SpriteRenderer>();
            vig.transform.SetParent(root);
            vig.sprite = Art.Vignette();
            vig.sortingOrder = 41;
            vig.transform.position = W(origin + new Vector2(w / 2, h / 2));
            vig.transform.localScale = new Vector3(w / 64f, h / 64f, 1);
            areaOrigin = origin; areaSize = new Vector2(w, h);
        }

        Vector2 areaOrigin, areaSize;

        void Ambient(float dt)
        {
            if (ambient == null) return;
            ambientAcc += dt * 4f;
            while (ambientAcc >= 1f)
            {
                ambientAcc -= 1f;
                var at = areaOrigin + new Vector2(Random.Range(0, areaSize.x), Random.Range(0, areaSize.y));
                switch (ambient)
                {
                    case "fireflies": Emit(at, Random.insideUnitCircle * 6, C("#FFE08A", 0.9f), 2.5f, 0, 1, 1); break;
                    case "leaves": Emit(new Vector2(at.x, areaOrigin.y), new Vector2(Random.Range(-8, 8), 18), C("#9FC7B4", 0.8f), 6, 0, 1.5f, 1.5f); break;
                    case "snow": Emit(new Vector2(at.x, areaOrigin.y), new Vector2(Random.Range(-6, 6), 14), C("#FFFFFF", 0.8f), 8, 0, 1, 1); break;
                    case "petals": Emit(new Vector2(at.x, areaOrigin.y), new Vector2(Random.Range(-10, 4), 16), C("#D2412F", 0.8f), 7, 0, 1.5f, 1); break;
                    default: Emit(new Vector2(at.x, areaOrigin.y + areaSize.y), new Vector2(Random.Range(-4, 4), -14), C("#F2A23A", 0.8f), 6, 0, 1, 0.5f); break;
                }
            }
        }

        // ---------- per frame ----------

        public void Update(float dt)
        {
            Ambient(dt);
            for (int i = live.Count - 1; i >= 0; i--)
            {
                var p = live[i];
                p.Life -= dt;
                if (p.Life <= 0)
                {
                    p.R.gameObject.SetActive(false);
                    pool.Push(p.R);
                    live.RemoveAt(i);
                    continue;
                }
                p.Vel.y += p.Gravity * dt;
                p.Pos += p.Vel * dt;
                float t = 1 - p.Life / p.MaxLife;
                float s = Mathf.Lerp(p.Scale0, p.Scale1, t);
                p.R.transform.position = W(new Vector2(Mathf.Round(p.Pos.x), Mathf.Round(p.Pos.y)));
                p.R.transform.localScale = new Vector3(p.Glow ? s : Mathf.Max(1, Mathf.Round(s)), p.Glow ? s : Mathf.Max(1, Mathf.Round(s)), 1);
                var c = p.C; c.a *= 1 - t * t;
                p.R.color = c;
            }
            for (int i = nums.Count - 1; i >= 0; i--)
            {
                var n = nums[i];
                n.Life -= dt;
                n.Pos.y -= 20 * dt;
                n.T.transform.position = W(n.Pos, -1);
                var c = n.T.color; c.a = Mathf.Clamp01(n.Life * 3); n.T.color = c;
                if (n.Life <= 0) { Object.Destroy(n.T.gameObject); nums.RemoveAt(i); }
            }
            float now = Time.time;
            foreach (var (r, c, bs, ph) in lights)
            {
                if (r == null) continue;
                float k = 1 + 0.08f * Mathf.Sin(now * 2.2f + ph);
                r.transform.localScale = new Vector3(bs * k, bs * k, 1);
                var cc = c; cc.a = c.a * (0.85f + 0.15f * Mathf.Sin(now * 3.1f + ph)); r.color = cc;
            }
            shake = Mathf.MoveTowards(shake, 0, dt * 12);
            ShakeOffset = shake > 0.05f ? new Vector3(Mathf.Round(Random.Range(-shake, shake)), Mathf.Round(Random.Range(-shake, shake)), 0) : Vector3.zero;
        }
    }
}
