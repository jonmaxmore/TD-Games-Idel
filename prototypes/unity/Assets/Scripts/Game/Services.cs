// Account, save, remote config and analytics behind interfaces (SPEC-front-flow §4). The prototype has no
// server, so each has a local implementation; M1 swaps them for packages/api without touching the screens.
using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

namespace FiveSects.Game
{
    public class Profile
    {
        public int Version = 1;
        public string PlayerId;
        public bool Consented;
        public int BirthYear;
        public bool TutorialDone;
        public string Sect;          // element id of the sect picked after the tutorial
        public string Name;
        public List<string> Cleared = new List<string>();
        public int SectChangeTokens; // ป้ายย้ายสังกัด (SPEC-front-flow §5)
        public long FirstPlaceMs = -1; // app start to first disciple placed, first run only
    }

    public class RemoteConfig
    {
        public string MinVersion = "0.0";
        public bool Maintenance;
        public string MaintenanceTh = "", MaintenanceEn = "";
        public bool ShopEnabled = true, PvpEnabled = true, GachaEnabled = true; // kill switches (SPEC-front-flow §6.2)
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

        public Profile Load()
        {
            try
            {
                if (File.Exists(PathOf)) return JsonConvert.DeserializeObject<Profile>(File.ReadAllText(PathOf)) ?? new Profile();
            }
            catch (Exception e) { Debug.Log("profile unreadable, starting fresh: " + e.Message); }
            return new Profile();
        }

        // Write to a temp file then swap, so a crash mid-save never leaves a half-written profile.
        public void Save(Profile p)
        {
            var tmp = PathOf + ".tmp";
            File.WriteAllText(tmp, JsonConvert.SerializeObject(p, Formatting.Indented));
            if (File.Exists(PathOf)) File.Delete(PathOf);
            File.Move(tmp, PathOf);
        }

        public void Reset() { if (File.Exists(PathOf)) File.Delete(PathOf); }
    }

    public class BuiltInRemoteConfig : IRemoteConfig { public RemoteConfig Fetch() => new RemoteConfig(); }

    // Funnel events as tab-separated lines (ms since app start, event, data) in funnel.log next to the save.
    public class FileAnalytics : IAnalytics
    {
        public static string PathOf => System.IO.Path.Combine(Application.persistentDataPath, "funnel.log");

        public void Track(string ev, string data = null)
        {
            long ms = (long)(Time.realtimeSinceStartup * 1000);
            try { File.AppendAllText(PathOf, ms + "\t" + ev + "\t" + (data ?? "") + "\n"); }
            catch (Exception e) { Debug.Log("analytics write failed: " + e.Message); }
        }
    }
}
