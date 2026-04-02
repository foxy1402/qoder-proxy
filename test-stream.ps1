# Test streaming endpoint
$body = @{
    model = 'lite'
    messages = @(@{role='user'; content='Write a short haiku about coding.'})
    stream = $true
} | ConvertTo-Json -Compress

$request = [System.Net.HttpWebRequest]::Create('http://localhost:3000/v1/chat/completions')
$request.Method = 'POST'
$request.Headers.Add('Authorization', 'Bearer test-api-key')
$request.ContentType = 'application/json'

$stream = $request.GetRequestStream()
$writer = New-Object System.IO.StreamWriter($stream)
$writer.Write($body)
$writer.Flush()
$writer.Close()

$response = $request.GetResponse()
$readStream = $response.GetResponseStream()
$reader = New-Object System.IO.StreamReader($readStream)

while (!$reader.EndOfStream) {
    $line = $reader.ReadLine()
    if ($line -and $line.StartsWith('data: ') -and $line -ne 'data: [DONE]') {
        try {
            $data = $line.Substring(6) | ConvertFrom-Json
            if ($data.choices -and $data.choices[0].delta.content) {
                Write-Host $data.choices[0].delta.content -NoNewline
            }
        } catch {
            # Ignore parse errors
        }
    }
}

Write-Host ""
Write-Host "Stream complete!"
