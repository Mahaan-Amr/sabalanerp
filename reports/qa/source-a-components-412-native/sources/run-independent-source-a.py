"""Same finite RSA owner, with a hidden native credential prompt boundary."""
import json, pathlib, runpy, subprocess
Q=pathlib.Path('D:/sabalanerp-online-qa')
material=Q/'C30-source-a-existing-independent-material-frontend-8da97bdc77eb45c19fc09b64c6e2c467'
output=Q/'C30-source-a-existing-independent-runtime-frontend-8da97bdc77eb45c19fc09b64c6e2c467'
scope=runpy.run_path(str(material/'owner.py'))
def hidden_prompt(_message):
    # Password travels only through this private anonymous pipe into the
    # existing owner; never a command argument, log, report or model output.
    script="""$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Sabalan #412 - private independent host credential'
$form.ClientSize = New-Object System.Drawing.Size(480,125)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Independent backup host root password (RSA key stays remote):'
$label.SetBounds(12,12,455,22)
$box = New-Object System.Windows.Forms.TextBox
$box.UseSystemPasswordChar = $true
$box.SetBounds(12,40,455,24)
$ok = New-Object System.Windows.Forms.Button
$ok.Text = 'Continue #412'
$ok.SetBounds(340,80,125,28)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.AddRange(@($label,$box,$ok))
$form.AcceptButton = $ok
try {
 if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
 [Console]::Out.Write($box.Text)
} finally { $box.Clear(); $form.Dispose() }
"""
    child=subprocess.Popen(['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe','-STA','-NoProfile','-Command',script],
                           stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                           creationflags=subprocess.CREATE_NO_WINDOW)
    faults=[]
    while True:
        try:
            raw,err=child.communicate();break
        except BaseException as error:
            faults.append(type(error).__name__)
    receipt={'format':'sabalan-private-credential-prompt-closed/v1','originalPid':child.pid,
             'code':child.returncode,'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,
             'observationFaults':faults,'secretStored':False,'secretPrinted':False}
    (output/'credential-prompt-closed.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    assert child.returncode==0 and child.stdout.closed and child.stderr.closed and not faults and not err
    password=raw.decode('utf-8')
    raw=None
    assert password and not any(c in password for c in '\r\n\0')
    return password
scope['getpass'].getpass=hidden_prompt
print(json.dumps(scope['main']()))
