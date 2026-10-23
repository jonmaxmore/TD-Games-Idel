// Account, save, remote config and analytics behind interfaces (SPEC-front-flow §4). The prototype has no
// server, so each has a local implementation; M1 swaps them for the .NET api (ADR 0006) without touching the screens.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace FiveSects.Game
{
    [Serializable]
    public class StageStars { public string Id; public int Best; }

    [Serializable]
    public class Profile
    {
        public const int CurrentVersion = 2;
        public int Version = CurrentVersion;
        public string PlayerId;
        public bool Consented;
        public int BirthYear;
        public bool TutorialDone;
        public string Sect;          // element id of the sect picked after the tutorial
        public string Name;
        public List<string> Cleared = new List<string>();
        public int SectChangeTokens; // ป้ายย้ายสังกัด (SPEC-front-flow §5)
        public long FirstPlaceMs = -1; // app start to first disciple placed, first run only
        public bool Classic2D;         // battle drawn as the old flat 2D sprites instead of the 3D board
        public bool IntroSeen;         // the three intro pages play once
        public List<StageStars> Stars = new List<StageStars>(); // best stars per stage (JsonUtility cannot store a dictionary)

        public int BestStars(string id) { foreach (var x in Stars) if (x.Id == id) return x.Best; return 0; }

        public void RecordStars(string id, int n)
        {
            foreach (var x in Stars) if (x.Id == id) { x.Best = Math.Max(x.Best, n); return; }
            Stars.Add(new StageStars { Id = id, Best = n });
        }

        // Brings an older or edited save up to date. Anything that no longer exists in the data is dropped, so a
        // renamed sect or stage sends the player back to the matching step instead of crashing a screen.
        public void Migrate()
        {
            if (Cleared == null) Cleared = new List<string>();
            if (Stars == null) Stars = new List<StageStars>();
            if (Sect != null && (!FiveSects.Sim.GameData.Sects.ContainsKey(Sect) || !FiveSects.Sim.GameData.RosterSects.Contains(Sect))) Sect = null;
            Cleared.RemoveAll(id => !FiveSects.Sim.GameData.Stages.ContainsKey(id));
            Stars.RemoveAll(x => x == null || !FiveSects.Sim.GameData.Stages.ContainsKey(x.Id));
            if (Version < 2) IntroSeen = TutorialDone;
            Version = CurrentVersion;
        }
    }

    public class RemoteConfig
    {
        public string MinVersion = "0.0";
        public bool Maintenance;
        public string MaintenanceTh = "", MaintenanceEn = "";
        public bool ShopEnabled = true, PvpEnabled = true, GachaEnabled = true; // kill switches (SPEC-front-flow §6.2)
        public string StoreUrl = "", TermsUrl = "", PrivacyUrl = "";
    }

    public interface IAuthService { string SignIn(Profile p); }
    public interface IProfileStore { Profile Load(); void Save(Profile p); void Reset(); }
    public interface IRemoteConfig { RemoteConfig Fetch(); }
    public interface IAnalytics { void Track(string ev, string data = null); }

    // Guest account: a random id kept in the save. Linking Google/Apple later keeps the same id server-side.
    public class GuestAuth : IAuthService
    {
        public string SignIn(Profile p)
        {
            if (string.IsNullOrEmpty(p.PlayerId)) p.PlayerId = Guid.NewGuid().ToString("N");
            return p.PlayerId;
        }
    }

    public class FileProfileStore : IProfileStore
    {
        static string PathOf => System.IO.Path.Combine(Application.persistentDataPath, "profile.json");
        static string Tmp => PathOf + ".tmp";
        static string Bak => PathOf + ".bak";

        // The save, else the last half-finished write, else the previous save. A file that exists but cannot be read
        // is moved aside (never overwritten), so a bad write or a bug can be recovered by hand.
        public Profile Load()
        {
            foreach (var path in new[] { PathOf, Tmp, Bak })
            {
                if (!File.Exists(path)) continue;
                try
                {
                    var p = JsonUtility.FromJson<Profile>(File.ReadAllText(path));
                    if (p != null) return p;
                }
                catch (Exception e) { Debug.Log("save unreadable (" + path + "): " + e.Message); }
                try { File.Move(path, path + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmss")); } catch (Exception) { }
            }
            return new Profile();
        }

        // Write the new save next to the old one, then swap them in one step with the old one kept as .bak.
        public void Save(Profile p)
        {
            File.WriteAllText(Tmp, JsonUtility.ToJson(p, true));
            if (File.Exists(PathOf)) File.Replace(Tmp, PathOf, Bak);
            else File.Move(Tmp, PathOf);
        }

        public void Reset()
        {
            foreach (var path in new[] { PathOf, Tmp, Bak }) if (File.Exists(path)) File.Delete(path);
        }
    }

    public class BuiltInRemoteConfig : IRemoteConfig { public RemoteConfig Fetch() => new RemoteConfig(); }

    // Funnel events as tab-separated lines (session, ms since app start, event, data) in funnel.log next to the save.
    public class FileAnalytics : IAnalytics
    {
        public static string PathOf => System.IO.Path.Combine(Application.persistentDataPath, "funnel.log");
        static readonly string Session = Guid.NewGuid().ToString("N").Substring(0, 8);

        public void Track(string ev, string data = null)
        {
            long ms = (long)(Time.realtimeSinceStartup * 1000);
            try { File.AppendAllText(PathOf, Session + "\t" + ms + "\t" + ev + "\t" + (data ?? "") + "\n"); }
            catch (Exception e) { Debug.Log("analytics write failed: " + e.Message); }
        }
    }
}
