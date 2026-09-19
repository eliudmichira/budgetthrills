$oldCspPattern = '<meta http-equiv="Content-Security-Policy"[^>]*>'

$newCsp = '<meta http-equiv="Content-Security-Policy" content="default-src ''self''; script-src ''self'' ''unsafe-inline'' ''unsafe-eval'' blob: https://cdn.tailwindcss.com https://www.gstatic.com https://apis.google.com https://www.googletagmanager.com; style-src ''self'' ''unsafe-inline'' https://fonts.googleapis.com; font-src ''self'' https://fonts.gstatic.com; img-src ''self'' data: blob: https://images.unsplash.com https://i.ebayimg.com https://lh3.googleusercontent.com https://*.googleusercontent.com; connect-src ''self'' https://*.firebaseio.com https://*.googleapis.com https://firestore.googleapis.com https://www.gstatic.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src ''self'' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com;">'

$files = Get-ChildItem -Filter "*.html" | Select-Object -ExpandProperty Name
$count = 0

foreach ($f in $files) {
    $c = Get-Content $f -Raw -Encoding UTF8
    if ($c -match $oldCspPattern) {
        $c = $c -replace $oldCspPattern, $newCsp
        Set-Content $f $c -Encoding UTF8 -NoNewline
        $count++
        Write-Host "Updated CSP: $f"
    } else {
        # If not present, insert after viewport
        $c = $c -replace '(<meta name="viewport"[^>]*>)', ('$1' + "`r`n" + $newCsp)
        Set-Content $f $c -Encoding UTF8 -NoNewline
        $count++
        Write-Host "Injected CSP: $f"
    }
}

Write-Host "Done. Updated CSP in $count files."
