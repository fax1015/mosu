using System.Text.Json;
using System.Text.Json.Serialization;
using Realms;
using Realms.Exceptions;

var invocation = ParseInvocation(args);
if (invocation.ErrorMessage is not null)
{
    Console.Error.WriteLine(invocation.ErrorMessage);
    Environment.Exit(1);
    return;
}

if (!File.Exists(invocation.RealmPath))
{
    Console.Error.WriteLine($"Realm file not found: {invocation.RealmPath}");
    Environment.Exit(1);
    return;
}

try
{
    switch (invocation.Command)
    {
        case "resolve-all":
            using (var realm = Realm.GetInstance(CreateConfig(invocation.RealmPath, isReadOnly: true, includeCollections: false)))
            {
                ResolveAll(realm, invocation.FilesRoot);
            }
            break;

        case "manifest":
            if (string.IsNullOrWhiteSpace(invocation.BeatmapHash))
            {
                Console.Error.WriteLine("Usage: realm-resolver [data_root_or_realm_path] manifest <beatmap_hash>");
                Environment.Exit(1);
                return;
            }

            using (var realm = Realm.GetInstance(CreateConfig(invocation.RealmPath, isReadOnly: true, includeCollections: false)))
            {
                WriteManifest(realm, invocation.FilesRoot, invocation.BeatmapHash);
            }
            break;

        case "list-collections":
            using (var realm = Realm.GetInstance(CreateConfig(invocation.RealmPath, isReadOnly: true, includeCollections: true)))
            {
                WriteCollections(realm);
            }
            break;

        case "add-to-collection":
            if (string.IsNullOrWhiteSpace(invocation.CollectionName) || string.IsNullOrWhiteSpace(invocation.BeatmapHash))
            {
                Console.WriteLine(JsonSerializer.Serialize(new MutationResult
                {
                    Success = false,
                    Error = "invalid_input",
                }));
                return;
            }

            try
            {
                using var realm = Realm.GetInstance(CreateConfig(invocation.RealmPath, isReadOnly: false, includeCollections: true));
                WriteAddToCollectionResult(realm, invocation.CollectionName, invocation.BeatmapHash);
            }
            catch (RealmInUseException)
            {
                Console.WriteLine(JsonSerializer.Serialize(new MutationResult
                {
                    Success = false,
                    Error = "realm_locked",
                }));
            }
            catch (IOException ioEx) when (IsLockedException(ioEx))
            {
                Console.WriteLine(JsonSerializer.Serialize(new MutationResult
                {
                    Success = false,
                    Error = "realm_locked",
                }));
            }
            break;

        default:
            Console.Error.WriteLine($"Unknown command: {invocation.Command}");
            Environment.Exit(1);
            break;
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    Environment.Exit(1);
}

static Invocation ParseInvocation(string[] args)
{
    if (args.Length == 0)
    {
        return new Invocation
        {
            ErrorMessage = "Usage: realm-resolver [data_root_or_realm_path] <resolve-all|manifest|list-collections|add-to-collection> [args]",
        };
    }

    var firstArg = args[0];
    var hasExplicitPath =
        File.Exists(firstArg) ||
        Directory.Exists(firstArg) ||
        firstArg.EndsWith(".realm", StringComparison.OrdinalIgnoreCase);

    var dataRoot = hasExplicitPath ? firstArg : GetDefaultLazerDataRoot();
    if (string.IsNullOrWhiteSpace(dataRoot))
    {
        return new Invocation
        {
            ErrorMessage = "Could not determine osu!lazer data folder.",
        };
    }

    var realmPath = File.Exists(dataRoot) && dataRoot.EndsWith(".realm", StringComparison.OrdinalIgnoreCase)
        ? dataRoot
        : Path.Combine(dataRoot, "client.realm");
    var filesRoot = File.Exists(dataRoot) && dataRoot.EndsWith(".realm", StringComparison.OrdinalIgnoreCase)
        ? Path.Combine(Path.GetDirectoryName(dataRoot) ?? ".", "files")
        : Path.Combine(dataRoot, "files");

    var commandIndex = hasExplicitPath ? 1 : 0;
    var command = commandIndex < args.Length ? NormalizeCommand(args[commandIndex]) : "resolve-all";
    var remainingArgs = args.Skip(commandIndex + 1).ToArray();

    var invocation = new Invocation
    {
        RealmPath = realmPath,
        FilesRoot = filesRoot,
        Command = command,
    };

    switch (command)
    {
        case "manifest":
            invocation.BeatmapHash = remainingArgs.FirstOrDefault();
            break;

        case "add-to-collection":
            for (var i = 0; i < remainingArgs.Length; i++)
            {
                switch (remainingArgs[i])
                {
                    case "--collection-name" when i + 1 < remainingArgs.Length:
                        invocation.CollectionName = remainingArgs[++i];
                        break;
                    case "--beatmap-hash" when i + 1 < remainingArgs.Length:
                        invocation.BeatmapHash = remainingArgs[++i];
                        break;
                }
            }
            break;
    }

    return invocation;
}

static RealmConfiguration CreateConfig(string realmPath, bool isReadOnly, bool includeCollections)
{
    var schema = new List<Type>
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
    };

    if (includeCollections)
    {
        schema.Add(typeof(BeatmapCollection));
        schema.Add(typeof(BeatmapCollectionItem));
    }

    return new RealmConfiguration(realmPath)
    {
        IsReadOnly = isReadOnly,
        SchemaVersion = 51,
        Schema = schema,
    };
}

static string NormalizeCommand(string rawCommand)
{
    var command = rawCommand.Trim();
    if (command.StartsWith("--", StringComparison.Ordinal))
    {
        command = command[2..];
    }

    return command switch
    {
        "resolve-all" => "resolve-all",
        "manifest" => "manifest",
        "list-collections" => "list-collections",
        "add-to-collection" => "add-to-collection",
        _ => command,
    };
}

static string GetDefaultLazerDataRoot()
{
    var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
    return string.IsNullOrWhiteSpace(appData)
        ? string.Empty
        : Path.Combine(appData, "osu");
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

static void WriteCollections(Realm realm)
{
    var collections = realm.All<BeatmapCollection>()
        .Where(collection => !collection.DeletePending)
        .ToArray()
        .OrderBy(collection => collection.Name, StringComparer.OrdinalIgnoreCase)
        .Select(collection => new CollectionEntry
        {
            Name = collection.Name,
            BeatmapHashes = collection.BeatmapMD5Hashes
                .Select(item => (item.BeatmapMD5 ?? string.Empty).Trim().ToLowerInvariant())
                .Where(hash => !string.IsNullOrWhiteSpace(hash))
                .ToArray(),
        })
        .ToArray();

    Console.WriteLine(JsonSerializer.Serialize(collections));
}

static void WriteAddToCollectionResult(Realm realm, string collectionName, string beatmapHash)
{
    var normalizedHash = beatmapHash.Trim().ToLowerInvariant();
    var collection = realm.All<BeatmapCollection>()
        .FirstOrDefault(entry => entry.Name.Equals(collectionName, StringComparison.OrdinalIgnoreCase) && !entry.DeletePending);

    if (collection == null)
    {
        Console.WriteLine(JsonSerializer.Serialize(new MutationResult
        {
            Success = false,
            Error = "collection not found",
        }));
        return;
    }

    var alreadyExists = collection.BeatmapMD5Hashes
        .Any(item => string.Equals(item.BeatmapMD5, normalizedHash, StringComparison.OrdinalIgnoreCase));

    if (!alreadyExists)
    {
        realm.Write(() =>
        {
            collection.BeatmapMD5Hashes.Add(new BeatmapCollectionItem
            {
                BeatmapMD5 = normalizedHash,
            });
        });
    }

    Console.WriteLine(JsonSerializer.Serialize(new MutationResult
    {
        Success = true,
    }));
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

static bool IsLockedException(IOException exception)
{
    var message = exception.Message.ToLowerInvariant();
    return message.Contains("being used by another process")
        || message.Contains("sharing violation")
        || message.Contains("locked");
}

file sealed class Invocation
{
    public string RealmPath { get; set; } = string.Empty;
    public string FilesRoot { get; set; } = string.Empty;
    public string Command { get; set; } = "resolve-all";
    public string? BeatmapHash { get; set; }
    public string? CollectionName { get; set; }
    public string? ErrorMessage { get; set; }
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

file sealed class CollectionEntry
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("beatmapHashes")]
    public IEnumerable<string> BeatmapHashes { get; set; } = Array.Empty<string>();
}

file sealed class MutationResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; set; }
}

[MapTo("File")]
public partial class RealmFile : RealmObject
{
    [PrimaryKey]
    public string Hash { get; set; } = string.Empty;

    [Backlink(nameof(RealmNamedFileUsage.File))]
    public IQueryable<RealmNamedFileUsage> Usages { get; } = null!;
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
    public IList<string> UserTags { get; } = null!;
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
    public IList<BeatmapInfo> Beatmaps { get; } = null!;
    public IList<RealmNamedFileUsage> Files { get; } = null!;

    [MapTo("Status")]
    public int StatusInt { get; set; }

    public bool DeletePending { get; set; }
    public string Hash { get; set; } = string.Empty;
    public bool Protected { get; set; }
}

[MapTo("BeatmapCollection")]
public partial class BeatmapCollection : RealmObject
{
    [PrimaryKey]
    public Guid ID { get; set; }

    [Indexed]
    public string Name { get; set; } = string.Empty;

    public IList<BeatmapCollectionItem> BeatmapMD5Hashes { get; } = null!;

    public bool DeletePending { get; set; }
}

public partial class BeatmapCollectionItem : EmbeddedObject
{
    public string BeatmapMD5 { get; set; } = string.Empty;
}
