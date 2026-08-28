// 保存先フォルダを選ぶダイアログを開く。
// Windows は PowerShell のフォルダ選択ダイアログ、macOS は osascript、
// それ以外(Linux)は zenity を試す。使えない環境ではテキスト入力に切り替える。
import { execFile } from 'node:child_process';

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const out = String(stdout).trim();
      resolve(out || null);
    });
  });
}

export async function pickFolderDialog() {
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
      "$f.Description = '保存先フォルダを選択してください';",
      'if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
    ].join(' ');
    return run('powershell', ['-NoProfile', '-STA', '-Command', ps]);
  }
  if (process.platform === 'darwin') {
    const script = 'POSIX path of (choose folder with prompt "保存先フォルダを選択してください")';
    return run('osascript', ['-e', script]);
  }
  // Linux 等: zenity があれば使う
  return run('zenity', ['--file-selection', '--directory', '--title=保存先フォルダを選択']);
}
