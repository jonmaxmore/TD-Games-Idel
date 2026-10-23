// Builds the whole game from code at startup, so the project needs no prefabs or hand-made scenes.
using FiveSects.Sim;
using UnityEngine;

namespace FiveSects.Game
{
    public static class Bootstrap
    {
        public const int W = 180, H = 320;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Start()
        {
            if (Object.FindFirstObjectByType<DefendView>() != null || Object.FindFirstObjectByType<Flow>() != null) return;
            LoadData();
            Application.targetFrameRate = 60;

            var cam = Camera.main;
            if (cam == null) cam = new GameObject("Main Camera") { tag = "MainCamera" }.AddComponent<Camera>();
            cam.orthographic = true;
            cam.orthographicSize = H / 2f;                       // 1 world unit = 1 game pixel
            cam.transform.position = new Vector3(W / 2f, -H / 2f, -10f); // world y goes down: y_world = -y_game
            cam.backgroundColor = Art.Hex("#0B0910");
            cam.clearFlags = CameraClearFlags.SolidColor;

            new GameObject("Flow").AddComponent<Flow>();
        }

        // Parsed once per app run; every stage after the first reuses it.
        public static void LoadData()
        {
            if (GameData.Stages.Count > 0) return;
            GameData.Load(name =>
            {
                var asset = Resources.Load<TextAsset>("data/" + name);
                if (asset == null) throw new System.Exception("Missing Resources/data/" + name + ".json — run: npm run unity:sync");
                return asset.text;
            });
        }
    }
}
