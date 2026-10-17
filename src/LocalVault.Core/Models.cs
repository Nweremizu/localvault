using System.Security.Cryptography;
using System.Text.Json;

namespace LocalVault.Core;

public sealed record Entry
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Title { get; init; } = "";
    public string Username { get; init; } = "";
    public string Password { get; init; } = "";
    public string[] Origins { get; init; } = [];
    public string Notes { get; init; } = "";
    public string Type { get; init; } = "login";
    public CustomField[] Fields { get; init; } = [];
    public DateTimeOffset? DeletedAt { get; init; }
    public EntryRevision[] History { get; init; } = [];
    public DateTimeOffset Created { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset Updated { get; init; } = DateTimeOffset.UtcNow;

    public Entry Validated()
    {
        if (Id == Guid.Empty || string.IsNullOrWhiteSpace(Title) || Title.Length > 256 ||
            Username.Length > 4096 || Password.Length > 16384 || (Type == "login" && Password.Length == 0) || Notes.Length > 16384 ||
            Origins.Length > 32 || Created == default || Updated == default ||
            Type is not ("login" or "note") || Fields.Length > 32 || History.Length > 20 ||
            (DeletedAt is { } deleted && deleted == default))
            throw new InvalidDataException("Entry fields are missing or exceed the allowed size.");
        if (Type == "note" && (string.IsNullOrWhiteSpace(Notes) || Username.Length > 0 || Password.Length > 0 || Origins.Length > 0))
            throw new InvalidDataException("Secure notes require content and cannot contain login fields or websites.");
        var fields = Fields.Select(f => f.Validated()).ToArray();
        if (fields.Select(f => f.Id).Distinct().Count() != fields.Length ||
        History.Any(h => h == null || h.RevisedAt == default || h.Content == null || h.Content.Type is not ("login" or "note")))
            throw new InvalidDataException("Entry history or custom fields are invalid.");
        return this with { Origins = Origins.Select(Origin.Parse).Distinct(StringComparer.Ordinal).ToArray(), Fields = fields,
            History = History.Select(h => h.Validated()).ToArray() };
    }
}

public sealed record CustomField(Guid Id, string Label, string Type, string Value)
{
    public CustomField Validated() => Id == Guid.Empty || string.IsNullOrWhiteSpace(Label) || Label.Length > 128 ||
        Type is not ("text" or "secret") || Value.Length > 16384
        ? throw new InvalidDataException("Custom field is missing or exceeds the allowed size.") : this;
}

public sealed record RevisionContent(string Type, string Title, string Username, string Password, string[] Origins,
    string Notes, CustomField[] Fields, DateTimeOffset Created, DateTimeOffset Updated)
{
    public static RevisionContent From(Entry e) => new(e.Type, e.Title, e.Username, e.Password, e.Origins.ToArray(), e.Notes,
        e.Fields.ToArray(), e.Created, e.Updated);
    public RevisionContent Validated() => (new Entry { Id = Guid.NewGuid(), Type = Type, Title = Title, Username = Username,
        Password = Password, Origins = Origins, Notes = Notes, Fields = Fields, Created = Created, Updated = Updated }).Validated() is var e
        ? From(e) : throw new InvalidDataException("Invalid history revision.");
}

public sealed record EntryRevision(RevisionContent Content, DateTimeOffset RevisedAt)
{
    public EntryRevision Validated() => this with { Content = Content.Validated() };
}

public static class Origin
{
    public static string Parse(string value)
    {
        if (value.Length > 2048 || !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
            throw new InvalidDataException("Use an HTTPS website address without embedded credentials.");
        return new UriBuilder("https", uri.IdnHost.ToLowerInvariant(), uri.IsDefaultPort ? -1 : uri.Port)
            .Uri.GetLeftPart(UriPartial.Authority);
    }

    // ponytail: heuristic registrable domain, not the full Public Suffix List. Handles plain TLDs and country second
    // levels (co.uk, com.ng, com.au, co.jp ...). Shared-hosting suffixes such as github.io map to the host company;
    // callers try the saved host first. Ship the PSL if that ever gives wrong results.
    private static readonly HashSet<string> SecondLevels = ["com", "co", "net", "org", "gov", "edu", "ac", "or", "ne", "go", "gob", "mil", "nic", "sch", "ltd", "plc"];
    public static string MainDomain(string host)
    {
        if (System.Net.IPAddress.TryParse(host, out _)) return host;
        var labels = host.Split('.');
        var keep = labels.Length > 2 && labels[^1].Length == 2 && SecondLevels.Contains(labels[^2]) ? 3 : 2;
        return labels.Length <= keep ? host : string.Join('.', labels[^keep..]);
    }
}

/// <summary>Password generator settings, saved by the desktop app and reused by the tray's "Generate password".</summary>
public sealed record GeneratorOptions(int Length = 20, bool Upper = true, bool Lower = true, bool Digits = true, bool Symbols = true, bool AvoidAmbiguous = false)
{
    public GeneratorOptions Validated() => Length is < 8 or > 128 || !(Upper || Lower || Digits || Symbols)
        ? throw new InvalidDataException("Choose a length of 8–128 and at least one character type.") : this;
}

public static class Passwords
{
    public static string Generate(int length = 24) => Generate(new GeneratorOptions(length));

    // Every chosen character type appears at least once; positions and characters come from the OS CSPRNG.
    public static string Generate(GeneratorOptions options)
    {
        options.Validated();
        string Pick(string chars) => options.AvoidAmbiguous ? string.Concat(chars.Where(c => !"Il1O0o".Contains(c))) : chars;
        var sets = new[]
        {
            options.Upper ? Pick("ABCDEFGHIJKLMNOPQRSTUVWXYZ") : "", options.Lower ? Pick("abcdefghijklmnopqrstuvwxyz") : "",
            options.Digits ? Pick("0123456789") : "", options.Symbols ? "!@#$%^&*()-_=+[]{};:,.?" : "",
        }.Where(s => s.Length > 0).ToArray();
        var all = string.Concat(sets);
        var result = new char[options.Length];
        for (var i = 0; i < result.Length; i++) result[i] = all[RandomNumberGenerator.GetInt32(all.Length)];
        // Guarantee one of each type at distinct random positions.
        var positions = Enumerable.Range(0, result.Length).ToArray();
        RandomNumberGenerator.Shuffle(positions.AsSpan());
        for (var s = 0; s < sets.Length; s++) result[positions[s]] = sets[s][RandomNumberGenerator.GetInt32(sets[s].Length)];
        try { return new string(result); }
        finally { Array.Clear(result); }
    }
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        MaxDepth = 16,
        RespectNullableAnnotations = true,
        UnmappedMemberHandling = System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow
    };
}
