using Microsoft.VisualBasic.FileIO;

namespace LocalVault.Core;

public enum ImportAction { Skip, Add, Replace }
public sealed class ImportRow
{
    public int Row { get; init; }
    public Entry? Entry { get; init; }
    public string Title => Entry?.Title ?? "Invalid row";
    public string Username => Entry?.Username ?? "";
    public string Website { get; init; } = "";
    public string Status { get; init; } = "";
    public ImportAction Action { get; set; }
}

public static class ImportCsv
{
    public static List<ImportRow> Preview(string path, IReadOnlyList<Entry> existing)
    {
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > VaultFormat.MaxFileBytes) throw new InvalidDataException("CSV must be at most 16 MiB.");
        using var parser = new TextFieldParser(file) { TextFieldType = FieldType.Delimited, HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false };
        parser.SetDelimiters(",");
        var headers = parser.ReadFields() ?? throw new InvalidDataException("CSV is empty.");
        if (headers.Distinct(StringComparer.OrdinalIgnoreCase).Count() != headers.Length || headers.Any(h => h.Length > 64))
            throw new InvalidDataException("Invalid or duplicate CSV headers.");
        int Column(string name) => Array.FindIndex(headers, h => string.Equals(h, name, StringComparison.OrdinalIgnoreCase));
        var nameColumn = Column("name"); var urlColumn = Column("url"); var userColumn = Column("username");
        var passwordColumn = Column("password"); var noteColumn = Column("note"); if (noteColumn < 0) noteColumn = Column("notes");
        if (nameColumn < 0 || urlColumn < 0 || userColumn < 0 || passwordColumn < 0)
            throw new InvalidDataException("Expected Chrome/Edge headers: name, url, username, password (optional note/notes).");
        var rows = new List<ImportRow>();
        var seen = existing.ToList();
        while (!parser.EndOfData)
        {
            if (rows.Count >= 10000) throw new InvalidDataException("Import supports up to 10,000 rows.");
            var number = rows.Count + 2;
            try
            {
                var values = parser.ReadFields()!;
                if (values.Length != headers.Length || values.Any(v => v.Length > 16384)) throw new InvalidDataException();
                var url = values[urlColumn];
                if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("https" or "http") ||
                    uri.UserInfo.Length != 0 || url.Length > 2048) throw new InvalidDataException();
                var item = new Entry
                {
                    Title = string.IsNullOrWhiteSpace(values[nameColumn]) ? uri.Host : values[nameColumn],
                    Username = values[userColumn], Password = values[passwordColumn],
                    Origins = uri.Scheme == "https" ? [Origin.Parse(url)] : [],
                    Notes = (noteColumn >= 0 ? values[noteColumn] : "") + (uri.Scheme == "http" ? "\nImported HTTP address (manual use): " + url : "")
                }.Validated();
                var duplicate = seen.Any(e => ExactDuplicate(e, item));
                var conflict = seen.Any(e => SameAccount(e, item));
                rows.Add(new ImportRow { Row = number, Entry = item, Website = url,
                    Status = duplicate ? "Exact duplicate — skipped" : conflict ? "Conflict — choose Replace or Skip" : uri.Scheme == "http" ? "Manual use only (HTTP)" : "New entry",
                    Action = duplicate || conflict ? ImportAction.Skip : ImportAction.Add });
                seen.Add(item);
            }
            catch (Exception ex) when (ex is InvalidDataException or MalformedLineException or ArgumentException)
            { rows.Add(new ImportRow { Row = number, Status = "Invalid fields, URL, or CSV quoting — skipped", Action = ImportAction.Skip }); }
        }
        return rows;
    }

    public static bool SameAccount(Entry a, Entry b) => a.Type == "login" && b.Type == "login" && a.Username == b.Username &&
        (a.Origins.Intersect(b.Origins, StringComparer.Ordinal).Any() ||
            (a.Origins.Length == 0 && b.Origins.Length == 0 && a.Title == b.Title && a.Notes == b.Notes));
    public static bool ExactDuplicate(Entry a, Entry b) => a.Type == "login" && b.Type == "login" && a.Title == b.Title && a.Username == b.Username &&
        a.Origins.Order(StringComparer.Ordinal).SequenceEqual(b.Origins.Order(StringComparer.Ordinal)) && a.Password == b.Password && a.Notes == b.Notes;
}
