#requires -Version 5.1
param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Security
[System.Windows.Forms.Application]::EnableVisualStyles()
$utf8 = New-Object System.Text.UTF8Encoding($false)
$state = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ApolloProxyControl'
$vaultPath = Join-Path $state 'credentials.dpapi'
$vault = @{}
$mutex = $null
$bridge = $null
$tray = $null

function Save-Vault {
    [IO.Directory]::CreateDirectory($state) | Out-Null
    $plain = $utf8.GetBytes(($script:vault | ConvertTo-Json -Compress))
    try {
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $temporary = $vaultPath + '.new'
        [IO.File]::WriteAllBytes($temporary, $encrypted)
        if ([IO.File]::Exists($vaultPath)) { [IO.File]::Replace($temporary, $vaultPath, $null) }
        else { [IO.File]::Move($temporary, $vaultPath) }
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
}
function Load-Vault {
    if (-not [IO.File]::Exists($vaultPath)) { return }
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($vaultPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
        $value = $utf8.GetString($plain) | ConvertFrom-Json
        foreach ($property in $value.PSObject.Properties) { $script:vault[$property.Name] = $property.Value }
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
}
function Show-Problem($code) {
    $messages = @{
        DATA_ACTIVATION_PASSWORD_INVALID = 'Неверный пароль доступа к знаниям. Повторите ввод.'
        DATA_ACTIVATION_REQUIRED = 'Сначала активируйте знания: введите пароль, полученный от команды Apollo.'
        DATA_RELEASE_BUSY = 'Пакет знаний занят. Дождитесь завершения операции и повторите попытку.'
        OPENROUTER_KEY_REJECTED = 'OpenRouter отклонил ключ. Проверьте его и подключите снова.'
        OPENROUTER_KEY_REQUIRED = 'Введите личный API-ключ OpenRouter.'
        OPENROUTER_CREDITS_REQUIRED = 'На ключе OpenRouter недостаточно средств или исчерпан лимит.'
        OPENROUTER_TIMEOUT = 'OpenRouter не ответил вовремя. Проверьте сеть и повторите.'
        OPENROUTER_UNAVAILABLE = 'Нет связи с OpenRouter. Проверьте подключение к интернету.'
        OPENROUTER_APPROVAL_REQUIRED = 'Отправка данных отменена или истекло время подтверждения. Повторите запуск навыка.'
        WINDOWS_PROXY_BUSY = 'Идёт проверка в Apollo. Дождитесь её завершения перед остановкой или обновлением.'
        WINDOWS_PORT_BUSY = 'Порт 3001 занят. Завершите другую копию Proxy и повторите запуск.'
        WINDOWS_START_FAILED = 'Proxy не запустился. Откройте журнал и передайте ошибку команде Apollo.'
        WINDOWS_START_TIMEOUT = 'Proxy не подтвердил запуск за минуту. Откройте журнал и повторите запуск.'
        WINDOWS_COMMAND_BUSY = 'Дождитесь завершения текущей операции.'
        WINDOWS_PROXY_IDENTITY_CHANGED = 'На порту 3001 отвечает другой процесс. Перезапустите эту копию Proxy.'
    }
    $message = $messages[$code]
    if (-not $message) { $message = 'Не удалось выполнить действие. Проверьте сеть или откройте журнал. Код: ' + $code }
    $statusLabel.Text = $message
    $statusLabel.ForeColor = [Drawing.Color]::Firebrick
}
function Send-Command($action, $extra, $callback) {
    if ($null -eq $script:bridge -or $script:bridge.HasExited) { throw 'Процесс управления Proxy завершился. Запустите приложение снова.' }
    $script:sequence++
    $request = @{ id = [string]$script:sequence; action = $action }
    if ($extra) { foreach ($key in $extra.Keys) { $request[$key] = $extra[$key] } }
    $script:pending[$request.id] = @{ action = $action; callback = $callback; started = [DateTime]::UtcNow }
    $script:inputWriter.WriteLine(($request | ConvertTo-Json -Depth 12 -Compress))
    $script:inputWriter.Flush()
}
function Set-Busy($value) {
    $script:working = $value
    foreach ($button in $script:buttons) { $button.Enabled = -not $value }
    if ($script:rollbackButton) { $script:rollbackButton.Enabled = (-not $value -and $null -ne $script:data.previous) }
    $progress.Visible = $value
}
function Update-Data($data) {
    $script:data = $data
    if ($data.current) {
        $dataLabel.Text = 'Знания: ' + $data.current.packageVersion
        if (-not $data.current.packageVersion) { $dataLabel.Text = 'Знания загружены' }
        $activateButton.Text = 'Активировать заново'
    } else { $dataLabel.Text = 'Знания ещё не активированы' }
    $rollbackButton.Enabled = (-not $script:working -and $null -ne $data.previous)
}
function Start-Proxy {
    Set-Busy $true
    $statusLabel.Text = 'Запускаем Proxy…'
    Send-Command 'start' @{} { param($value) $script:lastRunning = $true; $statusLabel.Text = 'Proxy работает · порт 3001'; $statusLabel.ForeColor = [Drawing.SystemColors]::ControlText }
}
function New-Button($text, $handler) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $text; $button.AutoSize = $true; $button.MinimumSize = New-Object Drawing.Size(130, 34)
    $button.Margin = New-Object Windows.Forms.Padding(0, 0, 8, 0)
    $button.Add_Click({ try { & $handler } catch { Show-Problem 'WINDOWS_COMMAND_FAILED'; Set-Busy $false } }.GetNewClosure())
    $script:buttons += $button
    return $button
}
function New-Row {
    $row = New-Object Windows.Forms.FlowLayoutPanel
    $row.AutoSize = $true; $row.WrapContents = $true; $row.Dock = 'Top'; $row.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 10)
    return $row
}
function Add-Text($text, $bold = $false) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text; $label.AutoSize = $true; $label.MaximumSize = New-Object Drawing.Size(610, 0)
    $label.Margin = New-Object Windows.Forms.Padding(0, 8, 0, 6)
    if ($bold) { $label.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold) }
    $layout.Controls.Add($label)
    return $label
}

try {
    if (-not [Environment]::Is64BitProcess) { throw 'Для этой сборки нужна 64-разрядная Windows.' }
    $created = $false
    $mutex = New-Object Threading.Mutex($true, 'Local\ApolloProxyWindowsTexts', [ref]$created)
    if (-not $created) { throw 'Apollo Proxy уже открыт. Найдите его значок в области уведомлений.' }
    Load-Vault
    if ($SelfTest) {
        $probe = $utf8.GetBytes('Apollo — проверка кириллицы')
        $encrypted = [Security.Cryptography.ProtectedData]::Protect($probe, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $clear = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        if ($utf8.GetString($clear) -ne 'Apollo — проверка кириллицы') { throw 'DPAPI self-test failed' }
        Write-Output 'WINDOWS_NATIVE_SELF_TEST_OK'; exit 0
    }
    $sequence = 0; $pending = @{}; $buttons = @(); $working = $false; $exiting = $false
    $lastApproval = ''; $lastFailure = ''; $healthPending = $false; $data = $null
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Apollo Proxy · проверка текстов'
    $form.Font = New-Object Drawing.Font('Segoe UI', 10)
    $form.AutoScaleMode = 'Dpi'; $form.ClientSize = New-Object Drawing.Size(660, 680)
    $form.MinimumSize = New-Object Drawing.Size(660, 650); $form.StartPosition = 'CenterScreen'
    $form.Icon = [Drawing.SystemIcons]::Application
    $layout = New-Object Windows.Forms.FlowLayoutPanel
    $layout.FlowDirection = 'TopDown'; $layout.WrapContents = $false; $layout.AutoScroll = $true
    $layout.Dock = 'Fill'; $layout.Padding = New-Object Windows.Forms.Padding(24)
    $form.Controls.Add($layout)
    $title = Add-Text 'Apollo Proxy' $true
    $title.Font = New-Object Drawing.Font('Segoe UI', 20, [Drawing.FontStyle]::Bold)
    $null = Add-Text 'Тестовая Windows-сборка для редактора. Тексты проверяет UX Writer через OpenRouter.'
    $statusLabel = Add-Text 'Проверяем комплект поставки…'
    $progress = New-Object Windows.Forms.ProgressBar
    $progress.Style = 'Marquee'; $progress.Size = New-Object Drawing.Size(580, 4); $layout.Controls.Add($progress)

    $null = Add-Text 'Знания' $true
    $dataLabel = Add-Text 'Проверяем состояние…'
    $password = New-Object Windows.Forms.TextBox
    $password.UseSystemPasswordChar = $true; $password.Width = 580; $password.MaxLength = 1024; $password.AccessibleName = 'Пароль доступа к знаниям Apollo'
    $layout.Controls.Add($password)
    $row = New-Row
    $activateButton = New-Button 'Активировать знания' {
        if (-not $password.Text) { Show-Problem 'DATA_ACTIVATION_REQUIRED'; return }
        Set-Busy $true; $statusLabel.Text = 'Загружаем и проверяем знания…'
        Send-Command 'activate' @{ password = $password.Text } {
            param($value)
            $script:vault.activation = @{ key = $value.activationKey; keyId = $value.activationKeyID }; Save-Vault
            $password.Clear(); Update-Data $value; Start-Proxy
        }
        $password.Clear()
    }
    $row.Controls.Add($activateButton); $layout.Controls.Add($row)

    $null = Add-Text 'Проверка текстов · OpenRouter' $true
    $keyLabel = Add-Text 'Введите личный API-ключ. Он хранится зашифрованным в вашем профиле Windows.'
    if ($vault.openrouter) { $keyLabel.Text = 'Личный ключ сохранён. Проверьте подключение перед первым запуском навыка.' }
    $apiKey = New-Object Windows.Forms.TextBox
    $apiKey.UseSystemPasswordChar = $true; $apiKey.Width = 580; $apiKey.MaxLength = 512; $apiKey.AccessibleName = 'Личный API-ключ OpenRouter'
    $layout.Controls.Add($apiKey)
    $row = New-Row
    $connectButton = New-Button 'Подключить' {
        $candidate = $apiKey.Text.Trim()
        if (-not $candidate) { Show-Problem 'OPENROUTER_KEY_REQUIRED'; return }
        Set-Busy $true; $keyLabel.Text = 'Проверяем ключ…'
        $script:keyCandidate = $candidate
        Send-Command 'checkKey' @{ key = $candidate } {
            param($value)
            $script:vault.openrouter = $script:keyCandidate; $script:keyCandidate = $null; Save-Vault
            $apiKey.Clear(); $keyLabel.Text = 'OpenRouter подключён'; $statusLabel.Text = 'Подключение проверено'
        }
        $apiKey.Clear()
    }
    $checkButton = New-Button 'Проверить подключение' {
        if (-not $script:vault.openrouter) { Show-Problem 'OPENROUTER_KEY_REQUIRED'; return }
        Set-Busy $true
        Send-Command 'checkKey' @{ key = $script:vault.openrouter } { param($value) $keyLabel.Text = 'OpenRouter подключён'; $statusLabel.Text = 'Подключение проверено' }
    }
    $removeButton = New-Button 'Удалить ключ' { $script:vault.Remove('openrouter'); Save-Vault; $keyLabel.Text = 'Ключ удалён. Введите новый для проверки текстов.' }
    $row.Controls.AddRange(@($connectButton, $checkButton, $removeButton)); $layout.Controls.Add($row)
    $null = Add-Text 'Перед каждым запросом Proxy попросит подтвердить отправку текстов и редакционных правил. Запрос расходует баланс OpenRouter.'

    $null = Add-Text 'Управление' $true
    $row = New-Row
    $startButton = New-Button 'Запустить Proxy' { Start-Proxy }
    $stopButton = New-Button 'Остановить' { Set-Busy $true; Send-Command 'stop' @{} { param($value) $script:lastRunning = $false; $statusLabel.Text = 'Proxy остановлен' } }
    $logButton = New-Button 'Открыть журнал' { [IO.Directory]::CreateDirectory((Join-Path $state 'logs')) | Out-Null; Start-Process explorer.exe -ArgumentList ('"' + (Join-Path $state 'logs') + '"') }
    $row.Controls.AddRange(@($startButton, $stopButton, $logButton)); $layout.Controls.Add($row)
    $row = New-Row
    $updateButton = New-Button 'Проверить знания' {
        Set-Busy $true; $statusLabel.Text = 'Проверяем знания…'
        Send-Command 'check' @{ access = $script:vault.activation } {
            param($value)
            Update-Data $value
            if (-not $value.current) { Show-Problem 'DATA_ACTIVATION_REQUIRED' }
            else { $statusLabel.Text = 'Установлен пакет знаний из этой тестовой поставки' }
        }
    }
    $rollbackButton = New-Button 'Откатить знания' {
        Set-Busy $true
        Send-Command 'rollback' @{} { param($value) Update-Data $value; Start-Proxy }
    }
    $exitButton = New-Button 'Завершить' {
        if ($script:controllerFailed -or $script:bridge.HasExited) { $script:exiting = $true; $form.Close(); return }
        Set-Busy $true
        Send-Command 'stop' @{} { param($value) $script:exiting = $true; $form.Close() }
    }
    $row.Controls.AddRange(@($updateButton, $rollbackButton, $exitButton)); $layout.Controls.Add($row)
    $null = Add-Text 'Откройте Apollo в Figma, выделите макет и запустите UX Writer. Генерация и вход в локальные CLI в этой сборке не настраиваются.'
    $tray = New-Object Windows.Forms.NotifyIcon
    $tray.Icon = $form.Icon; $tray.Text = 'Apollo Proxy · тексты'; $tray.Visible = $true
    $tray.Add_DoubleClick({ $form.Show(); $form.Activate() })
    $menu = New-Object Windows.Forms.ContextMenuStrip
    $null = $menu.Items.Add('Открыть настройки', $null, { $form.Show(); $form.Activate() })
    $null = $menu.Items.Add('Завершить', $null, { $exitButton.PerformClick() })
    $tray.ContextMenuStrip = $menu
    $form.Add_FormClosing({ param($sender, $event) if (-not $script:exiting) { $event.Cancel = $true; $form.Hide() } })
    Set-Busy $true

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $PSScriptRoot 'runtime\node.exe'
    $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'controller.js') + '"'
    $startInfo.WorkingDirectory = $PSScriptRoot; $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true; $startInfo.RedirectStandardOutput = $true; $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = $utf8; $startInfo.StandardErrorEncoding = $utf8
    foreach ($name in @($startInfo.EnvironmentVariables.Keys)) {
        if ($name -match '^(APOLLO_|CODEX_|CLAUDE_|ANTHROPIC_|LANGFLOW_)' -or $name -in @('NODE_OPTIONS', 'NODE_PATH')) { $startInfo.EnvironmentVariables.Remove($name) }
    }
    $bridge = New-Object Diagnostics.Process
    $bridge.StartInfo = $startInfo; $null = $bridge.Start()
    $inputWriter = New-Object IO.StreamWriter($bridge.StandardInput.BaseStream, $utf8)
    $read = $bridge.StandardOutput.ReadLineAsync(); $errors = $bridge.StandardError.ReadToEndAsync()
    $timer = New-Object Windows.Forms.Timer; $timer.Interval = 250
    $ticks = 0
    $timer.Add_Tick({
        try {
            if ($script:read.IsCompleted) {
                $line = $script:read.GetAwaiter().GetResult()
                if ($null -eq $line) { throw 'Proxy controller exited' }
                $reply = $line | ConvertFrom-Json
                $script:read = $script:bridge.StandardOutput.ReadLineAsync()
                if ($reply.event -eq 'ready') {
                    Set-Busy $true
                    Send-Command 'status' @{} { param($value) Update-Data $value; if ($value.current) { Start-Proxy } else { $statusLabel.Text = 'Введите пароль доступа к знаниям и подключите OpenRouter' } }
                } elseif ($script:pending.ContainsKey([string]$reply.id)) {
                    $entry = $script:pending[[string]$reply.id]; $script:pending.Remove([string]$reply.id)
                    if ($entry.action -eq 'health') { $script:healthPending = $false } else { Set-Busy $false }
                    if ($reply.success) {
                        try { & $entry.callback $reply.value }
                        catch { $script:keyCandidate = $null; $statusLabel.Text = 'Не удалось сохранить настройку. Повторите действие; перезапуск приложения не требуется.'; Set-Busy $false }
                    }
                    else { $script:keyCandidate = $null; Show-Problem $reply.code }
                }
            }
            $script:ticks++
            if ($script:ticks % 8 -eq 0 -and -not $script:healthPending -and -not $script:working) {
                $script:healthPending = $true
                Send-Command 'health' @{} {
                    param($value)
                    if (-not $value.running -and $script:lastRunning) { $statusLabel.Text = 'Proxy остановился. Нажмите «Запустить Proxy» или откройте журнал.' }
                    $script:lastRunning = $value.running
                    if ($value.failure -and $value.failure.runId -ne $script:lastFailure) { $script:lastFailure = $value.failure.runId; Show-Problem $value.failure.code }
                    if ($value.approval -and $value.approval.runId -ne $script:lastApproval) {
                        $script:lastApproval = $value.approval.runId
                        $approvedKey = $null
                        if ($script:vault.openrouter) {
                            $text = 'Отправить тексты выделенных слоёв (' + $value.approval.texts + ') и редакционные правила в OpenRouter? Это расходует баланс вашего ключа.'
                            if ($value.approval.screens) { $text = 'Отправить данные экранов (' + $value.approval.screens + '), бриф и правила паспорта задачи в OpenRouter? Это расходует баланс вашего ключа.' }
                            $form.Show(); $form.Activate()
                            if ([Windows.Forms.MessageBox]::Show($form, $text, 'Отправка данных в OpenRouter', 'YesNo', 'Question', 'Button2') -eq 'Yes') { $approvedKey = $script:vault.openrouter }
                        } else { Show-Problem 'OPENROUTER_KEY_REQUIRED' }
                        Send-Command 'approve' @{ runId = $value.approval.runId; key = $approvedKey } { param($result) }
                    }
                }
            }
            foreach ($requestId in @($script:pending.Keys)) {
                if (([DateTime]::UtcNow - $script:pending[$requestId].started).TotalSeconds -gt 180) {
                    $script:pending.Remove($requestId); $script:healthPending = $false; $script:keyCandidate = $null
                    Set-Busy $false; $statusLabel.Text = 'Операция не ответила за три минуты. Повторите действие или завершите приложение.'
                }
            }
        } catch {
            $script:controllerFailed = $true
            $timer.Stop(); Set-Busy $false
            $statusLabel.Text = 'Процесс управления завершился. Перезапустите Apollo Proxy.'
            $statusLabel.ForeColor = [Drawing.Color]::Firebrick
            foreach ($button in $script:buttons) { $button.Enabled = ($button -eq $exitButton -or $button -eq $logButton) }
            $script:bridge.StandardInput.Close()
        }
    })
    $timer.Start()
    [Windows.Forms.Application]::Run($form)
} catch {
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Apollo Proxy', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($timer) { $timer.Stop(); $timer.Dispose() }
    if ($bridge -and -not $bridge.HasExited) { $bridge.StandardInput.Close(); if (-not $bridge.WaitForExit(5000)) { $bridge.Kill() } }
    if ($tray) { $tray.Visible = $false; $tray.Dispose() }
    if ($mutex) { if ($created) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}
