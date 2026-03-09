using System.Text.Json;
using System.Text.Json.Serialization;
using Realms;

if (args.Length < 1)
{
    Console.Error.WriteLine("Usage: realm-resolver <data_root_or_realm_path> [--resolve-all | --manifest <beatmap_hash>]");
    Environment.Exit(1);
    return;
}

var dataRoot = args[0];
string realmPath;
string filesRoot;

if (File.Exists(dataRoot) && dataRoot.EndsWith(".realm", StringComparison.OrdinalIgnoreCase))
{
    realmPath = dataRoot;
    filesRoot = Path.Combine(Path.GetDirectoryName(dataRoot) ?? ".", "files");
}
else if (Directory.Exists(dataRoot))
{
    realmPath = Path.Combine(dataRoot, "client.realm");
    filesRoot = Path.Combine(dataRoot, "files");
}
else
{
    Console.Error.WriteLine($"Path not found: {dataRoot}");
    Environment.Exit(1);
    return;
}

if (!File.Exists(realmPath))
{
    Console.Error.WriteLine($"Realm file not found: {realmPath}");
    Environment.Exit(1);
    return;
}

var config = new RealmConfiguration(realmPath)
{
    IsReadOnly = true,
    SchemaVersion = 51,
    Schema = new[]
    {
        typeof(RealmFile),
        typeof(RealmNamedFileUsage),
        typeof(RealmUser),
        typeof(RulesetInfo),
        typeof(BeatmapDifficulty),
        typeof(BeatmapUserSettings),
        typeof(BeatmapMetadata),
        typeof(BeatmapInfo),
        typeof(BeatmapSetInfo),
    },
};

using var realm = Realm.GetInstance(config);

var command = args.Length > 1 ? args[1] : "--resolve-all";

if (string.Equals(command, "--resolve-all", StringComparison.OrdinalIgnoreCase))
{
    ResolveAll(realm, filesRoot);
}
else if (string.Equals(command, "--manifest", StringComparison.OrdinalIgnoreCase))
{
    if (args.Length < 3)
    {
        Console.Error.WriteLine("Usage: realm-resolver <data_root_or_realm_path> --manifest <beatmap_hash>");
        Environment.Exit(1);
        return;
    }

    WriteManifest(realm, filesRoot, args[2]);
}
else
{
    Console.Error.WriteLine($"Unknown command: {command}");
    Environment.Exit(1);
}

static void ResolveAll(Realm realm, string filesRoot)
{
    var beatmaps = realm.All<BeatmapInfo>()
        .Where(b => b.BeatmapSet != null)
        .Where(b => !string.IsNullOrEmpty(b.Hash));

    var opts = new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    foreach (var beatmap in beatmaps)
    {
        var set = beatmap.BeatmapSet;
        if (set == null) continue;

        var audioFilename = beatmap.Metadata?.AudioFile ?? string.Empty;
        var bgFilename = beatmap.Metadata?.BackgroundFile ?? string.Empty;

        var audioUsage = FindUsage(set, audioFilename);
        var bgUsage = FindUsage(set, bgFilename);

        var audioHash = audioUsage?.File?.Hash;
        var bgHash = bgUsage?.File?.Hash;

        var audioPath = audioHash != null ? HashedStorePath(filesRoot, audioHash) : null;
        var bgPath = bgHash != null ? HashedStorePath(filesRoot, bgHash) : null;

        if (audioPath != null && !File.Exists(audioPath)) audioPath = null;
        if (bgPath != null && !File.Exists(bgPath)) bgPath = null;

        Console.WriteLine(JsonSerializer.Serialize(new ResolvedEntry
        {
            H = beatmap.Hash,
            A = audioPath,
            B = bgPath,
        }, opts));
    }
}

static void WriteManifest(Realm realm, string filesRoot, string beatmapHash)
{
    var beatmap = realm.All<BeatmapInfo>()
        .AsEnumerable()
        .FirstOrDefault(b => string.Equals(b.Hash, beatmapHash, StringComparison.OrdinalIgnoreCase));

    if (beatmap?.BeatmapSet == null)
    {
        Console.Error.WriteLine($"Beatmap not found: {beatmapHash}");
        Environment.Exit(1);
        return;
    }

    var set = beatmap.BeatmapSet;
    var files = new List<ManifestFileEntry>();
    string? osuFilename = null;

    foreach (var usage in set.Files)
    {
        var file = usage.File;
        if (file?.Hash == null || string.IsNullOrWhiteSpace(usage.Filename))
        {
            continue;
        }

        var storePath = HashedStorePath(filesRoot, file.Hash);
        if (!File.Exists(storePath))
        {
            continue;
        }

        files.Add(new ManifestFileEntry
        {
            N = usage.Filename,
            P = storePath,
        });

        if (osuFilename == null && string.Equals(file.Hash, beatmap.Hash, StringComparison.OrdinalIgnoreCase))
        {
            osuFilename = usage.Filename;
        }
    }

    var opts = new JsonSerializerOptions
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    Console.WriteLine(JsonSerializer.Serialize(new ManifestEntry
    {
        H = beatmap.Hash,
        O = osuFilename,
        F = files,
    }, opts));
}

static RealmNamedFileUsage? FindUsage(BeatmapSetInfo set, string filename)
{
    if (string.IsNullOrWhiteSpace(filename)) return null;
    return set.Files.FirstOrDefault(f =>
        string.Equals(f.Filename, filename, StringComparison.OrdinalIgnoreCase));
}

static string HashedStorePath(string filesRoot, string hash)
{
    return Path.Combine(filesRoot, hash[..1], hash[..2], hash);
}

file sealed class ResolvedEntry
{
    [JsonPropertyName("h")]
    public string H { get; set; } = string.Empty;

    [JsonPropertyName("a")]
    public string? A { get; set; }

    [JsonPropertyName("b")]
    public string? B { get; set; }
}

file sealed class ManifestEntry
{
    [JsonPropertyName("h")]
    public string H { get; set; } = string.Empty;

    [JsonPropertyName("o")]
    public string? O { get; set; }

    [JsonPropertyName("f")]
    public List<ManifestFileEntry> F { get; set; } = [];
}

file sealed class ManifestFileEntry
{
    [JsonPropertyName("n")]
    public string N { get; set; } = string.Empty;

    [JsonPropertyName("p")]
    public string P { get; set; } = string.Empty;
}

[MapTo("File")]
public partial class RealmFile : RealmObject
{
    [PrimaryKey]
    public string Hash { get; set; } = string.Empty;

    [Backlink(nameof(RealmNamedFileUsage.File))]
    public IQueryable<RealmNamedFileUsage> Usages { get; }
}

public partial class RealmNamedFileUsage : EmbeddedObject
{
    public RealmFile File { get; set; } = null!;

    public string Filename { get; set; } = string.Empty;
}

public partial class RealmUser : EmbeddedObject
{
    public int OnlineID { get; set; } = 1;

    public string Username { get; set; } = string.Empty;

    [MapTo("CountryCode")]
    public string CountryString { get; set; } = "Unknown";
}

[MapTo("Ruleset")]
public partial class RulesetInfo : RealmObject
{
    [PrimaryKey]
    public string ShortName { get; set; } = string.Empty;

    [Indexed]
    public int OnlineID { get; set; } = -1;

    public string Name { get; set; } = string.Empty;

    public string InstantiationInfo { get; set; } = string.Empty;

    public int LastAppliedDifficultyVersion { get; set; }

    public bool Available { get; set; }
}

[MapTo("BeatmapDifficulty")]
public partial class BeatmapDifficulty : EmbeddedObject
{
    public float DrainRate { get; set; } = 5;
    public float CircleSize { get; set; } = 5;
    public float OverallDifficulty { get; set; } = 5;
    public float ApproachRate { get; set; } = 5;
    public double SliderMultiplier { get; set; } = 1.4;
    public double SliderTickRate { get; set; } = 1;
}

public partial class BeatmapUserSettings : EmbeddedObject
{
    public double Offset { get; set; }
}

[MapTo("BeatmapMetadata")]
public partial class BeatmapMetadata : RealmObject
{
    public string Title { get; set; } = string.Empty;
    public string TitleUnicode { get; set; } = string.Empty;
    public string Artist { get; set; } = string.Empty;
    public string ArtistUnicode { get; set; } = string.Empty;
    public RealmUser Author { get; set; } = null!;
    public string Source { get; set; } = string.Empty;
    public string Tags { get; set; } = string.Empty;
    public IList<string> UserTags { get; }
    public int PreviewTime { get; set; } = -1;
    public string AudioFile { get; set; } = string.Empty;
    public string BackgroundFile { get; set; } = string.Empty;
}

[MapTo("Beatmap")]
public partial class BeatmapInfo : RealmObject
{
    [PrimaryKey]
    public Guid ID { get; set; }

    public string DifficultyName { get; set; } = string.Empty;
    public RulesetInfo Ruleset { get; set; } = null!;
    public BeatmapDifficulty Difficulty { get; set; } = null!;
    public BeatmapMetadata Metadata { get; set; } = null!;
    public BeatmapUserSettings UserSettings { get; set; } = null!;
    public BeatmapSetInfo? BeatmapSet { get; set; }

    [MapTo("Status")]
    public int StatusInt { get; set; }

    [Indexed]
    public int OnlineID { get; set; } = -1;

    public double Length { get; set; }
    public double BPM { get; set; }
    public string Hash { get; set; } = string.Empty;
    public double StarRating { get; set; } = -1;

    [Indexed]
    public string MD5Hash { get; set; } = string.Empty;

    public string OnlineMD5Hash { get; set; } = string.Empty;
    public DateTimeOffset? LastLocalUpdate { get; set; }
    public DateTimeOffset? LastOnlineUpdate { get; set; }
    public bool Hidden { get; set; }
    public int EndTimeObjectCount { get; set; } = -1;
    public int TotalObjectCount { get; set; } = -1;
    public DateTimeOffset? LastPlayed { get; set; }
    public int BeatDivisor { get; set; } = 4;
    public double? EditorTimestamp { get; set; }
}

[MapTo("BeatmapSet")]
public partial class BeatmapSetInfo : RealmObject
{
    [PrimaryKey]
    public Guid ID { get; set; }

    [Indexed]
    public int OnlineID { get; set; } = -1;

    public DateTimeOffset DateAdded { get; set; }
    public DateTimeOffset? DateSubmitted { get; set; }
    public DateTimeOffset? DateRanked { get; set; }
    public IList<BeatmapInfo> Beatmaps { get; }
    public IList<RealmNamedFileUsage> Files { get; }

    [MapTo("Status")]
    public int StatusInt { get; set; }

    public bool DeletePending { get; set; }
    public string Hash { get; set; } = string.Empty;
    public bool Protected { get; set; }
}
