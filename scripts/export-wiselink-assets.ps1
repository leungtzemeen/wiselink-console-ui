# Crop WiseLink logo for web assets (requires Windows + System.Drawing)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\src\assets\wiselink-logo-full.jpg' | Resolve-Path
$assets = Join-Path $PSScriptRoot '..\src\assets' | Resolve-Path
$publicDir = Join-Path $PSScriptRoot '..\public' | Resolve-Path

$img = [System.Drawing.Image]::FromFile($src.Path)
try {
  $W = $img.Width
  $H = $img.Height
  Write-Host "Source ${W}x${H}"

  # Full circular logo: center square inscribed in image (assume circle fills width)
  $side = [Math]::Min($W, $H)
  $cx = [int](($W - $side) / 2)
  $cy = [int](($H - $side) / 2)
  $full = New-Object System.Drawing.Bitmap $side, $side
  $g = [System.Drawing.Graphics]::FromImage($full)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $side, $side), $cx, $cy, $side, $side, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $fullPath = Join-Path $assets.Path 'wiselink-logo-circle.png'
  $full.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $full.Dispose()
  Write-Host "Saved $fullPath"

  # Head icon: upper-center crop (tunable fractions of width/height)
  $hw = [int]($W * 0.42)
  $hh = [int]($H * 0.38)
  $hx = [int](($W - $hw) / 2)
  $hy = [int]($H * 0.08)
  $head = New-Object System.Drawing.Bitmap $hw, $hh
  $g2 = [System.Drawing.Graphics]::FromImage($head)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $hw, $hh), $hx, $hy, $hw, $hh, [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose()
  $headPath = Join-Path $assets.Path 'wiselink-robot-head.png'
  $head.Save($headPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $head.Dispose()
  Write-Host "Saved $headPath"

  # Favicon 32x32 from head crop
  $head2 = [System.Drawing.Image]::FromFile($headPath)
  try {
    $ico = New-Object System.Drawing.Bitmap 32, 32
    $g3 = [System.Drawing.Graphics]::FromImage($ico)
    $g3.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g3.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g3.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g3.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g3.DrawImage($head2, 0, 0, 32, 32)
    $g3.Dispose()
    $icoPath = Join-Path $publicDir.Path 'favicon-32.png'
    $ico.Save($icoPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $ico.Dispose()
    Write-Host "Saved $icoPath"
  }
  finally {
    $head2.Dispose()
  }
}
finally {
  $img.Dispose()
}
