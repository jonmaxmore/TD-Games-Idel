// Test runner for the C# rules. Every public static void method marked [Test] in this assembly is a test;
// a failed Check throws and the test is reported with its message. Exit code = number of failures.
//   dotnet run --project tools/simtest                 run all tests
//   dotnet run --project tools/simtest -- balance      run tests whose name contains "balance"
//   dotnet run --project tools/simtest -- --write-golden
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using FiveSects.Sim;

[AttributeUsage(AttributeTargets.Method)]
sealed class TestAttribute : Attribute { }

sealed class CheckFailed : Exception { public CheckFailed(string m) : base(m) { } }

static class Check
{
    public static void True(bool cond, string what) { if (!cond) throw new CheckFailed(what); }
    public static void Eq<T>(T expected, T actual, string what = "")
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new CheckFailed($"{what}: expected {expected}, got {actual}");
    }
    public static void Seq<T>(IEnumerable<T> expected, IEnumerable<T> actual, string what = "")
    {
        var e = expected.ToList(); var a = actual.ToList();
        if (!e.SequenceEqual(a)) throw new CheckFailed($"{what}: expected [{string.Join(", ", e)}], got [{string.Join(", ", a)}]");
    }
    public static void AtLeast(double min, double actual, string what) { if (actual < min) throw new CheckFailed($"{what}: {actual} < {min}"); }
    public static void AtMost(double max, double actual, string what) { if (actual > max) throw new CheckFailed($"{what}: {actual} > {max}"); }
}

static class Repo
{
    public static readonly string Root = FindRoot();
    public static string Assets => Path.Combine(Root, "prototypes", "unity", "Assets");
    public static string Sim => Path.Combine(Assets, "Scripts", "Sim");
    public static string Goldens => Path.Combine(Assets, "Editor", "Tests");
    public static string UnityData => Path.Combine(Assets, "Resources", "data");
    public static string DocsData => Path.Combine(Root, "docs", "data");

    static string FindRoot()
    {
        var d = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (d != null && !File.Exists(Path.Combine(d.FullName, "CLAUDE.md"))) d = d.Parent;
        return d?.FullName ?? throw new Exception("run from inside the repo");
    }
}

static class Program
{
    static int Main(string[] args)
    {
        // The rules read the data the Unity client ships (synced from docs/data by npm run unity:sync).
        GameData.Load(n => File.ReadAllText(Path.Combine(Repo.UnityData, n + ".json")));
        if (args.Contains("--write-golden")) { Goldens.WriteAll(); return 0; }
        if (args.Contains("--measure")) { Measure.Report(); return 0; }

        string filter = args.FirstOrDefault(a => !a.StartsWith("--"));
        var tests = typeof(Program).Assembly.GetTypes()
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
            .Where(m => m.GetCustomAttribute<TestAttribute>() != null)
            .Select(m => (name: m.DeclaringType.Name + "." + m.Name, m))
            .Where(t => filter == null || t.name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .OrderBy(t => t.name, StringComparer.Ordinal)
            .ToList();
        int fails = 0;
        var total = Stopwatch.StartNew();
        foreach (var (name, m) in tests)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                m.Invoke(null, null);
                Console.WriteLine($"ok   {name} ({sw.ElapsedMilliseconds} ms)");
            }
            catch (TargetInvocationException ex)
            {
                fails++;
                var inner = ex.InnerException;
                Console.WriteLine($"FAIL {name}: {(inner is CheckFailed ? inner.Message : inner.ToString())}");
            }
        }
        Console.WriteLine($"\n{tests.Count - fails}/{tests.Count} passed in {total.Elapsed.TotalSeconds:0.0} s");
        return fails;
    }
}
