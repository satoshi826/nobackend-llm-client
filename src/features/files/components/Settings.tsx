// Settings → Chat → Files
import { useEffect, useState } from 'preact/hooks';
import { fileUsage } from '../../../lib/db/files';
import { saveSettings, settings } from '../../../state/app';
import { PermissionSelect, Section, Toggle } from '../../../components/settings-ui';
import { FILE_TOOL_NAMES } from '../tools';

export function FilesSettings() {
  const s = settings.value;
  const [usage, setUsage] = useState<{ count: number; chars: number } | null>(null);
  useEffect(() => {
    void fileUsage().then(setUsage);
  }, []);
  // The write tools share one setting; read_file follows it
  const perm = s.toolPermissions.create_file ?? 'allow';
  return (
    <Section title="ファイル">
      <p class="text-xs text-zinc-500">
        レポートや長い文書は、モデルが「ファイル」として保存できます（サイドバーの「ファイル」タブ）。入力欄の「添付」から、テキストや PDF をモデルに読ませることもできます。ファイルはこのブラウザの中だけに保存され、パスフレーズがあれば暗号化されます。
        {usage ? ` 保存数 ${usage.count} 件。` : ''}
      </p>
      <Toggle
        checked={s.fileTools}
        onChange={(v) => saveSettings({ fileTools: v })}
        title="モデルがファイルを作成・編集できるようにする"
        desc="ツール呼び出しに対応したモデルで使えます。送信のたびにツールの説明が少し増えます（約 600 トークン）。オフでも、添付したファイルの内容はメッセージと一緒に送られます。"
      />
      {s.fileTools && (
        <PermissionSelect
          label="ファイルを書き込む前の確認"
          value={perm}
          onChange={(v) => saveSettings({ toolPermissions: { ...s.toolPermissions, ...Object.fromEntries(FILE_TOOL_NAMES.map((n) => [n, v])) } })}
        />
      )}
    </Section>
  );
}
