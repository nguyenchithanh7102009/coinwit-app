$botToken = "8242385152:AAHvmiOBsM0ZUfqVPuMdEorINmoGD5SeKzo"
$webhookUrl = "https://coinwit.net/api/telegram/webhook"
$apiUrl = "https://api.telegram.org/bot$botToken/setWebhook"

$body = @{
    url = $webhookUrl
} | ConvertTo-Json

try {
    Write-Host "Setting Telegram webhook..."
    Write-Host "URL: $webhookUrl"
    
    $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $body -ContentType "application/json"
    
    Write-Host "`nResult:"
    $response | ConvertTo-Json -Depth 10
    
    if ($response.ok -eq $true) {
        Write-Host "`n✅ Webhook đã được thiết lập thành công!" -ForegroundColor Green
        Write-Host "Webhook URL: $($response.result.url)" -ForegroundColor Cyan
    } else {
        Write-Host "`n❌ Có lỗi khi thiết lập webhook" -ForegroundColor Red
        Write-Host "Error: $($response.description)" -ForegroundColor Red
    }
} catch {
    Write-Host "`n❌ Lỗi khi gọi API:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

