param([string]$directory)
& 'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe' -I -B "$PSScriptRoot/fixture.py" supervisor $directory
exit $LASTEXITCODE
