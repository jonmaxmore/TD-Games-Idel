// Editor helpers: a one-click main scene and reproducible builds for the engine comparison.
// Also callable from the command line: Unity -batchmode -quit -projectPath . -executeMethod FiveSectsMenu.BuildWebGL
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class FiveSectsMenu
{
    const string ScenePath = "Assets/Scenes/Main.unity";

    [InitializeOnLoadMethod]
    static void EnsureSceneOnOpen() => EditorApplication.delayCall += () => { if (!File.Exists(ScenePath)) CreateMainScene(); };

    [MenuItem("Five Sects/Create Main Scene")]
    public static void CreateMainScene()
    {
        Directory.CreateDirectory("Assets/Scenes");
        // The game builds itself at runtime (FiveSects.Game.Bootstrap), so the scene only needs a camera.
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        Debug.Log("Five Sects: created " + ScenePath + " and added it to Build Settings. Press Play.");
    }

    [MenuItem("Five Sects/Build WebGL")]
    public static void BuildWebGL()
    {
        if (!File.Exists(ScenePath)) CreateMainScene();
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
        PlayerSettings.WebGL.decompressionFallback = true; // works on any static server, slightly larger loader
        Build(BuildTarget.WebGL, "Builds/WebGL");
    }

    [MenuItem("Five Sects/Build Android APK")]
    public static void BuildAndroid()
    {
        if (!File.Exists(ScenePath)) CreateMainScene();
        Build(BuildTarget.Android, "Builds/Android/five-sects.apk");
    }

    static void Build(BuildTarget target, string path)
    {
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = path, target = target });
        var sum = report.summary;
        Debug.Log($"Five Sects build {target}: {sum.result}, {sum.totalSize / 1024f / 1024f:0.00} MB, {sum.totalTime.TotalSeconds:0}s → {path}");
        if (Application.isBatchMode && sum.result != BuildResult.Succeeded) EditorApplication.Exit(1);
    }
}
