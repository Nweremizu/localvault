using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LocalVault.Core;
using LocalVault.Desktop;
using Sodium;

if (args.Length == 1)
{
    Console.WriteLine("Validated update package: " + InstallerUpdate.Inspect(args[0], new Version(0, 2, 0)));
    return 0;
}

var root = Path.Combine(AppContext.BaseDirectory, "test-data-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
var passed = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception("FAILED: " + name); passed++; Console.WriteLine("PASS " + name); }
void Reject(Action action, string name) { try { action(); } catch { Check(true, name); return; } throw new Exception("FAILED: " + name); }
async Task RejectAsync(Func<Task> action, string name) { try { await action(); } catch { Check(true,name); return; } throw new Exception("FAILED: " + name); }
const string password = "test master passphrase 1";
const string changed = "different master passphrase 2";
try
{
    var update = new Dictionary<string, string> { ["ProductName"] = "LocalVault Private Beta", ["UpgradeCode"] = InstallerUpdate.UpgradeCode, ["ProductVersion"] = "0.2.1" };
    Check(InstallerUpdate.Validate(update, new Version(0, 2, 0, 0)) == new Version(0, 2, 1), "Accept a newer LocalVault per-user update");
    Reject(() => InstallerUpdate.Validate(update, new Version(0, 2, 1)), "Reject same-version update");
    Reject(() => InstallerUpdate.Validate(update, new Version(0, 3, 0)), "Reject update downgrade");
    foreach (var invalid in new[] { ("ProductName", "Other app"), ("UpgradeCode", Guid.NewGuid().ToString()), ("ALLUSERS", "1"), ("ALLUSERS", "2"), ("ProductVersion", "not-a-version"), ("ProductVersion", "1.2.3.4"), ("ProductVersion", "999.1.0") })
    {
        var altered = new Dictionary<string, string>(update) { [invalid.Item1] = invalid.Item2 };
        Reject(() => InstallerUpdate.Validate(altered, new Version(0, 2, 0)), "Reject incompatible update metadata: " + invalid.Item1 + " / " + invalid.Item2);
    }
    var invalidMsi = Path.Combine(root, "invalid.msi"); File.WriteAllText(invalidMsi, "not an MSI database");
    Reject(() => InstallerUpdate.Inspect(invalidMsi, new Version(0, 2, 0)), "Reject invalid MSI before launching Windows Installer");
    var location = Path.Combine(root, "original");
    using var store = new VaultStore(location);
    var watch = Stopwatch.StartNew(); store.Create(password); watch.Stop();
    Console.WriteLine($"BENCHMARK Argon2id moderate (3 iterations / 256 MiB), creation: {watch.ElapsedMilliseconds} ms");
    Check(store.IsUnlocked && store.Snapshot().Count == 0, "Create an empty encrypted vault");
    var entry = store.Save(new Entry { Title = "Fixture account", Username = "fixture-user", Password = "fixture-password-123", Origins = ["https://EXAMPLE.com/login"], Notes = "secret note" });
    Check(entry.Origins.SequenceEqual(["https://example.com"]), "Normalize exact HTTPS origin");
    Check(Origin.Parse("https://bücher.example:443/login") == "https://xn--bcher-kva.example", "IDN and default-port normalization");
    Check(Origin.Parse("https://example.com:8443/path") == "https://example.com:8443", "Preserve non-default port");
    Check(Origin.MainDomain("account.konami.net")=="konami.net" && Origin.MainDomain("account.jumia.com.ng")=="jumia.com.ng" && Origin.MainDomain("jumia.com.ng")=="jumia.com.ng"
        && Origin.MainDomain("login.bbc.co.uk")=="bbc.co.uk" && Origin.MainDomain("github.com")=="github.com" && Origin.MainDomain("192.168.1.10")=="192.168.1.10"
        && Origin.MainDomain("a.b.example.de")=="example.de", "Main domain for icon lookup");
    Reject(() => Origin.Parse("http://example.com"), "Reject HTTP autofill origin");
    Reject(() => Origin.Parse("https://user:secret@example.com"), "Reject embedded URL credentials");
    Reject(() => Origin.Parse("javascript:alert(1)"), "Reject non-web scheme");
    var vaultPath = Path.Combine(location, "vault.lvault");
    var file = File.ReadAllBytes(vaultPath);
    Check(!Encoding.UTF8.GetString(file).Contains("fixture-user") && !Encoding.UTF8.GetString(file).Contains("secret note"), "Encrypt metadata and secrets");
    var earlier = File.ReadAllBytes(vaultPath + ".previous");
    var previousOpened = VaultFormat.Open(earlier,password);
    Check(previousOpened.Entries.Count == 0, "Retain previous valid encrypted revision"); CryptographicOperations.ZeroMemory(previousOpened.Key);
    Reject(() => store.Unlock("wrong password"), "Reject incorrect master password");
    for (var offset = 0; offset < file.Length; offset += 23)
    {
        var damaged = file.ToArray(); damaged[offset] ^= 1;
        if (offset < 20) { Reject(() => VaultFormat.Validate(damaged), "Reject malformed format/header at " + offset); }
        else { Reject(() => { var opened=VaultFormat.Open(damaged,password); CryptographicOperations.ZeroMemory(opened.Key); }, "Authenticate wrapped key/payload at " + offset); }
    }
    Reject(() => VaultFormat.Validate(file[..100]), "Reject truncated vault before derivation");
    var expensive = file.ToArray(); BinaryPrimitives.WriteInt32LittleEndian(expensive.AsSpan(16), int.MaxValue);
    Reject(() => VaultFormat.Open(expensive,password), "Reject excessive KDF cost before allocation");
    var changedNonce = file.ToArray(); changedNonce[108] ^= 1;
    Reject(() => VaultFormat.Open(changedNonce,password), "Authenticate payload nonce");
    using (var blocked = new FileStream(vaultPath, FileMode.Open, FileAccess.Read, FileShare.Read))
    {
        Reject(() => store.Save(entry with { Password="not-committed" }), "Fail atomically when destination cannot be replaced");
        Check(store.Snapshot().Single().Password == entry.Password, "Failed write preserves in-memory state");
    }
    Check(File.ReadAllBytes(vaultPath).SequenceEqual(file), "Failed write preserves original file");
    Check(!Directory.GetFiles(location,"*.tmp").Any(), "Clean failed encrypted temporary file");
    store.EnableHello(true); store.Lock(); var lockGeneration = store.Generation;
    Check(!store.IsUnlocked && store.CanResume, "Lock retains only protected Hello session key");
    Reject(() => store.Snapshot(), "Locked vault cannot enumerate secrets");
    Reject(() => store.Save(entry), "Locked vault cannot save");
    store.ResumeAfterHello(lockGeneration); Check(store.Snapshot().Single().Password == entry.Password, "Resume protected in-memory session");
    store.Lock(); var staleGeneration=store.Generation; store.EndSession();
    Reject(() => store.ResumeAfterHello(staleGeneration), "End session invalidates outstanding Hello challenge");
    Check(!store.CanResume, "No persistent Hello session after ending");
    store.Unlock(password);
    var backup = Path.Combine(root, "backup.lvault"); store.Backup(backup);
    store.ChangePassword(password,changed); store.EndSession();
    Reject(() => store.Unlock(password), "Old password cannot unlock changed vault");
    store.Unlock(changed); Check(store.Snapshot().Count==1, "New master password preserves entries");
    using var restored = new VaultStore(Path.Combine(root,"restored"));
    restored.Restore(backup,password); Check(restored.Snapshot().Single().Password == entry.Password,"Portable backup restores in another data directory");
    var restoreBefore=File.ReadAllBytes(Path.Combine(root,"restored","vault.lvault"));
    Reject(() => restored.Restore(backup,"wrong"),"Wrong backup password cannot replace vault");
    Check(File.ReadAllBytes(Path.Combine(root,"restored","vault.lvault")).SequenceEqual(restoreBefore),"Rejected restore leaves vault intact");
    restored.Restore(backup,password); Check(Directory.GetFiles(Path.Combine(root,"restored"),"*.before-restore.*").Length==1,"Preserve vault separately before valid restore");
    File.WriteAllBytes(Path.Combine(root,"restored","vault.lvault"),[1,2,3]);
    restored.Restore(backup,password); Check(restored.Snapshot().Count==1,"Restore over a corrupt primary without discarding it");
    Check(Directory.GetFiles(Path.Combine(root,"restored"),"*.before-restore.*").Any(p=>File.ReadAllBytes(p).SequenceEqual(new byte[]{1,2,3})),"Keep damaged primary bytes for recovery");

    var csv=Path.Combine(root,"fixture.csv");
    File.WriteAllText(csv,"name,url,username,password,note\r\n\"Quoted, title\",https://example.org/login,user,pass123,\"note with\r\nnewline\"\r\nPlain,http://legacy.example,old,legacy-pass,hello\r\nBad,javascript:bad,user,pass,\r\n",new UTF8Encoding(false));
    var preview=ImportCsv.Preview(csv,store.Snapshot());
    Check(preview.Count==3 && preview[0].Title=="Quoted, title" && preview[0].Entry!.Notes=="note with\r\nnewline", "Parse quoted and multiline CSV fields");
    Check(preview[1].Entry!.Origins.Length==0 && preview[1].Entry!.Notes.Contains("http://legacy.example"), "HTTP CSV entries are manual-use only");
    Check(!ImportCsv.SameAccount(preview[1].Entry!,preview[1].Entry! with{Notes="Imported HTTP address (manual use): http://other.example"}),"Do not merge unrelated manual-use HTTP accounts");
    Check(preview[2].Entry==null && preview[2].Action==ImportAction.Skip,"Invalid CSV row is skipped without secret diagnostics");
    store.Import(preview); Check(store.Snapshot().Count==3,"Commit valid import rows together");
    var duplicate = ImportCsv.Preview(csv,store.Snapshot()); Check(duplicate.Take(2).All(r=>r.Action==ImportAction.Skip),"Exact CSV duplicates default to skip");
    store.Import(duplicate); Check(store.Snapshot().Count==3,"Duplicate imports do not add entries");
    var conflict = new ImportRow {Entry=entry with{Id=Guid.NewGuid(),Password="replacement"},Action=ImportAction.Add};
    Reject(()=>store.Import([new ImportRow{Entry=new Entry{Title="Uncommitted",Password="x"},Action=ImportAction.Add},conflict]),"Unresolved conflict rejects entire import");
    Check(store.Snapshot().Count==3,"Rejected import has no partial writes");
    conflict.Action=ImportAction.Replace; store.Import([conflict]);
    var importedReplacement=store.Snapshot().Single(e=>e.Id==entry.Id);
    Check(importedReplacement.Password=="replacement" && importedReplacement.History.Single().Content.Password==entry.Password,
        "Explicit CSV replacement preserves the identifier and records the prior password");
    Reject(()=>store.Save(entry with{Title="Stale edit"}),"Reject stale desktop edit after another writer updates the account");
    File.WriteAllText(csv,"name,url,username\nA,https://example.com,user"); Reject(()=>ImportCsv.Preview(csv,[]),"Reject missing CSV password header");
    File.WriteAllText(csv,"name,url,username,password\n\"bad,https://example.com,user,password");
    Check(ImportCsv.Preview(csv,[]).Single().Entry==null,"Malformed CSV quoting is reported without partial import");
    var pairings = new Pairings(location); var token=pairings.Add("extension-a","Test profile");
    Check(pairings.Verify("extension-a",token) && !pairings.Verify("extension-b",token),"Pairing tokens are extension-bound");
    Check(!File.ReadAllText(Path.Combine(location,"pairings.json")).Contains(token),"Persist only pairing token hashes");
    pairings.Revoke(pairings.Snapshot().Single().Id); Check(!pairings.Verify("extension-a",token),"Revoked token is rejected");
    Check(new Pairings(location).Snapshot().Count==0,"Revocation persists across restart");
    File.WriteAllText(Path.Combine(location,"pairings.json"),"broken");
    var damagedPairings=new Pairings(location);Check(damagedPairings.WasDamaged && !damagedPairings.Verify("extension-a",token),"Damaged pairing file fails closed without blocking the vault");
    damagedPairings.Add("extension-a","Repaired");
    Check(File.ReadAllText(Path.Combine(location,"pairings.json.previous"))=="broken","Preserve damaged pairing metadata before replacing");
    Reject(()=>Frames.Parse("{\"version\":1,\"id\":\"1\",\"operation\":\"export\"}"u8.ToArray()),"Protocol has no bulk vault operation");
    Reject(()=>Frames.Parse("{\"version\":1,\"id\":\"1\",\"operation\":\"status\",\"token\":null}"u8.ToArray()),"Reject explicit null at protocol boundary");
    using var framed=new MemoryStream();await Frames.Write(framed,"{}"u8.ToArray());framed.Position=0;
    Check((await Frames.Read(framed))!.SequenceEqual("{}"u8.ToArray()),"Binary framing round trip");
    using var oversized=new MemoryStream();var frameHeader=new byte[4];BinaryPrimitives.WriteInt32LittleEndian(frameHeader,Frames.MaxBytes+1);oversized.Write(frameHeader);oversized.Position=0;
    await RejectAsync(async()=>{await Frames.Read(oversized);},"Reject oversized IPC frame before body allocation");
    using var truncated=new MemoryStream([2,0,0,0,123]);await RejectAsync(async()=>{await Frames.Read(truncated);},"Reject truncated IPC frame");
    var passwords=Enumerable.Range(0,100).Select(_=>Passwords.Generate()).ToArray();
    Check(passwords.All(p=>p.Length==24)&&passwords.Distinct().Count()==100,"Generate bounded randomized passwords");
    Reject(()=>Passwords.Generate(1),"Reject unsafe generator length");
    var digitsOnly=Enumerable.Range(0,50).Select(_=>Passwords.Generate(new GeneratorOptions(12,false,false,true,false))).ToArray();
    Check(digitsOnly.All(p=>p.Length==12&&p.All(char.IsAsciiDigit)),"Generator honors chosen character types");
    var mixed=Enumerable.Range(0,200).Select(_=>Passwords.Generate(new GeneratorOptions(8,AvoidAmbiguous:true))).ToArray();
    Check(mixed.All(p=>p.Any(char.IsAsciiLetterUpper)&&p.Any(char.IsAsciiLetterLower)&&p.Any(char.IsAsciiDigit)&&p.Any(c=>!char.IsAsciiLetterOrDigit(c))&&!p.Any(c=>"Il1O0o".Contains(c))),
        "Generator includes every chosen type and skips look-alike characters");
    Reject(()=>Passwords.Generate(new GeneratorOptions(20,false,false,false,false)),"Generator rejects having no character types");
    await Task.WhenAll(Enumerable.Range(0,8).Select(i=>Task.Run(()=>store.Save(new Entry{Title="Concurrent "+i,Password="test",Origins=["https://parallel.example"]}))));
    Check(store.Snapshot().Count==11,"Serialize concurrent vault writes");
    store.EndSession();store.Unlock(changed);Check(store.Snapshot().Count==11,"Concurrent writes remain readable after restart");
    var copiedKey=store.CopyKey(); store.EndSession(); store.UnlockWithKey(copiedKey);
    Check(store.Snapshot().Count==11,"Unlock with a wrapped copy of the vault key");
    store.EndSession(); Reject(()=>store.UnlockWithKey(RandomNumberGenerator.GetBytes(32)),"Reject a wrong vault key");
    Check(!store.IsUnlocked,"Wrong key leaves the vault locked"); CryptographicOperations.ZeroMemory(copiedKey); store.Unlock(changed);
    var archived=store.Reset();
    Check(!store.Exists && !store.IsUnlocked && !store.CanResume && !File.Exists(vaultPath+".previous"),"Reset removes the active vault and session");
    store.Create(password); Check(store.Snapshot().Count==0,"Reset allows a fresh vault with a new master password");
    using (var recovered=new VaultStore(Path.Combine(root,"after-reset"))) { recovered.Restore(archived!,changed); Check(recovered.Snapshot().Count==11,"Reset keeps the old encrypted vault restorable"); }

    var featurePath=Path.Combine(root,"features"); using var features=new VaultStore(featurePath); features.Create(password);
    var secureLogin=features.Save(new Entry {Title="History account",Username="user",Password="first-version",Origins=["https://history.example"],Fields=[new CustomField(Guid.NewGuid(),"Token","secret","field-secret")]});
    var noOp=features.Save(secureLogin); Check(noOp.History.Length==0 && features.History(secureLogin.Id).Count==0,"No-op save does not create a password history revision");
    var changedLogin=features.Save(secureLogin with {Password="second-version"});
    Check(changedLogin.History.Length==1 && changedLogin.History[0].Content.Password=="first-version","Save records the full previous item content");
    for(var i=0;i<22;i++){var current=features.Get(secureLogin.Id);features.Save(current with{Title="Revision "+i});}
    Check(features.Get(secureLogin.Id).History.Length==20 && features.History(secureLogin.Id).Count==20,"History retains only the latest 20 revisions");
    var beforeRestore=features.Get(secureLogin.Id); var previousTitle=features.History(secureLogin.Id)[0].Content.Title;
    features.RestoreHistory(secureLogin.Id,0,beforeRestore.Updated.UtcTicks.ToString());
    Check(features.Get(secureLogin.Id).Id==secureLogin.Id && features.Get(secureLogin.Id).Title==previousTitle && features.Get(secureLogin.Id).History.Length==20,
        "Restore history preserves item ID and records current content first");
    var secureNote=features.Save(new Entry {Type="note",Title="Private note",Notes="Plain text body\nsecond line",Fields=[new CustomField(Guid.NewGuid(),"Recovery key","secret","note-secret")]});
    Check(secureNote.Type=="note" && secureNote.Password=="" && secureNote.Origins.Length==0,"Save a standalone note without login fields or origins");
    Reject(()=>features.Save(secureNote with{Origins=["https://note.example"]}),"Reject browser origins on secure notes");
    Reject(()=>new CustomField(Guid.NewGuid(),"bad","secret",new string('x',16385)).Validated(),"Reject oversized custom field values");
    features.Delete(secureNote.Id); Check(features.Snapshot().All(e=>e.Id!=secureNote.Id)&&features.TrashSnapshot().Single().Id==secureNote.Id,"Delete moves an item and history into Trash");
    features.UndoDelete(secureNote.Id); Check(features.Snapshot().Any(e=>e.Id==secureNote.Id),"Undo restores a recently deleted item");
    features.Delete(secureNote.Id); features.RestoreTrash(secureNote.Id); Check(features.Get(secureNote.Id).Notes==secureNote.Notes,"Trash restore preserves note contents and ID");
    features.Delete(secureNote.Id); var featureBackup=Path.Combine(root,"feature-backup.lvault"); features.Backup(featureBackup);
    using(var featureRestored=new VaultStore(Path.Combine(root,"feature-restored")))
    {
        featureRestored.Restore(featureBackup,password);
        Check(featureRestored.TrashSnapshot().Single().Fields.Single().Value=="note-secret" && featureRestored.Get(secureLogin.Id).History.Length==20,
            "Encrypted backup preserves notes, custom fields, history, and Trash");
        featureRestored.RestoreTrash(secureNote.Id); Check(featureRestored.Get(secureNote.Id).Notes==secureNote.Notes,"Restore item from Trash after reopening a backup");
        featureRestored.Delete(secureNote.Id); featureRestored.PurgeTrash(secureNote.Id);
        Check(featureRestored.TrashSnapshot().Count==0 && featureRestored.Snapshot().All(e=>e.Id!=secureNote.Id),"Permanently purge a Trash item");
    }

    var security = SecurityChecks.Analyze([
        new Entry{Title="Weak A",Password="123456"}, new Entry{Title="Weak B",Password="123456"},
        new Entry{Title="Long",Password=new string('x',1025)}, new Entry{Type="note",Title="Note",Notes="Never scanned"}]);
    Check(security.Total==3 && security.Weak==2 && security.Reused==2 && security.NotAssessed==1,
        "Security dashboard detects weak/reused active login passwords and skips oversized analysis");

    var largeValue=new string('x',16384); var largeFields=Enumerable.Range(0,32).Select(i=>new CustomField(Guid.NewGuid(),"Field "+i,"secret",largeValue)).ToArray();
    var revisionTime=DateTimeOffset.UtcNow;
    var largeHistory=Enumerable.Range(0,20).Select(_=>new EntryRevision(new RevisionContent("login","Earlier","user","p",[],"",largeFields,revisionTime,revisionTime),revisionTime)).ToArray();
    Entry LargeEntry(string title)=>new(){Title=title,Username="user",Password="p",Fields=largeFields,History=largeHistory};
    var sizePath=Path.Combine(root,"size-limit"); using(var sizeLimited=new VaultStore(sizePath))
    {
        sizeLimited.Create(password); sizeLimited.Save(LargeEntry("First"));
        var intactFile=File.ReadAllBytes(Path.Combine(sizePath,"vault.lvault"));
        Reject(()=>sizeLimited.Save(LargeEntry("Second")),"Reject content exceeding the encrypted vault size limit");
        Check(sizeLimited.Snapshot().Count==1 && File.ReadAllBytes(Path.Combine(sizePath,"vault.lvault")).SequenceEqual(intactFile),
            "Oversized content leaves the previous encrypted revision readable");
    }

    var breached="fixture-password-for-range"; var hash=Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(breached)));
    var handler=new StubHandler((request,_) =>
    {
        if(request.RequestUri?.AbsolutePath!="/range/"+hash[..5] || !request.Headers.TryGetValues("Add-Padding",out var padding) || padding.Single()!="true")
            throw new Exception("HIBP request did not use the five-character prefix and padding.");
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(hash[5..]+":42\r\n"+new string('0',35)+":0\r\n")});
    });
    using(var breachClient=new PwnedPasswords(new HttpClient(handler)))
    {
        var result=await breachClient.CheckAsync([new PasswordSecret(Guid.NewGuid(),"Range fixture",breached)],CancellationToken.None);
        Check(result.Single().State=="found" && result.Single().Count==42,"HIBP range matches locally and ignores zero-count padding");
    }
    using(var unavailable=new PwnedPasswords(new HttpClient(new StubHandler((_,_)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable))))))
    {
        var result=await unavailable.CheckAsync([new PasswordSecret(Guid.NewGuid(),"Unavailable",breached)],CancellationToken.None);
        Check(result.Single().State=="unavailable" && result.Single().Count==null,"HIBP errors are reported as unavailable, not safe");
    }
    using(var canceled=new CancellationTokenSource())using(var cancelScanner=new PwnedPasswords(new HttpClient(new StubHandler(async (_,token)=>{await Task.Delay(Timeout.Infinite,token);return new HttpResponseMessage(HttpStatusCode.OK);}))))
    {
        canceled.Cancel(); await RejectAsync(async()=>await cancelScanner.CheckAsync([new PasswordSecret(Guid.NewGuid(),"Canceled",breached)],canceled.Token),"Cancel HIBP checks without retaining results");
    }

    var legacyDirectory=Path.Combine(root,"legacy"); using(var legacyStore=new VaultStore(legacyDirectory))
    {
        legacyStore.Create(password);var legacyEntry=legacyStore.Save(new Entry{Title="Legacy",Username="legacy-user",Password="legacy-password"});
        var key=legacyStore.CopyKey();var versioned=File.ReadAllBytes(Path.Combine(legacyDirectory,"vault.lvault"));
        var legacyPlain=JsonSerializer.SerializeToUtf8Bytes(new[]{new{legacyEntry.Id,legacyEntry.Title,legacyEntry.Username,legacyEntry.Password,legacyEntry.Origins,legacyEntry.Notes,legacyEntry.Created,legacyEntry.Updated}},Json.Options);
        var legacyFile=new byte[VaultFormat.HeaderSize+legacyPlain.Length+16];versioned.AsSpan(0,VaultFormat.HeaderSize).CopyTo(legacyFile);
        RandomNumberGenerator.Fill(legacyFile.AsSpan(108,24));SecretAeadXChaCha20Poly1305.Encrypt(legacyPlain,legacyFile[108..132],key,legacyFile[..VaultFormat.HeaderSize]).CopyTo(legacyFile,VaultFormat.HeaderSize);
        CryptographicOperations.ZeroMemory(key);CryptographicOperations.ZeroMemory(legacyPlain);legacyStore.EndSession();
        File.WriteAllBytes(Path.Combine(legacyDirectory,"vault.lvault"),legacyFile);legacyStore.Unlock(password);
        Check(legacyStore.Get(legacyEntry.Id).Type=="login" && legacyStore.Get(legacyEntry.Id).History.Length==0,"Read legacy encrypted entry-array payloads as login items");
        var current=legacyStore.Get(legacyEntry.Id);legacyStore.Save(current with{Notes="Migrated on first mutation"});
        var migrated=File.ReadAllBytes(Path.Combine(legacyDirectory,"vault.lvault"));var migrationKey=legacyStore.CopyKey();
        var migratedPlain=SecretAeadXChaCha20Poly1305.Decrypt(migrated[VaultFormat.HeaderSize..],migrated[108..132],migrationKey,migrated[..VaultFormat.HeaderSize]);
        Check(JsonDocument.Parse(migratedPlain).RootElement.ValueKind==JsonValueKind.Object,"First successful mutation migrates legacy array into a versioned payload");
        Reject(()=>JsonSerializer.Deserialize<List<Entry>>(migratedPlain,Json.Options),"Old entry-array readers reject versioned payloads without rewriting it");
        CryptographicOperations.ZeroMemory(migrationKey);CryptographicOperations.ZeroMemory(migratedPlain);
    }
    Console.WriteLine($"RESULT {passed} checks passed; no production vault was accessed.");
    return 0;
}

finally
{
    if (!Path.GetFullPath(root).StartsWith(Path.Combine(AppContext.BaseDirectory,"test-data-"),StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Unexpected test cleanup path.");
    Directory.Delete(root,true);
}

sealed class StubHandler(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)=>respond(request,cancellationToken);
}
