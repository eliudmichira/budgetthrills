$cspTag = '<meta http-equiv="Content-Security-Policy" content="default-src ' + "'" + 'self' + "'" + '; script-src ' + "'" + 'self' + "'" + " 'unsafe-inline' https://cdn.tailwindcss.com https://www.gstatic.com https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com https://i.ebayimg.com https://lh3.googleusercontent.com; connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://firestore.googleapis.com; frame-ancestors 'none';" + '">'

$viewportStr = 'content="width=device-width, initial-scale=1, viewport-fit=cover"'

$files = Get-ChildItem -Filter "*.html" | Select-Object -ExpandProperty Name
$count = 0
foreach ($f in $files) {
    $c = Get-Content $f -Raw -Encoding UTF8
    if ($c -notmatch "Content-Security-Policy") {
        # Insert CSP right after the viewport meta tag line
        $c = $c -replace '(<meta name="viewport"[^>]*>)', ('$1' + "`r`n" + $cspTag)
        Set-Content $f $c -Encoding UTF8 -NoNewline
        $count++
        Write-Host "CSP injected: $f"
    } else {
        Write-Host "Already has CSP: $f"
    }
}
Write-Host "Done. Injected CSP into $count files."
