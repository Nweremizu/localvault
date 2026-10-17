# Regenerates ui/public/logo.png, the extension icons and src/LocalVault.Desktop/app.ico. Run only when the logo design changes.
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'src/LocalVault.Desktop'
$uiPublic = Join-Path (Split-Path $PSScriptRoot -Parent) 'ui/public'

function New-Logo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0
    function Rounded([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddArc($x, $y, 2*$r, 2*$r, 180, 90); $p.AddArc($x+$w-2*$r, $y, 2*$r, 2*$r, 270, 90)
        $p.AddArc($x+$w-2*$r, $y+$h-2*$r, 2*$r, 2*$r, 0, 90); $p.AddArc($x, $y+$h-2*$r, 2*$r, 2*$r, 90, 90)
        $p.CloseFigure(); $p
    }
    $accent = [System.Drawing.Color]::FromArgb(0x65, 0x58, 0xD3)
    $g.FillPath((New-Object System.Drawing.SolidBrush $accent), (Rounded 0 0 $size $size (56*$s)))
    # Padlock: shackle arc + body
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (22*$s)
    $g.DrawArc($pen, 84*$s, 52*$s, 88*$s, 96*$s, 180, 180)
    $g.DrawLine($pen, 84*$s, 100*$s, 84*$s, 122*$s); $g.DrawLine($pen, 172*$s, 100*$s, 172*$s, 122*$s)
    $g.FillPath([System.Drawing.Brushes]::White, (Rounded (60*$s) (116*$s) (136*$s) (96*$s) (20*$s)))
    # Four-point sparkle as the keyhole (matches the app's existing mark)
    $cx = 128*$s; $cy = 164*$s; $r = 30*$s; $k = 7*$s
    $star = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($cx, $cy-$r), [System.Drawing.PointF]::new($cx+$k, $cy-$k),
        [System.Drawing.PointF]::new($cx+$r, $cy), [System.Drawing.PointF]::new($cx+$k, $cy+$k),
        [System.Drawing.PointF]::new($cx, $cy+$r), [System.Drawing.PointF]::new($cx-$k, $cy+$k),
        [System.Drawing.PointF]::new($cx-$r, $cy), [System.Drawing.PointF]::new($cx-$k, $cy-$k))
    $g.FillPolygon((New-Object System.Drawing.SolidBrush $accent), $star)
    $g.Dispose(); $bmp
}

function PngBytes($bmp) { $m = New-Object IO.MemoryStream; $bmp.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $m.ToArray() }

(New-Logo 256).Save((Join-Path $uiPublic 'logo.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$extensionSource = Join-Path (Split-Path $PSScriptRoot -Parent) 'extensions/src'
foreach ($size in 16, 48, 128) { (New-Logo $size).Save((Join-Path $extensionSource "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png) }

# ICO with PNG-compressed frames (supported since Windows Vista)
$sizes = 16, 24, 32, 48, 64, 256
$frames = [System.Collections.Generic.List[byte[]]]::new()
foreach ($size in $sizes) { $frames.Add([byte[]](PngBytes (New-Logo $size))) }
$ico = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
[IO.File]::WriteAllBytes((Join-Path $out 'app.ico'), $ico.ToArray())
