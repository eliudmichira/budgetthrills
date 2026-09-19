$apiKey = "AIzaSyB3KGIZcuAVtDueP-ex5G274Mh8cyNvc8I"
$projectId = "budgetthrills"

Write-Host "Authenticating via Firebase Auth REST API..."

$authBody = '{"returnSecureToken":true}'
try {
    $authRes = Invoke-RestMethod -Uri "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$apiKey" -Method Post -Body $authBody -ContentType "application/json"
    $idToken = $authRes.idToken
    Write-Host "Obtained Auth Token."
} catch {
    Write-Host "Auth Error:" $_.Exception.Message
}

$headers = @{
    "Authorization" = "Bearer $idToken"
    "Content-Type"  = "application/json"
}

# 1. Create Order BT-89052
$orderPayload = @'
{
  "fields": {
    "id": { "stringValue": "BT-89052" },
    "customerName": { "stringValue": "mich michira" },
    "email": { "stringValue": "michmichira@gmail.com" },
    "phone": { "stringValue": "0705893137" },
    "address": { "stringValue": "sovereign heights, Nairobi 01001" },
    "total": { "doubleValue": 244.00 },
    "status": { "stringValue": "processing" },
    "paymentMethod": { "stringValue": "Credit Card (Stripe ref: KW15Q1NR)" },
    "date": { "stringValue": "Aug 26, 2026" }
  }
}
'@

$url = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/orders?documentId=BT-89052"
try {
    $res = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $orderPayload
    Write-Host "Order BT-89052 Created in Firestore: SUCCESS"
} catch {
    $patchUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/orders/BT-89052"
    $res = Invoke-RestMethod -Uri $patchUrl -Method Patch -Headers $headers -Body $orderPayload
    Write-Host "Order BT-89052 Saved in Firestore: SUCCESS"
}

# 2. Create Order BT-95201
$orderPayload2 = @'
{
  "fields": {
    "id": { "stringValue": "BT-95201" },
    "customerName": { "stringValue": "mich michira" },
    "email": { "stringValue": "michmichira@gmail.com" },
    "phone": { "stringValue": "0705893137" },
    "address": { "stringValue": "sovereign heights, Nairobi 01001" },
    "total": { "doubleValue": 55.00 },
    "status": { "stringValue": "processing" },
    "paymentMethod": { "stringValue": "Credit Card (Stripe ref: OZ53LN5Z)" },
    "date": { "stringValue": "Aug 26, 2026" }
  }
}
'@

$url2 = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/orders?documentId=BT-95201"
try {
    $res2 = Invoke-RestMethod -Uri $url2 -Method Post -Headers $headers -Body $orderPayload2
    Write-Host "Order BT-95201 Created in Firestore: SUCCESS"
} catch {
    $patchUrl2 = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/orders/BT-95201"
    $res2 = Invoke-RestMethod -Uri $patchUrl2 -Method Patch -Headers $headers -Body $orderPayload2
    Write-Host "Order BT-95201 Saved in Firestore: SUCCESS"
}

# 3. Create Sample Contact Message
$msgPayload = @'
{
  "fields": {
    "name": { "stringValue": "mich michira" },
    "email": { "stringValue": "michmichira@gmail.com" },
    "topic": { "stringValue": "Order Status" },
    "orderNumber": { "stringValue": "BT-89052" },
    "message": { "stringValue": "Hi, checking on delivery timeline for my iPhone 14 order. Thanks!" },
    "replied": { "booleanValue": false }
  }
}
'@

$msgUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/contact-messages?documentId=MSG-89052"
try {
    $resMsg = Invoke-RestMethod -Uri $msgUrl -Method Post -Headers $headers -Body $msgPayload
    Write-Host "Contact Message MSG-89052 Created in Firestore: SUCCESS"
} catch {
    $patchMsgUrl = "https://firestore.googleapis.com/v1/projects/$projectId/databases/(default)/documents/contact-messages/MSG-89052"
    $resMsg = Invoke-RestMethod -Uri $patchMsgUrl -Method Patch -Headers $headers -Body $msgPayload
    Write-Host "Contact Message MSG-89052 Saved in Firestore: SUCCESS"
}

Write-Host "ALL ORDERS AND MESSAGES SEEDED TO FIRESTORE VIA POWERSHELL!"
