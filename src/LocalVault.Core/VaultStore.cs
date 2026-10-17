using System.Security.Cryptography;

namespace LocalVault.Core;

public sealed class VaultStore : IDisposable
{
    private readonly object gate = new();
    private readonly string path;
    private byte[]? key;
    private byte[]? envelope;
    private List<Entry> entries = [];
    private SessionSecret? session;
    private bool helloEnabled;
    private long generation;
    public VaultStore(string directory)
    {
        LocalFiles.RestrictDirectory(directory);
        path = Path.Combine(directory, "vault.lvault");
    }
    public bool Exists => File.Exists(path);
    public bool IsUnlocked { get { lock (gate) return key != null; } }
    public bool CanResume { get { lock (gate) return session != null; } }
    public long Generation { get { lock (gate) return generation; } }
    public bool HelloEnabled { get { lock (gate) return helloEnabled; } }

    public void Create(string password)
    {
        lock (gate)
        {
            if (Exists) throw new InvalidOperationException("A vault already exists.");
            var newKey = RandomNumberGenerator.GetBytes(32);
            try
            {
                var file = VaultFormat.Seal(VaultFormat.Header(password, newKey), newKey, []);
                LocalFiles.AtomicWrite(path, file);
                EndSession(); key = newKey; envelope = file; entries = []; generation++;
            }
            catch { CryptographicOperations.ZeroMemory(newKey); throw; }
        }
    }

    public void Unlock(string password)
    {
        lock (gate)
        {
            var file = VaultFormat.ReadBounded(path);
            var opened = VaultFormat.Open(file, password);
            var keepHello = helloEnabled;
            EndSession(); key = opened.Key; entries = opened.Entries; envelope = file; generation++;
            if (keepHello) EnableHello(true);
        }
    }

    // Persistent Windows Hello: the desktop wraps a copy of the vault key with a TPM-backed Hello signature.
    public byte[] CopyKey()
    {
        lock (gate) { RequireUnlocked(); return key!.ToArray(); }
    }

    public void UnlockWithKey(byte[] candidate)
    {
        lock (gate)
        {
            var file = VaultFormat.ReadBounded(path);
            List<Entry> opened;
            try { opened = VaultFormat.ReadEntries(file, candidate); }
            catch (Exception ex) when (ex is not InvalidDataException)
            { throw new InvalidDataException("Windows Hello could not open this vault. Use your master password."); }
            EndSession(); key = candidate.ToArray(); entries = opened; envelope = file; generation++;
        }
    }

    public void EnableHello(bool enabled)
    {
        lock (gate)
        {
            RequireUnlocked();
            var protectedKey = enabled ? new SessionSecret(key!) : null;
            session?.Dispose(); session = protectedKey; helloEnabled = enabled;
        }
    }

    // The desktop must successfully complete the OS challenge before calling this method.
    public void ResumeAfterHello(long expectedGeneration)
    {
        lock (gate)
        {
            if (generation != expectedGeneration || key != null || session == null || envelope == null)
                throw new InvalidOperationException("The session changed. Unlock again.");
            var recovered = session.Reveal();
            try { entries = VaultFormat.ReadEntries(envelope, recovered); key = recovered; generation++; }
            catch { CryptographicOperations.ZeroMemory(recovered); throw; }
        }
    }

    public void Lock()
    {
        lock (gate)
        {
            if (key != null) CryptographicOperations.ZeroMemory(key);
            key = null; entries = []; generation++;
        }
    }

    public void EndSession()
    {
        lock (gate)
        {
            Lock(); session?.Dispose(); session = null; helloEnabled = false; envelope = null;
        }
    }

    public IReadOnlyList<Entry> Snapshot()
    {
        lock (gate) { RequireUnlocked(); return entries.Where(e => e.DeletedAt == null).Select(Copy).ToArray(); }
    }

    public IReadOnlyList<Entry> TrashSnapshot()
    {
        lock (gate) { RequireUnlocked(); return entries.Where(e => e.DeletedAt != null).Select(Copy).ToArray(); }
    }

    public Entry Get(Guid id)
    {
        lock (gate) { RequireUnlocked(); return Copy(entries.FirstOrDefault(e => e.Id == id && e.DeletedAt == null)
            ?? throw new InvalidOperationException("This item no longer exists.")); }
    }

    public IReadOnlyList<EntryRevision> History(Guid id)
    {
        lock (gate) { RequireUnlocked(); return entries.FirstOrDefault(e => e.Id == id && e.DeletedAt == null)?.History.Reverse().ToArray()
            ?? throw new InvalidOperationException("This item no longer exists."); }
    }

    public EntryRevision RestoreHistory(Guid id, int index, string expectedVersion)
    {
        lock (gate)
        {
            RequireUnlocked();
            var old = entries.FirstOrDefault(e => e.Id == id && e.DeletedAt == null) ?? throw new InvalidOperationException("This item no longer exists.");
            if (old.Updated.UtcTicks.ToString() != expectedVersion) throw new InvalidOperationException("This item changed. Reopen history before restoring.");
            var revisions = old.History.Reverse().ToArray();
            if ((uint)index >= (uint)revisions.Length) throw new InvalidOperationException("That history revision is no longer available.");
            var selected = revisions[index];
            var restored = selected.Content;
            var nextItem = old with { Type = restored.Type, Title = restored.Title, Username = restored.Username, Password = restored.Password,
                Origins = restored.Origins, Notes = restored.Notes, Fields = restored.Fields, Created = restored.Created,
                Updated = DateTimeOffset.UtcNow, History = AddRevision(old.History, old) };
            Commit(entries.Select(e => e.Id == id ? nextItem : e).ToList());
            return selected;
        }
    }

    public Entry Save(Entry entry)
    {
        lock (gate)
        {
            RequireUnlocked(); entry = entry.Validated();
            var old = entries.FirstOrDefault(e => e.Id == entry.Id);
            if (old?.DeletedAt != null) throw new InvalidOperationException("Restore this item from Trash before editing it.");
            if (old != null && entry.Updated != old.Updated)
                throw new InvalidOperationException("This entry changed while you were editing. Reopen it before saving.");
            entry = entry with { Created = old?.Created ?? entry.Created, Updated = old?.Updated ?? entry.Updated };
            if (old != null && ContentEquals(old, entry)) return Copy(old);
            if (old != null) entry = entry with { History = AddRevision(old.History, old), Updated = DateTimeOffset.UtcNow };
            else entry = entry with { Updated = DateTimeOffset.UtcNow };
            var next = entries.Where(e => e.Id != entry.Id).Append(entry).ToList();
            Commit(next); return entry;
        }
    }

    public void Delete(Guid id)
    {
        lock (gate)
        {
            RequireUnlocked();
            var old = entries.FirstOrDefault(e => e.Id == id && e.DeletedAt == null) ?? throw new InvalidOperationException("This item no longer exists.");
            Commit(entries.Select(e => e.Id == id ? e with { DeletedAt = DateTimeOffset.UtcNow } : e).ToList());
        }
    }

    public void RestoreTrash(Guid id)
        => RestoreTrash(id, false);

    public void UndoDelete(Guid id) => RestoreTrash(id, true);

    private void RestoreTrash(Guid id, bool undoOnly)
    {
        lock (gate)
        {
            RequireUnlocked();
            var deleted = entries.FirstOrDefault(e => e.Id == id && e.DeletedAt != null)?.DeletedAt
                ?? throw new InvalidOperationException("This Trash item no longer exists.");
            if (undoOnly && DateTimeOffset.UtcNow - deleted > TimeSpan.FromSeconds(10))
                throw new InvalidOperationException("The Undo window expired. Restore this item from Trash.");
            Commit(entries.Select(e => e.Id == id ? e with { DeletedAt = null, Updated = DateTimeOffset.UtcNow } : e).ToList());
        }
    }

    public void PurgeTrash(Guid? id = null)
    {
        lock (gate)
        {
            RequireUnlocked();
            var next = entries.Where(e => e.DeletedAt == null || id != null && e.Id != id).ToList();
            if (next.Count == entries.Count) throw new InvalidOperationException("No matching Trash item exists.");
            Commit(next);
        }
    }

    public void Import(IReadOnlyList<ImportRow> rows)
    {
        lock (gate)
        {
            RequireUnlocked();
            var next = entries.ToList();
            foreach (var row in rows.Where(r => r.Action != ImportAction.Skip && r.Entry != null))
            {
                var item = row.Entry!.Validated();
                var matches = next.Where(e => e.DeletedAt == null && e.Type == "login" && ImportCsv.SameAccount(e, item)).ToList();
                if (matches.Any(e => ImportCsv.ExactDuplicate(e, item))) continue;
                if (matches.Count > 0 && row.Action != ImportAction.Replace)
                    throw new InvalidDataException("Resolve conflicting import rows before committing.");
                if (matches.Count > 1) throw new InvalidDataException("Multiple existing accounts match an import row. Resolve them manually first.");
                if (matches.Count == 1)
                {
                    var old = matches[0]; next.Remove(old);
                    item = item with { Id = old.Id, Created = old.Created, Updated = old.Updated };
                    if (ContentEquals(old, item)) { next.Add(old); continue; }
                    item = item with { Updated = DateTimeOffset.UtcNow, History = AddRevision(old.History, old) };
                }
                next.Add(item);
            }
            Commit(next);
        }
    }

    public void ChangePassword(string currentPassword, string newPassword)
    {
        lock (gate)
        {
            RequireUnlocked();
            var verified = VaultFormat.Open(VaultFormat.ReadBounded(path), currentPassword);
            try
            {
                var file = VaultFormat.Seal(VaultFormat.Header(newPassword, key!), key!, entries);
                LocalFiles.AtomicWrite(path, file); envelope = file; generation++;
            }
            finally { CryptographicOperations.ZeroMemory(verified.Key); }
        }
    }

    public void Backup(string destination)
    {
        lock (gate)
        {
            RequireUnlocked();
            if (Path.GetFullPath(destination).StartsWith(Path.GetDirectoryName(path)! + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Choose a backup location outside the vault data directory.");
            LocalFiles.AtomicWrite(destination, envelope!);
        }
    }

    public void Restore(string source, string password)
    {
        lock (gate)
        {
            var file = VaultFormat.ReadBounded(source);
            var opened = VaultFormat.Open(file, password);
            try
            {
                if (Exists)
                {
                    var preserved = path + ".before-restore." + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff");
                    File.Copy(path, preserved, false);
                }
                LocalFiles.AtomicWrite(path, file);
                EndSession(); key = opened.Key; envelope = file; entries = opened.Entries; generation++;
            }
            catch { CryptographicOperations.ZeroMemory(opened.Key); throw; }
        }
    }

    // Forgotten master password: start over. The old encrypted vault is set aside (still unreadable without its
    // password) so it can be restored via "Restore encrypted backup" if the password is ever remembered.
    public string? Reset()
    {
        lock (gate)
        {
            EndSession();
            if (!Exists) return null;
            var directory = Path.GetDirectoryName(path)!;
            var archived = Path.Combine(directory, "vault-before-reset-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff") + ".lvault");
            File.Move(path, archived);
            if (File.Exists(path + ".previous")) File.Delete(path + ".previous");
            return archived;
        }
    }

    private void Commit(List<Entry> next)
    {
        var file = VaultFormat.Seal(envelope!, key!, next);
        LocalFiles.AtomicWrite(path, file);
        envelope = file; entries = next; generation++;
    }

    private static Entry Copy(Entry e) => e with { Origins = e.Origins.ToArray(), Fields = e.Fields.ToArray(),
        History = e.History.Select(h => h with { Content = h.Content with { Origins = h.Content.Origins.ToArray(), Fields = h.Content.Fields.ToArray() } }).ToArray() };

    private static EntryRevision[] AddRevision(EntryRevision[] history, Entry current) => history
        .Append(new EntryRevision(RevisionContent.From(current), current.Updated)).TakeLast(20).ToArray();

    private static bool ContentEquals(Entry a, Entry b) => a.Type == b.Type && a.Title == b.Title && a.Username == b.Username &&
        a.Password == b.Password && a.Notes == b.Notes && a.Origins.SequenceEqual(b.Origins) && a.Fields.SequenceEqual(b.Fields);
    private void RequireUnlocked()
    {
        if (key == null) throw new InvalidOperationException("Unlock the desktop vault first.");
    }
    public void Dispose() => EndSession();
}
